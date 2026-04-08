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
import * as path from 'path';
import * as fs from 'fs';

interface WhiteNeedleLaunchArgs extends DebugProtocol.LaunchRequestArguments {
    host: string;
    inspectorPort: number;
    script?: string;
    useUSB?: boolean;
    /** Preferred target title (e.g. "WhiteNeedle"). Auto-selects if matched. */
    targetTitle?: string;
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

export class WhiteNeedleDebugSession extends DebugSession {
    private cdp: CDPClient | null = null;
    private proxy: WebKitProxy | null = null;
    private launchArgs: WhiteNeedleLaunchArgs | null = null;
    private scriptSources = new Map<string, { url: string; source?: string }>();
    private breakpoints = new Map<string, string[]>();
    private pausedFrames: CDPCallFrame[] = [];
    private variableHandles = new Map<number, string>();
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
                this.cleanupProxy();
                this.sendEvent(new TerminatedEvent());
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
                await this.proxy.start(proxyPort);
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

            const wsUrl = target.webSocketDebuggerUrl.replace(
                /ws:\/\/[^/]+/,
                `ws://127.0.0.1:${proxyPort}`
            );

            this.sendEvent(
                new OutputEvent(
                    `[WhiteNeedle] 连接目标: ${target.title} (${wsUrl})\n`,
                    'console'
                )
            );

            await this.cdp.connectDirect(wsUrl);
            await this.cdp.send('Debugger.enable', {});
            await this.cdp.send('Debugger.setBreakpointsActive', { active: true }).catch(() => {});
            await this.cdp.send('Runtime.enable', {});
            await this.cdp.send('Console.enable', {}).catch(() => {});

            this.sendEvent(new InitializedEvent());
            this.sendResponse(response);
        } catch (err: any) {
            this.cleanupProxy();
            response.success = false;
            response.message = err.message;
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

        if (preferredTitle) {
            const match = targets.find(
                t => t.title.toLowerCase() === preferredTitle.toLowerCase()
            );
            if (match) return match;
        }

        if (targets.length === 1) {
            return targets[0];
        }

        const vscode = await import('vscode');
        const items = targets.map((t, i) => ({
            label: t.title || `Target ${i + 1}`,
            description: t.url || '',
            detail: t.appId || '',
            target: t,
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要调试的目标 (JSContext / WKWebView)',
            ignoreFocusOut: true,
        });

        if (!picked) {
            throw new Error('用户取消了目标选择');
        }

        return picked.target;
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
        const variables: Variable[] = [];

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
                    if (prop.isAccessor && !prop.value) continue;

                    const val = prop.value || {};
                    let varRef = 0;
                    if (val.objectId && (val.type === 'object' || val.subtype === 'array')) {
                        varRef = this.createVarHandle(val.objectId);
                    }

                    variables.push(new Variable(
                        prop.name,
                        this.formatValue(val),
                        varRef,
                    ));
                }

                const internalProps: any[] = result.internalProperties || [];
                for (const prop of internalProps) {
                    const val = prop.value || {};
                    let varRef = 0;
                    if (val.objectId && (val.type === 'object' || val.subtype === 'array')) {
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
        this.cdp?.disconnect();
        this.cleanupProxy();
        this.sendResponse(response);
    }

    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): void {
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
        if (val.type === 'boolean' || val.type === 'number') return String(val.value);
        if (val.subtype === 'null') return 'null';

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

        if (val.value !== undefined) return String(val.value);
        if (val.description) return val.description;
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
