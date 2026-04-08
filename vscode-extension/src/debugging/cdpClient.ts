import { EventEmitter } from 'events';
import * as http from 'http';
import WebSocket from 'ws';

/**
 * Inspector protocol client.
 *
 * Connects to a WebKit Inspector Protocol (WIP) endpoint — either directly
 * via a WebSocket URL, or by discovering one from ios_webkit_debug_proxy's
 * HTTP /json listing. WIP is very similar to CDP — both use JSON-RPC over
 * WebSocket with the same core domains (Debugger, Runtime, Console).
 *
 * This client handles the minor WIP ↔ CDP translation needed for DAP.
 */

interface InspectorMessage {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: { code: number; message: string; data?: unknown };
}

/** Default Inspector port (ios_webkit_debug_proxy default for first device) */
export const DEFAULT_INSPECTOR_PORT = 9222;

export class CDPClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (result: any) => void;
        reject: (err: Error) => void;
    }>();

    async connect(host: string, port: number = DEFAULT_INSPECTOR_PORT, rewriteWsHost?: string): Promise<void> {
        let wsUrl = await this.discoverWebSocketUrl(host, port);

        if (rewriteWsHost) {
            try {
                const url = new URL(wsUrl);
                url.hostname = rewriteWsHost;
                url.port = String(port);
                wsUrl = url.toString();
            } catch { /* keep original */ }
        }

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            this.ws = ws;

            ws.on('open', () => {
                resolve();
            });

            ws.on('message', (data: WebSocket.Data) => {
                this.handleMessage(data.toString());
            });

            ws.on('close', () => {
                this.rejectAll(new Error('WebSocket closed'));
                this.emit('close');
            });

            ws.on('error', (err) => {
                reject(CDPClient.wrapConnectionError(err, host, port, wsUrl));
                this.emit('error', err);
            });
        });
    }

    /**
     * Connect directly to a known WebSocket URL (e.g. from ios_webkit_debug_proxy).
     */
    async connectDirect(wsUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            this.ws = ws;

            ws.on('open', () => {
                resolve();
            });

            ws.on('message', (data: WebSocket.Data) => {
                this.handleMessage(data.toString());
            });

            ws.on('close', () => {
                this.rejectAll(new Error('WebSocket closed'));
                this.emit('close');
            });

            ws.on('error', (err) => {
                reject(new Error(
                    `无法连接 Inspector WebSocket: ${err.message}\nURL: ${wsUrl}`
                ));
                this.emit('error', err);
            });
        });
    }

    private static wrapConnectionError(
        err: Error,
        host: string,
        port: number,
        wsUrl: string
    ): Error {
        const msg = err.message || String(err);
        const hint =
            'ios_webkit_debug_proxy 默认在端口 9222 提供调试目标。请确认：\n' +
            '  1. iOS 设备已运行包含 WhiteNeedle 的 App\n' +
            '  2. iPhone 已通过 USB 连接到 Mac\n' +
            '  3. 已安装: brew install ios-webkit-debug-proxy\n' +
            '  4. Settings > Safari > Advanced > Web Inspector 已开启\n' +
            '详情见 docs/inspector-vscode.md';
        if (/hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
            return new Error(
                `无法连接 Inspector WebSocket（${msg}）\n已尝试: ${wsUrl}\n${hint}`
            );
        }
        return err;
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.rejectAll(new Error('Disconnected'));
    }

    /**
     * Send a CDP/WIP method call and await the response.
     *
     * WIP and CDP share the same JSON-RPC format with `id`, `method`, `params`.
     * The core debugging domains (Debugger, Runtime, Console) are compatible.
     */
    /**
     * @param timeoutMs  Timeout in milliseconds. 0 = no timeout (wait forever).
     *                   Defaults to 15 000 ms.
     */
    async send(
        method: string,
        params: Record<string, unknown> = {},
        timeoutMs: number = 15000,
    ): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to Inspector');
        }

        const translated = CDPClient.translateOutgoing(method, params);
        const id = this.nextId++;
        const message: InspectorMessage = { id, method: translated.method, params: translated.params };

        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`Inspector timeout: ${method}`));
                }, timeoutMs);
            }

            this.pending.set(id, {
                resolve: (result) => { if (timer) clearTimeout(timer); resolve(result); },
                reject: (err) => { if (timer) clearTimeout(timer); reject(err); },
            });

            const json = JSON.stringify(message);
            console.log(`[CDPClient] → send (${json.length} bytes): ${json.substring(0, 200)}`);
            this.ws!.send(json);
        });
    }

    /** Fire-and-forget: send a message without waiting for a response. */
    sendFireAndForget(method: string, params: Record<string, unknown> = {}): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const translated = CDPClient.translateOutgoing(method, params);
        const id = this.nextId++;
        const message: InspectorMessage = { id, method: translated.method, params: translated.params };
        const json = JSON.stringify(message);
        console.log(`[CDPClient] → fire-and-forget (${json.length} bytes): ${json.substring(0, 200)}`);
        this.ws!.send(json);
    }

    /**
     * Translate outgoing CDP methods to WIP equivalents where they differ.
     *
     * Most methods are identical. Key differences:
     *   CDP: Debugger.setBreakpointByUrl({url, lineNumber, columnNumber})
     *   WIP: Debugger.setBreakpointByUrl({url, lineNumber, columnNumber})  ← actually the same
     *
     *   CDP: Runtime.callFunctionOn({functionDeclaration, objectId, ...})
     *   WIP: Runtime.callFunctionOn({functionDeclaration, objectId, ...})  ← same
     *
     * The protocols are nearly identical for the Debugger/Runtime/Console domains.
     */
    private static translateOutgoing(
        method: string,
        params: Record<string, unknown>
    ): { method: string; params: Record<string, unknown> } {
        /* CDP→WIP: no translation needed for core domains */
        return { method, params };
    }

    /**
     * Translate incoming WIP events/responses to CDP equivalents.
     *
     * Known differences:
     *   WIP: Console.messageAdded({message: {source, level, text, ...}})
     *   CDP: Runtime.consoleAPICalled({type, args, ...})
     *
     *   WIP: Debugger.scriptParsed includes `sourceURL` (sometimes instead of `url`)
     */
    private translateIncoming(msg: InspectorMessage): InspectorMessage {
        if (msg.method === 'Console.messageAdded' && msg.params) {
            const wipMsg = msg.params.message as Record<string, unknown> | undefined;
            if (wipMsg) {
                this.emit('Runtime.consoleAPICalled', {
                    type: wipMsg.level || 'log',
                    args: [{ type: 'string', value: wipMsg.text || '' }],
                    timestamp: Date.now(),
                });
            }
        }
        return msg;
    }

    private handleMessage(raw: string): void {
        console.log(`[CDPClient] ← recv (${raw.length} bytes): ${raw.substring(0, 200)}`);

        let msg: InspectorMessage;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            console.error(`[CDPClient] ← JSON parse error: ${e}. Raw: ${raw.substring(0, 100)}`);
            return;
        }

        msg = this.translateIncoming(msg);

        if (msg.id !== undefined) {
            const pending = this.pending.get(msg.id);
            if (pending) {
                this.pending.delete(msg.id);
                if (msg.error) {
                    pending.reject(new Error(msg.error.message));
                } else {
                    pending.resolve(msg.result || {});
                }
            }
        } else if (msg.method) {
            this.emit(msg.method, msg.params);
        }
    }

    private async discoverWebSocketUrl(host: string, port: number): Promise<string> {
        const jsonUrl = `http://${host}:${port}/json`;

        return new Promise((resolve, reject) => {
            const req = http.get(jsonUrl, (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(
                            `GET ${jsonUrl} 返回 HTTP ${res.statusCode}。` +
                            '请确认 WhiteNeedle App 已运行且 Inspector 端口（默认 9222）可访问。'
                        ));
                        return;
                    }
                    let targets: unknown;
                    try {
                        targets = JSON.parse(body);
                    } catch {
                        reject(new Error(
                            `GET ${jsonUrl} 的响应不是合法 JSON。` +
                            '请确认连接的是 Inspector 端口 9222，而非引擎端口 27042。'
                        ));
                        return;
                    }
                    if (!Array.isArray(targets)) {
                        reject(new Error(
                            `GET ${jsonUrl} 未返回 JSON 数组（目标列表）。`
                        ));
                        return;
                    }
                    const target = (targets as any[]).find((t) => t && t.webSocketDebuggerUrl);
                    if (!target?.webSocketDebuggerUrl) {
                        reject(new Error(
                            `${jsonUrl} 中没有带 webSocketDebuggerUrl 的调试目标。`
                        ));
                        return;
                    }
                    resolve(target.webSocketDebuggerUrl as string);
                });
            });

            req.on('error', (err) => {
                reject(new Error(
                    `无法访问 ${jsonUrl}（${err.message}）。` +
                    '请确认设备与电脑在同一网络，且 WhiteNeedle App 已运行。'
                ));
            });

            req.setTimeout(8000, () => {
                req.destroy();
                reject(new Error(`访问 ${jsonUrl} 超时（8 秒）。`));
            });
        });
    }

    private rejectAll(err: Error): void {
        for (const [, pending] of this.pending) {
            pending.reject(err);
        }
        this.pending.clear();
    }
}
