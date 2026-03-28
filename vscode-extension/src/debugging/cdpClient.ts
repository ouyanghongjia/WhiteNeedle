import { EventEmitter } from 'events';
import * as http from 'http';
import WebSocket from 'ws';

/**
 * Chrome DevTools Protocol client.
 * Connects to a V8 Inspector WebSocket endpoint and provides
 * typed request/response and event handling.
 */

interface CDPMessage {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
}

export class CDPClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (result: any) => void;
        reject: (err: Error) => void;
    }>();

    async connect(host: string, port: number): Promise<void> {
        const wsUrl = await this.discoverWebSocketUrl(host, port);

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
                reject(err);
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

    async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to CDP');
        }

        const id = this.nextId++;
        const message: CDPMessage = { id, method, params };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, 15000);

            this.pending.set(id, {
                resolve: (result) => { clearTimeout(timeout); resolve(result); },
                reject: (err) => { clearTimeout(timeout); reject(err); },
            });

            this.ws!.send(JSON.stringify(message));
        });
    }

    private handleMessage(raw: string): void {
        let msg: CDPMessage;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

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
        return new Promise((resolve, reject) => {
            const req = http.get(`http://${host}:${port}/json`, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    try {
                        const targets = JSON.parse(body);
                        const target = targets.find((t: any) =>
                            t.webSocketDebuggerUrl
                        );
                        if (target) {
                            resolve(target.webSocketDebuggerUrl);
                        } else {
                            resolve(`ws://${host}:${port}`);
                        }
                    } catch {
                        resolve(`ws://${host}:${port}`);
                    }
                });
            });

            req.on('error', () => {
                resolve(`ws://${host}:${port}`);
            });

            req.setTimeout(3000, () => {
                req.destroy();
                resolve(`ws://${host}:${port}`);
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
