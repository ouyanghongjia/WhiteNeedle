import {
    DebugSession,
    InitializedEvent,
    StoppedEvent,
    TerminatedEvent,
    OutputEvent,
    Thread,
    StackFrame,
    Source,
    Scope,
    Variable,
    Breakpoint,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { CDPClient } from './cdpClient';
import { WebKitProxy, InspectorTarget } from './webKitProxy';
import { orderTargetsForQuickPick } from './targetPicker';
import * as path from 'path';
import * as fs from 'fs';

interface WhiteNeedleLaunchArgs extends DebugProtocol.LaunchRequestArguments {
    host: string;
    inspectorPort: number;
    script?: string;
    useUSB?: boolean;
    /**
     * When only one target exists, it is used as-is.
     * When multiple targets exist, a QuickPick is always shown; this string only
     * sorts matching titles to the top (does not auto-connect — avoids grabbing JSContext
     * while a WKWebView is also listed).
     */
    targetTitle?: string;
    /**
     * iOS device UDID for ios_webkit_debug_proxy -u (only this USB device on inspectorPort).
     * Overrides setting whiteneedle.webkitDeviceUdid when set in launch.json.
     */
    webkitDeviceUdid?: string;
    /** Enable verbose CDP/WIP protocol logging in Debug Console. Default: false. */
    verbose?: boolean;
}

interface CDPBreakpoint {
    breakpointId: string;
    locations: Array<{ scriptId: string; lineNumber: number; columnNumber: number }>;
}

interface CDPCallFrame {
    callFrameId: string;
    functionName: string;
    location: { scriptId: string; lineNumber: number; columnNumber: number };
    scopeChain: Array<{
        type: string;
        object: { objectId: string; type?: string; className?: string; description?: string };
        name?: string;
        empty?: boolean;
    }>;
    this: { type?: string; objectId?: string; className?: string; description?: string };
}

const THREAD_ID = 1;

/**
 * ios_webkit_debug_proxy assigns each USB device a different local port (9222, 9223, …).
 * Targets in /json embed that port in webSocketDebuggerUrl — preserve it; only normalize host to loopback.
 */
export function rewriteInspectorWebSocketToLoopback(
    webSocketDebuggerUrl: string,
    inspectorPortFallback: number
): string {
    try {
        const u = new URL(webSocketDebuggerUrl);
        u.hostname = '127.0.0.1';
        if (!u.port || u.port === '') {
            u.port = String(inspectorPortFallback);
        }
        return u.toString();
    } catch {
        return webSocketDebuggerUrl.replace(
            /^wss?:\/\/[^/?#]+/i,
            `ws://127.0.0.1:${inspectorPortFallback}`
        );
    }
}

export class WhiteNeedleDebugSession extends DebugSession {
    private cdp: CDPClient | null = null;
    private proxy: WebKitProxy | null = null;
    /** After Debugger/Runtime enabled; used so CDP 'close' during failed handshake does not kill ios_webkit_debug_proxy. */
    private inspectorHandshakeOk = false;
    private launchArgs: WhiteNeedleLaunchArgs | null = null;
    private scriptSources = new Map<string, { url: string; source?: string }>();
    private breakpoints = new Map<string, string[]>();
    private pausedFrames: CDPCallFrame[] = [];
    private variableHandles = new Map<number, string>();
    private getterHandles = new Map<number, { objectId: string; name: string }>();
    private nextVarHandle = 1000;

    public constructor() {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments
    ): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsFunctionBreakpoints = false;
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsSetVariable = false;
        response.body.supportsRestartFrame = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsCompletionsRequest = false;
        response.body.supportsTerminateRequest = true;

        this.sendResponse(response);
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: WhiteNeedleLaunchArgs
    ): Promise<void> {
        try {
            this.launchArgs = args;
            this.inspectorHandshakeOk = false;
            this.cdp = new CDPClient();

            this.cdp.on('Debugger.scriptParsed', (params: any) => {
                const url = params.url || params.sourceURL || `script_${params.scriptId}`;
                this.scriptSources.set(params.scriptId, { url, source: undefined });
            });

            this.cdp.on('Debugger.paused', (params: any) => {
                this.pausedFrames = params.callFrames || [];
                this.variableHandles.clear();
                this.nextVarHandle = 1000;
                const reason = params.reason === 'other' ? 'breakpoint' : params.reason;
                this.sendEvent(new StoppedEvent(reason, THREAD_ID));
            });

            this.cdp.on('Debugger.resumed', () => {
                this.pausedFrames = [];
                this.variableHandles.clear();
                this.nextVarHandle = 1000;
            });

            this.cdp.on('Runtime.consoleAPICalled', (params: any) => {
                const text = (params.args || [])
                    .map((a: any) => a.value ?? a.description ?? JSON.stringify(a))
                    .join(' ');
                this.sendEvent(new OutputEvent(text + '\n', 'console'));
            });

            this.cdp.on('Runtime.exceptionThrown', (params: any) => {
                const detail = params.exceptionDetails;
                const text = detail?.text || 'Exception thrown';
                this.sendEvent(new OutputEvent(text + '\n', 'stderr'));
            });

            this.cdp.on('close', () => {
                if (this.inspectorHandshakeOk) {
                    this.cleanupProxy();
                    this.sendEvent(new TerminatedEvent());
                }
            });

            const proxyPort = args.inspectorPort || 9222;

            this.sendEvent(
                new OutputEvent(
                    '[WhiteNeedle] 启动 ios_webkit_debug_proxy...\n',
                    'console'
                )
            );

            this.proxy = new WebKitProxy();
            try {
                const udid = args.webkitDeviceUdid?.trim();
                if (udid) {
                    this.sendEvent(
                        new OutputEvent(
                            `[WhiteNeedle] ios_webkit_debug_proxy 仅绑定 USB 设备 UDID: ${udid}\n`,
                            'console'
                        )
                    );
                }
                await this.proxy.start(proxyPort, udid ? { deviceUdid: udid } : undefined);
                this.sendEvent(
                    new OutputEvent(
                        `[WhiteNeedle] Proxy 就绪: http://127.0.0.1:${proxyPort}/json\n`,
                        'console'
                    )
                );
            } catch (err: any) {
                this.sendEvent(
                    new OutputEvent(
                        `[WhiteNeedle] Proxy 启动失败 (${err.message})，尝试直连...\n`,
                        'console'
                    )
                );
                this.proxy = null;
            }

            const target = await this.selectTarget(proxyPort, args.targetTitle);

            const wsUrl = rewriteInspectorWebSocketToLoopback(
                target.webSocketDebuggerUrl,
                proxyPort
            );

            this.sendEvent(
                new OutputEvent(
                    `[WhiteNeedle] 连接目标: ${target.title} (${wsUrl})\n`,
                    'console'
                )
            );

            if (args.verbose) {
                this.cdp.onProtocolLog = (msg: string) => {
                    this.sendEvent(new OutputEvent(`${msg}\n`, 'console'));
                };
            }

            await this.cdp.connectDirect(wsUrl);

            await this.enableInspectorDomains(target);

            this.inspectorHandshakeOk = true;
            this.sendEvent(new InitializedEvent());
            this.sendResponse(response);
        } catch (err: any) {
            this.inspectorHandshakeOk = false;
            try {
                this.cdp?.disconnect();
            } catch {
                /* ignore */
            }
            this.cdp = null;
            // 不在此处 stop ios_webkit_debug_proxy：失败时保留 9222 便于重试或 curl；结束会话时 disconnectRequest 仍会 cleanup
            const msg = err?.message || String(err);
            let hint = '';
            if (/domain was not found|'Debugger' domain/i.test(msg)) {
                hint =
                    '\n\n提示：该目标不支持 Debugger 域。' +
                    '若选的是 JSContext（标题 WhiteNeedle、url 为空），请改选 WKWebView 页面。' +
                    '若选的确实是 WKWebView 仍报此错，请确认：' +
                    '1) iOS 设备 Safari > Web Inspector 已开启；' +
                    '2) WKWebView.inspectable = YES（iOS 16.4+）；' +
                    '3) 查看 Debug Console 中 [CDPClient] 日志确认 Inspector.enable 是否成功。';
            }
            response.success = false;
            response.message = msg + hint;
            this.sendResponse(response);
        }
    }

    private async selectTarget(port: number, preferredTitle?: string): Promise<InspectorTarget> {
        const proxy = this.proxy ?? new WebKitProxy();
        const targets = await proxy.fetchTargets(port);

        if (targets.length === 0) {
            throw new Error(
                '未发现调试目标。请确认：\n' +
                '  1. iPhone 已通过 USB 连接\n' +
                '  2. Safari > Web Inspector 已开启\n' +
                '  3. WhiteNeedle App 正在运行'
            );
        }

        if (targets.length === 1) {
            return targets[0];
        }

        const ordered = orderTargetsForQuickPick(targets, preferredTitle);

        const vscode = await import('vscode');
        const items = ordered.map((t, i) => {
            const urlStr = (t.url || '').trim();
            const jscLike =
                urlStr.length === 0 &&
                /\b(whiteneedle|javascript|jscore|jscontext)\b/i.test(t.title || '');
            const label =
                (t.title || `Target ${i + 1}`) + (jscLike ? ' (JavaScriptCore)' : '');
            return {
                label,
                description: urlStr || '(无 page URL — 多为 JSContext)',
                detail: t.appId || '',
                target: t,
            };
        });

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要调试的目标 (JSContext / WKWebView)',
            ignoreFocusOut: true,
        });

        if (!picked) {
            throw new Error('用户取消了目标选择');
        }

        return picked.target;
    }

    /**
     * Initialise Inspector domains.  Handles two protocol variants:
     *
     * 1. **Direct WIP** (older iOS) — `Inspector.enable` → `Debugger.enable` etc.
     * 2. **Target-multiplexed** (iOS 17+) — at the top level only the `Target`
     *    domain exists.  We discover the page's targetId, enable wrapping in
     *    CDPClient, then send domain enable commands through the wrapper.
     */
    private async enableInspectorDomains(target: InspectorTarget): Promise<void> {
        const cdp = this.cdp!;

        // ---------- Strategy 1: try direct Inspector.enable ----------
        let directOk = false;
        try {
            await cdp.send('Inspector.enable', {});
            directOk = true;
            this.sendEvent(new OutputEvent('[WhiteNeedle] Inspector.enable 成功 (direct WIP)\n', 'console'));
        } catch (e: any) {
            this.sendEvent(
                new OutputEvent(
                    `[WhiteNeedle] Inspector.enable 失败 (${e.message})，尝试 Target-based 协议…\n`,
                    'console',
                ),
            );
        }

        if (directOk) {
            const isWebPage = !!(target.url && target.url.trim().length > 0);
            if (isWebPage) {
                await cdp.send('Page.enable', {}).catch(() => {});
            }
            await cdp.send('Debugger.enable', {});
            await cdp.send('Debugger.setBreakpointsActive', { active: true }).catch(() => {});
            await cdp.send('Runtime.enable', {});
            await cdp.send('Console.enable', {}).catch(() => {});
            return;
        }

        // ---------- Strategy 2: Target-based multiplexing (iOS 17+) ----------
        await this.setupTargetBasedProtocol(target);
    }

    /**
     * On iOS 17+, the WebSocket carries a multiplexed Target protocol.
     *
     * Discovery strategy:
     *  1. Target.getTargets (CDP-style)
     *  2. Target.setDiscoverTargets + listen for Target.targetCreated
     *  3. Brute-force probe common targetId formats
     */
    private async setupTargetBasedProtocol(target: InspectorTarget): Promise<void> {
        const cdp = this.cdp!;
        const out = (s: string) => this.sendEvent(new OutputEvent(s, 'console'));

        const eventTargets: Array<Record<string, unknown>> = [];
        const onCreated = (params: any) => {
            const info = params?.targetInfo || params;
            if (info) eventTargets.push(info);
        };
        cdp.on('Target.targetCreated', onCreated);

        // --- Attempt 1: Target.getTargets ---
        let listResult: any;
        try {
            listResult = await cdp.sendRaw('Target.getTargets', {}, 5000);
            out(`[WhiteNeedle] Target.getTargets → ${JSON.stringify(listResult).substring(0, 500)}\n`);
        } catch (e: any) {
            out(`[WhiteNeedle] Target.getTargets 失败: ${e.message}\n`);
        }

        const fromList: Array<Record<string, unknown>> =
            (listResult?.targetInfos ?? listResult?.targets ?? []) as any[];

        // --- Attempt 2: Target.setDiscoverTargets ---
        if (fromList.length === 0) {
            try {
                await cdp.sendRaw('Target.setDiscoverTargets', { discover: true }, 3000);
                out('[WhiteNeedle] Target.setDiscoverTargets(true) OK\n');
            } catch (e: any) {
                out(`[WhiteNeedle] Target.setDiscoverTargets 失败: ${e.message}\n`);
            }
            await new Promise((r) => setTimeout(r, 2000));
        }

        cdp.removeListener('Target.targetCreated', onCreated);

        const allDiscovered = [...fromList, ...eventTargets];
        out(`[WhiteNeedle] 已发现 ${allDiscovered.length} 个内部 Target: ${JSON.stringify(allDiscovered).substring(0, 600)}\n`);

        let innerTargetId: string | undefined;
        if (allDiscovered.length > 0) {
            const matched = allDiscovered.find(
                (t: any) =>
                    (t.title && target.title && t.title === target.title) ||
                    (t.url && target.url && t.url === target.url),
            );
            innerTargetId = String((matched || allDiscovered[0]).targetId);
        }

        // --- Attempt 3: brute-force probe ---
        if (!innerTargetId) {
            out('[WhiteNeedle] API 发现失败，逐个探测 targetId…\n');
            innerTargetId = await this.probeTargetId(target);
        }

        if (!innerTargetId) {
            throw new Error(
                '无法发现 Target-based 协议中的 targetId。\n' +
                'ios_webkit_debug_proxy 可能不完全兼容此 iOS 版本。\n' +
                '请尝试: 1) brew upgrade ios-webkit-debug-proxy\n' +
                '        2) 使用 Safari Web Inspector 作为替代',
            );
        }

        out(`[WhiteNeedle] Target-based: 使用 targetId=${innerTargetId}\n`);
        cdp.enableTargetWrapping(innerTargetId);

        await cdp.send('Inspector.enable', {}).catch(() => {});

        const isWebPage = !!(target.url && target.url.trim().length > 0);
        if (isWebPage) {
            await cdp.send('Page.enable', {}).catch(() => {});
        }

        await cdp.send('Debugger.enable', {});
        await cdp.send('Debugger.setBreakpointsActive', { active: true }).catch(() => {});
        await cdp.send('Runtime.enable', {});
        await cdp.send('Console.enable', {}).catch(() => {});
    }

    /**
     * Brute-force probe targetIds by sending a harmless
     * `Runtime.evaluate("1")` wrapped in Target.sendMessageToTarget.
     * The first ID that doesn't return "Missing target" wins.
     */
    private async probeTargetId(target: InspectorTarget): Promise<string | undefined> {
        const cdp = this.cdp!;
        const out = (s: string) => this.sendEvent(new OutputEvent(s, 'console'));

        const m = target.webSocketDebuggerUrl.match(/\/devtools\/page\/(\d+)/);
        const pageNum = m ? parseInt(m[1], 10) : 1;

        // Build candidate list — common formats from different WebKit versions
        const candidates: string[] = [];
        // "page-N" format (WebKit modern)
        for (let n = 1; n <= 10; n++) candidates.push(`page-${n}`);
        // Bare numbers
        for (let n = 1; n <= 10; n++) candidates.push(String(n));
        // "N.N" format sometimes used
        for (let n = 1; n <= 5; n++) candidates.push(`${n}.${n}`);

        // Prioritise the ones derived from the URL page number
        const preferred = [`page-${pageNum}`, String(pageNum), `${pageNum}.${pageNum}`];
        for (const p of preferred) {
            const idx = candidates.indexOf(p);
            if (idx > 0) {
                candidates.splice(idx, 1);
                candidates.unshift(p);
            }
        }

        for (const candidate of candidates) {
            try {
                const innerMsg = JSON.stringify({
                    id: 99999,
                    method: 'Runtime.evaluate',
                    params: { expression: '1', returnByValue: true },
                });

                await cdp.sendRaw(
                    'Target.sendMessageToTarget',
                    { targetId: candidate, message: innerMsg },
                    3000,
                );

                out(`[WhiteNeedle] 探测 targetId="${candidate}" → 成功!\n`);
                return candidate;
            } catch (e: any) {
                if (/missing target/i.test(e.message)) continue;
                out(`[WhiteNeedle] 探测 targetId="${candidate}" → ${e.message}\n`);
            }
        }

        out('[WhiteNeedle] 所有候选 targetId 均失败\n');
        return undefined;
    }

    private cleanupProxy(): void {
        if (this.proxy) {
            this.proxy.stop();
            this.proxy = null;
        }
    }

    protected async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        _args: DebugProtocol.ConfigurationDoneArguments
    ): Promise<void> {
        this.sendResponse(response);

        const scriptPath = this.launchArgs?.script;
        if (scriptPath && fs.existsSync(scriptPath)) {
            try {
                const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
                const wrappedScript = `${scriptContent}\n//# sourceURL=${scriptPath}`;
                this.sendEvent(
                    new OutputEvent(`[WhiteNeedle] Running: ${path.basename(scriptPath)}\n`, 'console')
                );

                // Use fire-and-forget for script evaluation.
                // If JSC hits a breakpoint, Debugger.paused fires as an async
                // event and the evaluate response arrives only after the script
                // finishes — so we must NOT await it or set a timeout.
                this.cdp!.sendFireAndForget('Runtime.evaluate', {
                    expression: wrappedScript,
                    generatePreview: true,
                });
            } catch (err: any) {
                this.sendEvent(
                    new OutputEvent(`[WhiteNeedle] Script error: ${err.message}\n`, 'stderr')
                );
            }
        }
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        const sourcePath = args.source.path || '';
        const clientLines = args.breakpoints || [];

        const oldBpIds = this.breakpoints.get(sourcePath) || [];
        for (const bpId of oldBpIds) {
            try {
                await this.cdp!.send('Debugger.removeBreakpoint', { breakpointId: bpId });
            } catch { /* ignore */ }
        }

        const newBpIds: string[] = [];
        const resultBps: Breakpoint[] = [];

        for (const bp of clientLines) {
            try {
                const scriptUrl = this.findScriptUrl(sourcePath);
                const result: CDPBreakpoint = await this.cdp!.send('Debugger.setBreakpointByUrl', {
                    lineNumber: this.convertClientLineToDebugger(bp.line) - 1,
                    url: scriptUrl,
                    columnNumber: bp.column ? bp.column - 1 : 0,
                });

                newBpIds.push(result.breakpointId);
                const loc = result.locations[0];
                resultBps.push(new Breakpoint(
                    true,
                    loc ? loc.lineNumber + 1 : bp.line
                ));
            } catch {
                resultBps.push(new Breakpoint(false));
            }
        }

        this.breakpoints.set(sourcePath, newBpIds);
        response.body = { breakpoints: resultBps };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [new Thread(THREAD_ID, 'WhiteNeedle JS')],
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): Promise<void> {
        const frames: StackFrame[] = this.pausedFrames.map((frame, idx) => {
            const scriptInfo = this.scriptSources.get(frame.location.scriptId);
            const sourceName = scriptInfo?.url || `script_${frame.location.scriptId}`;
            const source = new Source(path.basename(sourceName), sourceName);

            return new StackFrame(
                idx,
                frame.functionName || '(anonymous)',
                source,
                frame.location.lineNumber + 1,
                frame.location.columnNumber + 1
            );
        });

        const start = args.startFrame || 0;
        const count = args.levels || frames.length;

        response.body = {
            stackFrames: frames.slice(start, start + count),
            totalFrames: frames.length,
        };
        this.sendResponse(response);
    }

    private static scopeLabel(scope: CDPCallFrame['scopeChain'][0]): string {
        if (scope.name) return scope.name;
        switch (scope.type) {
            case 'local': return 'Local';
            case 'closure': return 'Closure';
            case 'global': return 'Global';
            case 'with': return 'With Block';
            case 'catch': return 'Catch';
            case 'functionName': return 'Function Name';
            case 'globalLexicalEnvironment': return 'Block';
            case 'nestedLexical': return 'Block';
            default: return scope.type;
        }
    }

    protected async scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ): Promise<void> {
        const frame = this.pausedFrames[args.frameId];
        const scopes: Scope[] = [];

        if (frame) {
            for (const scope of frame.scopeChain) {
                if (scope.empty) continue;
                const handle = this.createVarHandle(scope.object.objectId);
                const expensive = scope.type === 'global';
                scopes.push(new Scope(
                    WhiteNeedleDebugSession.scopeLabel(scope),
                    handle,
                    expensive,
                ));
            }

            if (frame.this?.objectId) {
                const thisHandle = this.createVarHandle(frame.this.objectId);
                scopes.push(new Scope('this', thisHandle, false));
            }
        }

        response.body = { scopes };
        this.sendResponse(response);
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const objectId = this.variableHandles.get(args.variablesReference);
        const getterInfo = this.getterHandles.get(args.variablesReference);
        const variables: Variable[] = [];

        if (getterInfo && this.cdp) {
            try {
                const evalResult: any = await this.cdp.send('Runtime.callFunctionOn', {
                    objectId: getterInfo.objectId,
                    functionDeclaration:
                        `function(){ try{ return this[${JSON.stringify(getterInfo.name)}]; }catch(e){ return "[Error] "+e.message; } }`,
                    generatePreview: true,
                    returnByValue: false,
                });
                const val = evalResult.result || {};
                if (val.objectId) {
                    // Object — fetch its properties directly so the user
                    // sees the contents without an extra expand level.
                    const propsResult: any = await this.cdp.send('Runtime.getProperties', {
                        objectId: val.objectId,
                        ownProperties: true,
                        generatePreview: true,
                    });
                    const props: any[] = propsResult.properties || propsResult.result || [];
                    for (const p of props) {
                        if (p.name === '__proto__') continue;
                        const pv = p.value || {};
                        let ref = 0;
                        if (pv.objectId) {
                            ref = this.createVarHandle(pv.objectId);
                        }
                        variables.push(new Variable(p.name, this.formatValue(pv), ref));
                    }
                } else {
                    variables.push(new Variable(
                        '[[Value]]', this.formatValue(val), 0));
                }
            } catch (err: any) {
                variables.push(new Variable(
                    '[[Error]]', err.message || 'evaluation failed', 0));
            }
            response.body = { variables };
            this.sendResponse(response);
            return;
        }

        if (objectId && this.cdp) {
            try {
                const result: any = await this.cdp.send('Runtime.getProperties', {
                    objectId,
                    ownProperties: false,
                    generatePreview: true,
                });

                const props: any[] = result.properties || result.result || [];

                for (const prop of props) {
                    if (prop.name === '__proto__') continue;

                    // Accessor properties: have get/set but no value.
                    // Resolve getter if available, otherwise skip.
                    let val: any;
                    if (prop.value) {
                        val = prop.value;
                    } else if (prop.get && prop.get.objectId) {
                        // This is an accessor (getter).  We'll show "[Getter]"
                        // and make it expandable via a lazy evaluation handle.
                        val = { _getter: true, _getterObjectId: prop.get.objectId };
                    } else if (prop.isAccessor) {
                        continue;
                    } else {
                        val = {};
                    }

                    let varRef = 0;
                    let displayValue: string;

                    if (val._getter) {
                        displayValue = '(...)';
                        const handle = this.nextVarHandle++;
                        this.getterHandles.set(handle, {
                            objectId: objectId!,
                            name: prop.name,
                        });
                        varRef = handle;
                    } else {
                        displayValue = this.formatValue(val);
                        if (val.objectId) {
                            varRef = this.createVarHandle(val.objectId);
                        }
                    }

                    variables.push(new Variable(
                        prop.name,
                        displayValue,
                        varRef,
                    ));
                }

                const internalProps: any[] = result.internalProperties || [];
                for (const prop of internalProps) {
                    const val = prop.value || {};
                    let varRef = 0;
                    if (val.objectId) {
                        varRef = this.createVarHandle(val.objectId);
                    }
                    variables.push(new Variable(
                        `[[${prop.name}]]`,
                        this.formatValue(val),
                        varRef,
                    ));
                }
            } catch (err: any) {
                console.error('[WhiteNeedle] Runtime.getProperties failed:', err.message);
            }
        }

        response.body = { variables };
        this.sendResponse(response);
    }

    protected continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments
    ): void {
        this.cdp?.sendFireAndForget('Debugger.resume', {});
        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
    }

    protected nextRequest(
        response: DebugProtocol.NextResponse,
        _args: DebugProtocol.NextArguments
    ): void {
        this.cdp?.sendFireAndForget('Debugger.stepOver', {});
        this.sendResponse(response);
    }

    protected stepInRequest(
        response: DebugProtocol.StepInResponse,
        _args: DebugProtocol.StepInArguments
    ): void {
        this.cdp?.sendFireAndForget('Debugger.stepInto', {});
        this.sendResponse(response);
    }

    protected stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        _args: DebugProtocol.StepOutArguments
    ): void {
        this.cdp?.sendFireAndForget('Debugger.stepOut', {});
        this.sendResponse(response);
    }

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        try {
            let callFrameId: string | undefined;
            if (args.frameId !== undefined && this.pausedFrames[args.frameId]) {
                callFrameId = this.pausedFrames[args.frameId].callFrameId;
            }

            let result: any;
            if (callFrameId) {
                result = await this.cdp!.send('Debugger.evaluateOnCallFrame', {
                    callFrameId,
                    expression: args.expression,
                    generatePreview: true,
                });
            } else {
                result = await this.cdp!.send('Runtime.evaluate', {
                    expression: args.expression,
                    generatePreview: true,
                });
            }

            if (result.wasThrown) {
                const errVal = result.result || {};
                response.success = false;
                response.message = errVal.description || errVal.value || 'Evaluation error';
                this.sendResponse(response);
                return;
            }

            const val = result.result || {};
            let varRef = 0;
            if (val.objectId && (val.type === 'object' || val.subtype === 'array')) {
                varRef = this.createVarHandle(val.objectId);
            }

            response.body = {
                result: this.formatValue(val),
                variablesReference: varRef,
            };
            this.sendResponse(response);
        } catch (err: any) {
            response.success = false;
            response.message = err.message;
            this.sendResponse(response);
        }
    }

    protected async terminateRequest(
        response: DebugProtocol.TerminateResponse,
        _args: DebugProtocol.TerminateArguments
    ): Promise<void> {
        this.inspectorHandshakeOk = false;
        this.cdp?.disconnect();
        this.cleanupProxy();
        this.sendResponse(response);
    }

    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): void {
        this.inspectorHandshakeOk = false;
        this.cdp?.disconnect();
        this.cleanupProxy();
        this.sendResponse(response);
    }

    private findScriptUrl(sourcePath: string): string {
        const baseName = path.basename(sourcePath);
        for (const [, info] of this.scriptSources) {
            if (info.url.includes(baseName)) {
                return info.url;
            }
        }
        return sourcePath;
    }

    private createVarHandle(objectId: string): number {
        const handle = this.nextVarHandle++;
        this.variableHandles.set(handle, objectId);
        return handle;
    }

    private formatValue(val: any): string {
        if (!val) return 'undefined';
        if (val.type === 'undefined') return 'undefined';
        if (val.type === 'string') return `"${val.value}"`;
        if (val.subtype === 'null') return 'null';

        if (val.type === 'number') {
            // JSON cannot represent NaN / Infinity — WebKit sends value:null
            // but sets description to "NaN" or "Infinity".
            if (val.value === null || val.value === undefined) {
                return val.description ?? 'NaN';
            }
            return String(val.value);
        }
        if (val.type === 'boolean') return String(val.value);

        if (val.type === 'symbol') return val.description || 'Symbol()';
        if (val.type === 'bigint') return `${val.description || val.value}n`;
        if (val.type === 'function') {
            return val.description?.split('\n')[0] || 'function()';
        }

        if (val.type === 'object') {
            if (val.preview) return this.formatPreview(val.preview, val.className);
            if (val.description) return val.description;
            if (val.className) return val.className;
            return 'Object';
        }

        // WebKit sometimes omits `type` for global host objects (window, document).
        // Fall through to description / className before giving up.
        if (val.value !== undefined) return String(val.value);
        if (val.description) return val.description;
        if (val.className) return val.className;
        if (val.objectId) return val.type === 'undefined' ? 'undefined' : 'Object';
        return val.type || 'unknown';
    }

    private formatPreview(preview: any, fallbackClass?: string): string {
        if (!preview || !preview.properties) {
            return preview?.description || fallbackClass || 'Object';
        }

        const isArray = preview.subtype === 'array';
        const entries = (preview.properties as any[]).map((p: any) => {
            const v = p.type === 'string' ? `"${p.value}"` : (p.value ?? p.subtype ?? p.type);
            return isArray ? String(v) : `${p.name}: ${v}`;
        });

        if (preview.overflow) entries.push('…');

        if (isArray) {
            const len = preview.description?.match(/\d+/)?.[0];
            return `Array(${len ?? entries.length}) [${entries.join(', ')}]`;
        }

        const cls = preview.description || fallbackClass || 'Object';
        return `${cls} {${entries.join(', ')}}`;
    }
}
