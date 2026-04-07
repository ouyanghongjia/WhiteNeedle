/**
 * Integration tests for TcpBridge — the real TCP client used by the VSCode extension.
 *
 * Spins up a local TCP server simulating a WhiteNeedle device, then exercises
 * TcpBridge over real TCP: connection lifecycle, JSON-RPC methods, heartbeat,
 * notifications, concurrency, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';

vi.mock('vscode', () => {
    const lines: string[] = [];
    return {
        OutputChannel: class {},
        window: {
            createOutputChannel: () => ({
                appendLine: (msg: string) => lines.push(msg),
                show: () => {},
                dispose: () => {},
            }),
        },
        __getLines: () => lines,
        __clearLines: () => { lines.length = 0; },
    };
});

import { TcpBridge } from '../bridge/tcpBridge.js';

// ---------------------------------------------------------------------------
// Fake Device Server
// ---------------------------------------------------------------------------

const NO_RESPONSE = Symbol('NO_RESPONSE');

type Handler = (
    method: string,
    params: Record<string, unknown>,
) => unknown | typeof NO_RESPONSE;

function defaultHandler(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
        case 'ping': return { pong: true };
        case 'getClassNames': {
            const filter = (params['filter'] as string) ?? '';
            const all = ['NSObject', 'UIView', 'UIViewController', 'NSString', 'UIButton'];
            return { classes: filter ? all.filter(c => c.toLowerCase().includes(filter.toLowerCase())) : all };
        }
        case 'getMethods': {
            if (!params['className']) throw { code: -32602, message: 'className required' };
            return { methods: ['init', 'description', 'dealloc'] };
        }
        case 'evaluate': {
            if (!params['code']) throw { code: -32602, message: 'code required' };
            const code = params['code'] as string;
            if (code.includes('ERROR')) throw { code: -32000, message: 'Eval error' };
            return { result: 'ok' };
        }
        case 'loadScript': {
            if (!params['name'] || !params['code']) throw { code: -32602, message: 'name and code required' };
            return { loaded: params['name'] };
        }
        case 'unloadScript': {
            if (!params['name']) throw { code: -32602, message: 'name required' };
            return { unloaded: params['name'] };
        }
        case 'listScripts': return { scripts: [] };
        case 'listHooks': return { hooks: [] };
        case 'listModules': return { modules: [{ name: 'WhiteNeedle.dylib', base: '0x1', size: 1024 }] };
        case 'rpcCall': {
            if (params['method'] === 'echo') return params['args'];
            throw { code: -32001, message: `Unknown RPC '${params['method']}'` };
        }
        default: throw { code: -32601, message: `Unknown method '${method}'` };
    }
}

class FakeDevice {
    server: net.Server;
    connections: net.Socket[] = [];
    private handler: Handler;
    private connectionWaiters: (() => void)[] = [];

    constructor(handler?: Handler) {
        this.handler = handler ?? defaultHandler;
        this.server = net.createServer((socket) => {
            this.connections.push(socket);
            for (const w of this.connectionWaiters) w();
            this.connectionWaiters = [];

            let buffer = '';
            socket.on('data', (data) => {
                buffer += data.toString('utf8');
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    this.processMessage(socket, trimmed);
                }
            });
            socket.on('close', () => {
                this.connections = this.connections.filter(s => s !== socket);
            });
        });
    }

    private async processMessage(socket: net.Socket, raw: string): Promise<void> {
        let msg: any;
        try { msg = JSON.parse(raw); } catch { return; }
        if (!('id' in msg)) return;

        try {
            const result = await this.handler(msg.method, msg.params ?? {});
            if (result === NO_RESPONSE) return;
            if (!socket.destroyed) {
                socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
            }
        } catch (err: any) {
            const error = err.code ? { code: err.code, message: err.message } : { code: -32000, message: String(err) };
            if (!socket.destroyed) {
                socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error }) + '\n');
            }
        }
    }

    sendNotification(method: string, params: Record<string, unknown>): void {
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        for (const c of this.connections) c.write(msg);
    }

    async waitForConnection(): Promise<void> {
        if (this.connections.length > 0) return;
        return new Promise(r => { this.connectionWaiters.push(r); });
    }

    dropAllConnections(): void {
        for (const c of this.connections) { c.end(); c.destroy(); }
        this.connections = [];
    }

    async listen(): Promise<number> {
        return new Promise(r => {
            this.server.listen(0, '127.0.0.1', () => r((this.server.address() as net.AddressInfo).port));
        });
    }

    async close(): Promise<void> {
        for (const c of this.connections) c.destroy();
        return new Promise(r => this.server.close(() => r()));
    }
}

function createBridge(): TcpBridge {
    const channel = {
        appendLine: (_msg: string) => {},
        append: (_msg: string) => {},
        show: () => {},
        hide: () => {},
        clear: () => {},
        dispose: () => {},
        replace: (_value: string) => {},
        name: 'test',
    } as any;
    return new TcpBridge(channel);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: TcpBridge end-to-end', () => {
    let device: FakeDevice;
    let bridge: TcpBridge;
    let port: number;

    beforeEach(async () => {
        device = new FakeDevice();
        port = await device.listen();
        bridge = createBridge();
    });

    afterEach(async () => {
        bridge.disconnect();
        await device.close();
    });

    // =======================================================================
    // Connection lifecycle
    // =======================================================================

    describe('connection lifecycle', () => {
        it('connects and reports isConnected', async () => {
            expect(bridge.isConnected).toBe(false);
            await bridge.connect('127.0.0.1', port);
            expect(bridge.isConnected).toBe(true);
        });

        it('ping after connect', async () => {
            await bridge.connect('127.0.0.1', port);
            const result = await bridge.call('ping', {});
            expect(result).toEqual({ pong: true });
        });

        it('disconnect resets isConnected', async () => {
            await bridge.connect('127.0.0.1', port);
            bridge.disconnect();
            expect(bridge.isConnected).toBe(false);
        });

        it('rejects connect to non-existent server', async () => {
            const b = createBridge();
            await expect(b.connect('127.0.0.1', 19999)).rejects.toThrow();
        });

        it('emits disconnected when server drops', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();
            const p = new Promise<void>(r => bridge.on('disconnected', r));
            device.dropAllConnections();
            await p;
            expect(bridge.isConnected).toBe(false);
        });

        it('rejects call after disconnect', async () => {
            await bridge.connect('127.0.0.1', port);
            bridge.disconnect();
            await expect(bridge.call('ping', {})).rejects.toThrow('Not connected');
        });

        it('rejects all pending on disconnect', async () => {
            const silent = new FakeDevice(() => NO_RESPONSE);
            const sp = await silent.listen();
            const b = createBridge();
            await b.connect('127.0.0.1', sp);

            const callP = b.call('ping', {});
            b.disconnect();
            await expect(callP).rejects.toThrow('Disconnected');

            await silent.close();
        });
    });

    // =======================================================================
    // Core API methods
    // =======================================================================

    describe('core API methods', () => {
        it('getClassNames with and without filter', async () => {
            await bridge.connect('127.0.0.1', port);
            const all = await bridge.call('getClassNames', { filter: '' }) as any;
            expect(all.classes).toContain('NSObject');
            expect(all.classes).toContain('UIView');

            const filtered = await bridge.call('getClassNames', { filter: 'UI' }) as any;
            expect(filtered.classes.every((c: string) => c.includes('UI'))).toBe(true);
        });

        it('getMethods returns methods', async () => {
            await bridge.connect('127.0.0.1', port);
            const result = await bridge.call('getMethods', { className: 'NSObject' }) as any;
            expect(result.methods).toContain('init');
        });

        it('getMethods rejects without className', async () => {
            await bridge.connect('127.0.0.1', port);
            await expect(bridge.call('getMethods', {})).rejects.toThrow('className required');
        });

        it('evaluate returns result', async () => {
            await bridge.connect('127.0.0.1', port);
            const result = await bridge.call('evaluate', { code: '1+1' });
            expect(result).toEqual({ result: 'ok' });
        });

        it('evaluate rejects on error', async () => {
            await bridge.connect('127.0.0.1', port);
            await expect(bridge.call('evaluate', { code: 'ERROR' })).rejects.toThrow('Eval error');
        });

        it('loadScript and listScripts', async () => {
            await bridge.connect('127.0.0.1', port);
            const loaded = await bridge.call('loadScript', { name: 'test', code: 'console.log("hi")' }) as any;
            expect(loaded.loaded).toBe('test');
        });

        it('listModules returns modules', async () => {
            await bridge.connect('127.0.0.1', port);
            const result = await bridge.call('listModules', {}) as any;
            expect(result.modules.length).toBeGreaterThan(0);
            expect(result.modules[0]).toHaveProperty('name');
        });

        it('unknown method returns error', async () => {
            await bridge.connect('127.0.0.1', port);
            await expect(bridge.call('nonexistentMethod', {})).rejects.toThrow("Unknown method 'nonexistentMethod'");
        });
    });

    // =======================================================================
    // Notifications
    // =======================================================================

    describe('notifications', () => {
        it('receives console notification', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();

            const p = new Promise<any>(r => bridge.on('console', r));
            device.sendNotification('console', { level: 'warn', message: 'test warning' });
            const params = await p;
            expect(params.level).toBe('warn');
            expect(params.message).toBe('test warning');
        });

        it('receives scriptError notification', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();

            const p = new Promise<any>(r => bridge.on('scriptError', r));
            device.sendNotification('scriptError', { message: 'SyntaxError', lineNumber: 10 });
            const params = await p;
            expect(params.message).toBe('SyntaxError');
        });

        it('receives custom notification', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();

            const p = new Promise<any>(r => bridge.on('customEvent', r));
            device.sendNotification('customEvent', { data: 42 });
            const params = await p;
            expect(params.data).toBe(42);
        });
    });

    // =======================================================================
    // Concurrent requests
    // =======================================================================

    describe('concurrent requests', () => {
        it('handles 30 parallel calls', async () => {
            await bridge.connect('127.0.0.1', port);
            const promises = Array.from({ length: 30 }, () =>
                bridge.call('getClassNames', { filter: '' })
            );
            const results = await Promise.all(promises);
            expect(results).toHaveLength(30);
            for (const r of results) {
                expect((r as any).classes.length).toBeGreaterThan(0);
            }
        });

        it('handles mixed method calls concurrently', async () => {
            await bridge.connect('127.0.0.1', port);
            const [classes, methods, modules, scripts] = await Promise.all([
                bridge.call('getClassNames', { filter: '' }),
                bridge.call('getMethods', { className: 'NSObject' }),
                bridge.call('listModules', {}),
                bridge.call('listScripts', {}),
            ]) as any[];
            expect(classes.classes.length).toBeGreaterThan(0);
            expect(methods.methods.length).toBeGreaterThan(0);
            expect(modules.modules.length).toBeGreaterThan(0);
            expect(scripts.scripts).toEqual([]);
        });
    });

    // =======================================================================
    // Large payloads
    // =======================================================================

    describe('large payloads', () => {
        it('sends large evaluate code', async () => {
            await bridge.connect('127.0.0.1', port);
            const bigCode = 'var x = ' + JSON.stringify('A'.repeat(100_000)) + ';';
            const result = await bridge.call('evaluate', { code: bigCode });
            expect(result).toEqual({ result: 'ok' });
        });
    });

    // =======================================================================
    // Special characters
    // =======================================================================

    describe('special characters', () => {
        it('handles unicode in code', async () => {
            await bridge.connect('127.0.0.1', port);
            const result = await bridge.call('evaluate', { code: 'console.log("中文 🎉 日本語")' });
            expect(result).toBeDefined();
        });

        it('handles newlines in code', async () => {
            await bridge.connect('127.0.0.1', port);
            const result = await bridge.call('evaluate', { code: 'var a = 1;\nvar b = 2;\na + b;' });
            expect(result).toBeDefined();
        });
    });

    // =======================================================================
    // Rapid connect/disconnect
    // =======================================================================

    describe('rapid connect/disconnect', () => {
        it('handles 10 cycles', async () => {
            for (let i = 0; i < 10; i++) {
                const b = createBridge();
                await b.connect('127.0.0.1', port);
                expect(b.isConnected).toBe(true);
                const r = await b.call('ping', {});
                expect(r).toEqual({ pong: true });
                b.disconnect();
            }
        });
    });

    // =======================================================================
    // Connection stability
    // =======================================================================

    describe('connection stability', () => {
        it('detects server disappearing', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();
            const p = new Promise<void>(r => bridge.on('disconnected', r));
            device.dropAllConnections();
            await p;
            expect(bridge.isConnected).toBe(false);
        });

        it('pending calls reject on connection drop', async () => {
            const silent = new FakeDevice(() => NO_RESPONSE);
            const sp = await silent.listen();
            const b = createBridge();
            await b.connect('127.0.0.1', sp);
            await silent.waitForConnection();

            const callP = b.call('getClassNames', { filter: '' });
            await new Promise(r => setTimeout(r, 30));
            silent.dropAllConnections();

            await expect(callP).rejects.toThrow();
            b.disconnect();
            await silent.close();
        });

        it('survives malformed server data', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();

            for (const c of device.connections) {
                c.write('GARBAGE_NOT_JSON\n');
                c.write('{"incomplete\n');
            }

            // Bridge should still work
            await new Promise(r => setTimeout(r, 50));
            expect(bridge.isConnected).toBe(true);
            const result = await bridge.call('ping', {});
            expect(result).toEqual({ pong: true });
        });
    });

    // =======================================================================
    // Heartbeat
    // =======================================================================

    describe('heartbeat', () => {
        it('heartbeat keeps connection alive', async () => {
            await bridge.connect('127.0.0.1', port);
            expect(bridge.isConnected).toBe(true);

            // Wait long enough for at least one heartbeat cycle (15s interval)
            await new Promise(r => setTimeout(r, 16500));
            expect(bridge.isConnected).toBe(true);

            // Verify we can still make calls
            const result = await bridge.call('ping', {});
            expect(result).toEqual({ pong: true });
        }, 25000);

        it('heartbeat timeout disconnects when device stops responding', async () => {
            let respondToPing = true;
            const flaky = new FakeDevice((method, params) => {
                if (method === 'ping') {
                    if (!respondToPing) return NO_RESPONSE;
                    return { pong: true };
                }
                return defaultHandler(method, params);
            });
            const fp = await flaky.listen();
            const b = createBridge();
            await b.connect('127.0.0.1', fp);
            expect(b.isConnected).toBe(true);

            // Stop responding to ping → heartbeat should time out
            respondToPing = false;
            const disconnectP = new Promise<void>(r => b.on('disconnected', r));

            // Heartbeat fires at 15s, timeout at +10s → ~25s max
            await disconnectP;
            expect(b.isConnected).toBe(false);

            b.disconnect();
            await flaky.close();
        }, 35000);
    });

    // =======================================================================
    // Timeout
    // =======================================================================

    describe('timeout', () => {
        it('call times out when server never responds', async () => {
            // Respond to 'ping' to keep heartbeat alive, but ignore everything else
            const silent = new FakeDevice((method) => {
                if (method === 'ping') return { status: 'pong' };
                return NO_RESPONSE;
            });
            const sp = await silent.listen();
            const b = createBridge();
            await b.connect('127.0.0.1', sp);

            await expect(b.call('evaluate', { code: '1' })).rejects.toThrow('Timeout');

            b.disconnect();
            await silent.close();
        }, 35000);
    });

    // =======================================================================
    // End-to-end workflow
    // =======================================================================

    describe('end-to-end workflow', () => {
        it('simulates a complete debugging session', async () => {
            await bridge.connect('127.0.0.1', port);
            await device.waitForConnection();

            // Ping
            expect(await bridge.call('ping', {})).toEqual({ pong: true });

            // List classes
            const classes = await bridge.call('getClassNames', { filter: 'UI' }) as any;
            expect(classes.classes).toContain('UIView');

            // Get methods
            const methods = await bridge.call('getMethods', { className: 'UIView' }) as any;
            expect(methods.methods.length).toBeGreaterThan(0);

            // Load script
            await bridge.call('loadScript', { name: 'trace', code: 'Interceptor.attach(...)' });

            // Evaluate
            const ev = await bridge.call('evaluate', { code: '1+1' });
            expect(ev).toBeDefined();

            // List modules
            const mods = await bridge.call('listModules', {}) as any;
            expect(mods.modules.length).toBeGreaterThan(0);

            // Receive notification
            const notifP = new Promise<any>(r => bridge.on('console', r));
            device.sendNotification('console', { level: 'log', message: 'from device' });
            const notif = await notifP;
            expect(notif.message).toBe('from device');

            // Unload script
            await bridge.call('unloadScript', { name: 'trace' });

            // Disconnect
            bridge.disconnect();
            expect(bridge.isConnected).toBe(false);
        });
    });
});
