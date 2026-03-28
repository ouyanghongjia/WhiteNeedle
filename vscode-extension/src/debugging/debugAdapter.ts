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
import * as path from 'path';

interface WhiteNeedleLaunchArgs extends DebugProtocol.LaunchRequestArguments {
    host: string;
    inspectorPort: number;
    script?: string;
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
        object: { objectId: string };
        name?: string;
    }>;
    this: { objectId?: string };
}

const THREAD_ID = 1;

export class WhiteNeedleDebugSession extends DebugSession {
    private cdp: CDPClient | null = null;
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
            this.cdp = new CDPClient();

            this.cdp.on('Debugger.scriptParsed', (params: any) => {
                this.scriptSources.set(params.scriptId, {
                    url: params.url || `script_${params.scriptId}`,
                    source: undefined,
                });
            });

            this.cdp.on('Debugger.paused', (params: any) => {
                this.pausedFrames = params.callFrames || [];
                const reason = params.reason === 'other' ? 'breakpoint' : params.reason;
                this.sendEvent(new StoppedEvent(reason, THREAD_ID));
            });

            this.cdp.on('Debugger.resumed', () => {
                this.pausedFrames = [];
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
                this.sendEvent(new TerminatedEvent());
            });

            await this.cdp.connect(args.host, args.inspectorPort);
            await this.cdp.send('Debugger.enable', {});
            await this.cdp.send('Runtime.enable', {});

            this.sendEvent(new InitializedEvent());
            this.sendResponse(response);
        } catch (err: any) {
            response.success = false;
            response.message = err.message;
            this.sendResponse(response);
        }
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        _args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
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
            threads: [new Thread(THREAD_ID, 'Frida JS')],
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

    protected async scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ): Promise<void> {
        const frame = this.pausedFrames[args.frameId];
        const scopes: Scope[] = [];

        if (frame) {
            for (const scope of frame.scopeChain) {
                const handle = this.createVarHandle(scope.object.objectId);
                const scopeName = scope.name || scope.type;
                const expensive = scope.type === 'global';
                scopes.push(new Scope(scopeName, handle, expensive));
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
                    ownProperties: true,
                    generatePreview: true,
                });

                for (const prop of (result.result || [])) {
                    if (prop.name === '__proto__') continue;

                    const val = prop.value || {};
                    let varRef = 0;
                    if (val.objectId && val.type === 'object') {
                        varRef = this.createVarHandle(val.objectId);
                    }

                    variables.push(new Variable(
                        prop.name,
                        this.formatValue(val),
                        varRef
                    ));
                }
            } catch { /* ignore */ }
        }

        response.body = { variables };
        this.sendResponse(response);
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments
    ): Promise<void> {
        await this.cdp?.send('Debugger.resume', {});
        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
    }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        _args: DebugProtocol.NextArguments
    ): Promise<void> {
        await this.cdp?.send('Debugger.stepOver', {});
        this.sendResponse(response);
    }

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        _args: DebugProtocol.StepInArguments
    ): Promise<void> {
        await this.cdp?.send('Debugger.stepInto', {});
        this.sendResponse(response);
    }

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        _args: DebugProtocol.StepOutArguments
    ): Promise<void> {
        await this.cdp?.send('Debugger.stepOut', {});
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

            const val = result.result || {};
            let varRef = 0;
            if (val.objectId && val.type === 'object') {
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
        this.sendResponse(response);
    }

    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): void {
        this.cdp?.disconnect();
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
        if (val.type === 'undefined') return 'undefined';
        if (val.type === 'string') return `"${val.value}"`;
        if (val.value !== undefined) return String(val.value);
        if (val.description) return val.description;
        if (val.className) return `[${val.className}]`;
        return val.type || 'unknown';
    }
}
