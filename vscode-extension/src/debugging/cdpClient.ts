import { EventEmitter } from 'events';
import * as http from 'http';
import WebSocket from 'ws';

/**
 * Inspector protocol client for WebKit Inspector Protocol (WIP).
 *
 * Connects via WebSocket — either directly or discovered from
 * ios_webkit_debug_proxy's HTTP /json listing.
 *
 * ## iOS 17+ Target-based protocol
 *
 * On iOS 17+, ios_webkit_debug_proxy exposes a **target-multiplexed**
 * connection.  At the top level only the `Target` domain is available.
 * All other domain commands must be wrapped:
 *
 *   → Target.sendMessageToTarget({ targetId, message: JSON.stringify(…) })
 *   ← Target.dispatchMessageFromTarget({ targetId, message: JSON.stringify(…) })
 *
 * Call `enableTargetWrapping(targetId)` after discovery to make
 * `send()` transparently wrap / unwrap messages.
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

export type LogCallback = (msg: string) => void;

export class CDPClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (result: any) => void;
        reject: (err: Error) => void;
    }>();

    /** If set, protocol messages are forwarded here (Debug Console). */
    public onProtocolLog: LogCallback | null = null;

    /** When non-null, send() wraps commands in Target.sendMessageToTarget. */
    private targetWrappingId: string | null = null;

    private innerPending = new Map<number, {
        resolve: (result: any) => void;
        reject: (err: Error) => void;
    }>();
    private innerNextId = 1;

    private log(msg: string): void {
        if (this.onProtocolLog) this.onProtocolLog(msg);
    }

    enableTargetWrapping(targetId: string): void {
        this.targetWrappingId = targetId;
        this.log(`[CDPClient] Target wrapping enabled (targetId=${targetId})`);
    }

    // ------------------------------------------------------------------ connect

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

        return this.openSocket(wsUrl);
    }

    async connectDirect(wsUrl: string): Promise<void> {
        return this.openSocket(wsUrl);
    }

    private openSocket(wsUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            this.ws = ws;

            ws.on('open', () => resolve());
            ws.on('message', (data: WebSocket.Data) => this.handleMessage(data.toString()));
            ws.on('close', () => {
                this.rejectAll(new Error('WebSocket closed'));
                this.emit('close');
            });
            ws.on('error', (err) => {
                reject(new Error(`无法连接 Inspector WebSocket: ${err.message}\nURL: ${wsUrl}`));
                this.emit('error', err);
            });
        });
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.rejectAll(new Error('Disconnected'));
    }

    // ------------------------------------------------------------------ send

    /**
     * Send a method call.  If target wrapping is enabled the message is
     * transparently wrapped in Target.sendMessageToTarget.
     */
    async send(
        method: string,
        params: Record<string, unknown> = {},
        timeoutMs: number = 15000,
    ): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to Inspector');
        }
        if (this.targetWrappingId) {
            return this.sendViaTarget(method, params, timeoutMs);
        }
        return this.sendRaw(method, params, timeoutMs);
    }

    /**
     * Send a raw (unwrapped) method call — used for top-level Target domain
     * commands or when target wrapping is not enabled.
     */
    sendRaw(
        method: string,
        params: Record<string, unknown> = {},
        timeoutMs: number = 15000,
    ): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('Not connected to Inspector'));
        }
        const id = this.nextId++;
        const message: InspectorMessage = { id, method, params };

        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`Inspector timeout: ${method}`));
                }, timeoutMs);
            }
            this.pending.set(id, {
                resolve: (r) => { if (timer) clearTimeout(timer); resolve(r); },
                reject:  (e) => { if (timer) clearTimeout(timer); reject(e); },
            });
            const json = JSON.stringify(message);
            this.log(`[CDPClient] → ${json.substring(0, 300)}`);
            this.ws!.send(json);
        });
    }

    private sendViaTarget(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number,
    ): Promise<any> {
        const innerId = this.innerNextId++;
        const innerMsg = JSON.stringify({ id: innerId, method, params });

        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    this.innerPending.delete(innerId);
                    reject(new Error(`Inspector timeout (target-wrapped): ${method}`));
                }, timeoutMs);
            }
            this.innerPending.set(innerId, {
                resolve: (r) => { if (timer) clearTimeout(timer); resolve(r); },
                reject:  (e) => { if (timer) clearTimeout(timer); reject(e); },
            });

            this.log(`[CDPClient] → Target.sendMessageToTarget(${method})`);
            this.sendRaw('Target.sendMessageToTarget', {
                targetId: this.targetWrappingId!,
                message: innerMsg,
            }, 0).catch((err) => {
                this.innerPending.delete(innerId);
                if (timer) clearTimeout(timer);
                reject(err);
            });
        });
    }

    sendFireAndForget(method: string, params: Record<string, unknown> = {}): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        if (this.targetWrappingId) {
            const innerId = this.innerNextId++;
            const innerMsg = JSON.stringify({ id: innerId, method, params });
            this.log(`[CDPClient] → fire-and-forget Target.sendMessageToTarget(${method})`);
            this.sendRaw('Target.sendMessageToTarget', {
                targetId: this.targetWrappingId,
                message: innerMsg,
            }, 0).catch(() => {});
            return;
        }

        const id = this.nextId++;
        const message: InspectorMessage = { id, method, params };
        const json = JSON.stringify(message);
        this.log(`[CDPClient] → fire-and-forget: ${json.substring(0, 200)}`);
        this.ws!.send(json);
    }

    // ------------------------------------------------------------------ receive

    private handleMessage(raw: string): void {
        this.log(`[CDPClient] ← ${raw.substring(0, 300)}`);

        let msg: InspectorMessage;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            this.log(`[CDPClient] ← JSON parse error: ${e}`);
            return;
        }

        // Unwrap Target.dispatchMessageFromTarget
        if (msg.method === 'Target.dispatchMessageFromTarget' && msg.params) {
            const innerRaw = msg.params.message as string | undefined;
            if (innerRaw) this.handleInnerMessage(innerRaw);
            return;
        }

        if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetDestroyed') {
            this.emit(msg.method, msg.params);
        }

        msg = this.translateIncoming(msg);

        if (msg.id !== undefined) {
            const pending = this.pending.get(msg.id);
            if (pending) {
                this.pending.delete(msg.id);
                if (msg.error) pending.reject(new Error(msg.error.message));
                else pending.resolve(msg.result || {});
            }
        } else if (msg.method) {
            this.emit(msg.method, msg.params);
        }
    }

    private handleInnerMessage(raw: string): void {
        this.log(`[CDPClient] ← (inner) ${raw.substring(0, 300)}`);

        let msg: InspectorMessage;
        try { msg = JSON.parse(raw); } catch { return; }

        msg = this.translateIncoming(msg);

        if (msg.id !== undefined) {
            const pending = this.innerPending.get(msg.id);
            if (pending) {
                this.innerPending.delete(msg.id);
                if (msg.error) pending.reject(new Error(msg.error.message));
                else pending.resolve(msg.result || {});
            }
        } else if (msg.method) {
            this.emit(msg.method, msg.params);
        }
    }

    // ------------------------------------------------------------------ translate

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

    // ------------------------------------------------------------------ discover

    private async discoverWebSocketUrl(host: string, port: number): Promise<string> {
        const jsonUrl = `http://${host}:${port}/json`;

        return new Promise((resolve, reject) => {
            const req = http.get(jsonUrl, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(
                            `GET ${jsonUrl} 返回 HTTP ${res.statusCode}。` +
                            '请确认 WhiteNeedle App 已运行且 Inspector 端口可访问。'
                        ));
                        return;
                    }
                    let targets: unknown;
                    try { targets = JSON.parse(body); } catch {
                        reject(new Error(
                            `GET ${jsonUrl} 的响应不是合法 JSON。` +
                            '请确认连接的是 Inspector 端口 9222，而非引擎端口 27042。'
                        ));
                        return;
                    }
                    if (!Array.isArray(targets)) {
                        reject(new Error(`GET ${jsonUrl} 未返回 JSON 数组。`));
                        return;
                    }
                    const t = (targets as any[]).find((x) => x && x.webSocketDebuggerUrl);
                    if (!t?.webSocketDebuggerUrl) {
                        reject(new Error(`${jsonUrl} 中没有带 webSocketDebuggerUrl 的调试目标。`));
                        return;
                    }
                    resolve(t.webSocketDebuggerUrl as string);
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
        for (const [, p] of this.pending) p.reject(err);
        this.pending.clear();
        for (const [, p] of this.innerPending) p.reject(err);
        this.innerPending.clear();
    }
}
