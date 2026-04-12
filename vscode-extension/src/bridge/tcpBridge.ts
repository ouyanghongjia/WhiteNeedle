import * as net from 'net';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params: Record<string, unknown>;
}

const HEARTBEAT_INTERVAL_MS = 15000;
/** Must exceed worst-case main-queue stall on device (e.g. loadScript) if ping were ever queued there. */
const HEARTBEAT_TIMEOUT_MS = 25000;

export class TcpBridge extends EventEmitter {
    private socket: net.Socket | null = null;
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (err: Error) => void;
    }>();
    private buffer = '';
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private heartbeatPending = false;
    private _disposed = false;

    constructor(private outputChannel: vscode.OutputChannel) {
        super();
    }

    get isConnected(): boolean {
        return this.socket !== null && !this.socket.destroyed && !this._disposed;
    }

    async connect(host: string, port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (fn: typeof resolve | typeof reject, val?: any) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timeout);
                fn(val);
            };

            this.socket = new net.Socket();
            this.socket.setKeepAlive(true, 5000);

            const timeout = setTimeout(() => {
                this.socket?.destroy();
                settle(reject, new Error(`Connection timeout to ${host}:${port}`));
            }, 10000);

            this.socket.connect(port, host, () => {
                this.outputChannel.appendLine(`[TcpBridge] Connected to ${host}:${port}`);
                this.startHeartbeat();
                settle(resolve);
            });

            this.socket.on('data', (data: Buffer) => {
                this.buffer += data.toString('utf8');
                this.processBuffer();
            });

            this.socket.on('error', (err) => {
                this.outputChannel.appendLine(`[TcpBridge] Error: ${err.message}`);
                this.rejectAllPending(err);
                settle(reject, err);
            });

            this.socket.on('close', () => {
                if (this._disposed) { return; }
                this._disposed = true;
                this.outputChannel.appendLine('[TcpBridge] Connection closed');
                this.stopHeartbeat();
                this.rejectAllPending(new Error('Connection closed'));
                this.socket = null;
                this.emit('disconnected');
            });
        });
    }

    disconnect(): void {
        if (this._disposed) { return; }
        this._disposed = true;
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.rejectAllPending(new Error('Disconnected'));
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.isConnected || this.heartbeatPending) {
                return;
            }
            // Avoid ping while another RPC is in flight — iOS used to queue ping behind loadScript and miss the deadline.
            if (this.pending.size > 0) {
                return;
            }
            this.heartbeatPending = true;
            const timer = setTimeout(() => {
                if (this.heartbeatPending) {
                    this.outputChannel.appendLine('[TcpBridge] Heartbeat timeout — connection lost');
                    this.socket?.destroy();
                }
            }, HEARTBEAT_TIMEOUT_MS);

            this.call('ping', {})
                .then(() => {
                    this.heartbeatPending = false;
                    clearTimeout(timer);
                })
                .catch(() => {
                    this.heartbeatPending = false;
                    clearTimeout(timer);
                });
        }, HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.heartbeatPending = false;
    }

    async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }

        const id = this.nextId++;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timeout waiting for response to ${method}`));
            }, 30000);

            this.pending.set(id, {
                resolve: (val) => { clearTimeout(timeout); resolve(val); },
                reject: (err) => { clearTimeout(timeout); reject(err); },
            });

            this.socket!.write(JSON.stringify(request) + '\n');
        });
    }

    private processBuffer(): void {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }

            try {
                const msg = JSON.parse(trimmed);
                if ('id' in msg && msg.id !== undefined) {
                    this.handleResponse(msg as JsonRpcResponse);
                } else if ('method' in msg) {
                    this.handleNotification(msg as JsonRpcNotification);
                }
            } catch {
                this.outputChannel.appendLine(`[TcpBridge] Unparsed: ${trimmed}`);
            }
        }
    }

    private handleResponse(response: JsonRpcResponse): void {
        const pending = this.pending.get(response.id);
        if (!pending) { return; }

        this.pending.delete(response.id);

        if (response.error) {
            pending.reject(new Error(response.error.message));
        } else {
            pending.resolve(response.result);
        }
    }

    private handleNotification(notification: JsonRpcNotification): void {
        this.emit(notification.method, notification.params);
    }

    private rejectAllPending(err: Error): void {
        for (const [, pending] of this.pending) {
            pending.reject(err);
        }
        this.pending.clear();
    }
}
