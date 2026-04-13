/**
 * Integration tests for WhiteNeedle JSON-RPC API.
 *
 * These tests spin up a local TCP server that simulates a WhiteNeedle device,
 * then exercise every API method through TcpClient over a real TCP connection.
 * The fake device maintains state (loaded scripts, hooks, etc.) so the tests
 * are end-to-end from the client's perspective.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';
import { TcpClient } from '../tcpClient.js';

// ---------------------------------------------------------------------------
// Fake WhiteNeedle device
// ---------------------------------------------------------------------------

interface FakeDeviceState {
    scripts: Map<string, string>;
    hooks: string[];
    rpcExports: Map<string, (...args: unknown[]) => unknown>;
}

/** Return NO_RESPONSE to suppress the JSON-RPC reply (simulates a silent server). */
const NO_RESPONSE = Symbol('NO_RESPONSE');

type RequestHandler = (
    method: string,
    params: Record<string, unknown>,
    state: FakeDeviceState,
) => unknown | Promise<unknown>;

function defaultHandler(method: string, params: Record<string, unknown>, state: FakeDeviceState): unknown {
    switch (method) {
        case 'ping':
            return { pong: true };

        case 'getClassNames': {
            const filter = (params['filter'] as string) ?? '';
            const allClasses = [
                'NSObject', 'UIView', 'UIViewController', 'UIApplication',
                'NSString', 'NSArray', 'NSDictionary', 'NSNumber',
                'UILabel', 'UIButton', 'UITableView', 'UICollectionView',
                'WKWebView', 'NSURLSession', 'NSUserDefaults',
            ];
            const classes = filter
                ? allClasses.filter(c => c.toLowerCase().includes(filter.toLowerCase()))
                : allClasses;
            return { classes };
        }

        case 'getMethods': {
            const className = params['className'];
            if (className === undefined || className === null) {
                throw { code: -32602, message: 'className is required' };
            }
            if (typeof className !== 'string' || className.length === 0) {
                return { instanceMethods: [], classMethods: [] };
            }
            return {
                instanceMethods: ['init', 'description', 'dealloc', 'isEqual:', 'hash'],
                classMethods: ['alloc', 'new', 'class', 'superclass'],
            };
        }

        case 'evaluate': {
            const code = params['code'] as string;
            if (code === undefined || code === null || code === '') {
                throw { code: -32602, message: 'code is required' };
            }
            try {
                if (code.includes('THROW_ERROR')) {
                    throw new Error('Evaluation failed: syntax error');
                }
                if (code.includes('ObjC.choose')) {
                    return {
                        value: JSON.stringify({
                            count: 3,
                            samples: ['<UIView: 0x1>', '<UIView: 0x2>', '<UIView: 0x3>'],
                        }),
                    };
                }
                if (code.includes('__wnVersion')) {
                    return { value: '2.0.0' };
                }
                if (code.includes('Process.platform')) {
                    return { value: 'ios' };
                }
                return { value: 'ok' };
            } catch (e: any) {
                throw { code: -32000, message: e.message };
            }
        }

        case 'loadScript': {
            const name = params['name'] as string;
            const code = params['code'] as string;
            if (!name) throw { code: -32602, message: 'name is required' };
            if (!code) throw { code: -32602, message: 'code is required' };
            state.scripts.set(name, code);
            return { loaded: name };
        }

        case 'unloadScript': {
            const name = params['name'] as string;
            if (!name) throw { code: -32602, message: 'name is required' };
            if (!state.scripts.has(name)) throw { code: -32001, message: `Script '${name}' not found` };
            state.scripts.delete(name);
            return { unloaded: name };
        }

        case 'listScripts':
            return { scripts: Array.from(state.scripts.keys()) };

        case 'listHooks':
            return { hooks: [...state.hooks] };

        case 'listModules':
            return {
                modules: [
                    { name: 'WhiteNeedle', base: '0x100000000', size: 1048576 },
                    { name: 'UIKitCore', base: '0x180000000', size: 20971520 },
                    { name: 'Foundation', base: '0x190000000', size: 8388608 },
                    { name: 'libSystem.B.dylib', base: '0x1a0000000', size: 4194304 },
                ],
            };

        case 'rpcCall': {
            const rpcMethod = params['method'] as string;
            const args = (params['args'] as unknown[]) ?? [];
            const fn = state.rpcExports.get(rpcMethod);
            if (!fn) throw { code: -32001, message: `RPC export '${rpcMethod}' not found` };
            return fn(...args);
        }

        default:
            throw { code: -32601, message: `Method '${method}' not found` };
    }
}

class FakeDevice {
    server: net.Server;
    state: FakeDeviceState;
    connections: net.Socket[] = [];
    private handler: RequestHandler;
    private responseDelay = 0;

    constructor(handler?: RequestHandler) {
        this.handler = handler ?? defaultHandler;
        this.state = {
            scripts: new Map(),
            hooks: [],
            rpcExports: new Map(),
        };
        this.server = net.createServer((socket) => {
            this.connections.push(socket);
            for (const waiter of this.connectionWaiters) waiter();
            this.connectionWaiters = [];
            let buffer = '';

            socket.on('data', (data) => {
                buffer += data.toString('utf8');
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    this.handleMessage(socket, trimmed);
                }
            });

            socket.on('close', () => {
                this.connections = this.connections.filter(s => s !== socket);
            });
        });
    }

    private handleMessage(socket: net.Socket, raw: string): void {
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        if (!('id' in msg)) return;

        const respond = async () => {
            try {
                const result = await this.handler(msg.method, msg.params ?? {}, this.state);
                if (result === NO_RESPONSE) return;
                const response = { jsonrpc: '2.0', id: msg.id, result };
                if (!socket.destroyed) socket.write(JSON.stringify(response) + '\n');
            } catch (err: any) {
                const error = err.code
                    ? { code: err.code, message: err.message }
                    : { code: -32000, message: String(err) };
                if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error }) + '\n');
            }
        };

        if (this.responseDelay > 0) {
            setTimeout(respond, this.responseDelay);
        } else {
            respond();
        }
    }

    sendNotification(method: string, params: Record<string, unknown>): void {
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        for (const conn of this.connections) {
            conn.write(msg);
        }
    }

    setResponseDelay(ms: number): void {
        this.responseDelay = ms;
    }

    private connectionWaiters: (() => void)[] = [];

    async waitForConnection(): Promise<void> {
        if (this.connections.length > 0) return;
        return new Promise((resolve) => {
            this.connectionWaiters.push(resolve);
        });
    }

    async listen(): Promise<number> {
        return new Promise((resolve) => {
            this.server.listen(0, '127.0.0.1', () => {
                resolve((this.server.address() as net.AddressInfo).port);
            });
        });
    }

    async close(): Promise<void> {
        for (const conn of this.connections) {
            conn.destroy();
        }
        return new Promise((resolve) => this.server.close(() => resolve()));
    }

    dropAllConnections(): void {
        for (const conn of this.connections) {
            conn.end();
            conn.destroy();
        }
        this.connections = [];
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: WhiteNeedle JSON-RPC API', () => {
    let device: FakeDevice;
    let client: TcpClient;
    let port: number;

    beforeEach(async () => {
        device = new FakeDevice();
        port = await device.listen();
        client = new TcpClient();
    });

    afterEach(async () => {
        client.disconnect();
        await device.close();
    });

    // =======================================================================
    // Connection lifecycle
    // =======================================================================

    describe('connection lifecycle', () => {
        it('connects to device and ping succeeds', async () => {
            await client.connect('127.0.0.1', port);
            expect(client.isConnected).toBe(true);
            const result = await client.call('ping', {});
            expect(result).toEqual({ pong: true });
        });

        it('disconnects cleanly', async () => {
            await client.connect('127.0.0.1', port);
            client.disconnect();
            expect(client.isConnected).toBe(false);
        });

        it('rejects all pending calls on disconnect', async () => {
            const silentDevice = new FakeDevice(() => NO_RESPONSE);
            const silentPort = await silentDevice.listen();
            const silentClient = new TcpClient();
            await silentClient.connect('127.0.0.1', silentPort);

            const callPromise = silentClient.call('evaluate', { code: '1+1' });
            silentClient.disconnect();
            await expect(callPromise).rejects.toThrow('Disconnected');

            await silentDevice.close();
        });

        it('rejects connect to non-existent server', async () => {
            const badClient = new TcpClient();
            await expect(badClient.connect('127.0.0.1', 19999)).rejects.toThrow();
        });

        it('emits disconnected event when server closes', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();
            const disconnectedPromise = new Promise<void>(r => client.on('disconnected', r));
            device.dropAllConnections();
            await disconnectedPromise;
            expect(client.isConnected).toBe(false);
        });

        it('can reconnect after disconnect', async () => {
            await client.connect('127.0.0.1', port);
            client.disconnect();
            expect(client.isConnected).toBe(false);

            const client2 = new TcpClient();
            await client2.connect('127.0.0.1', port);
            expect(client2.isConnected).toBe(true);
            const result = await client2.call('ping', {});
            expect(result).toEqual({ pong: true });
            client2.disconnect();
        });
    });

    // =======================================================================
    // Core API: getClassNames
    // =======================================================================

    describe('getClassNames', () => {
        it('returns all classes with no filter', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('getClassNames', { filter: '' }) as any;
            expect(result.classes).toBeInstanceOf(Array);
            expect(result.classes.length).toBeGreaterThan(0);
            expect(result.classes).toContain('NSObject');
            expect(result.classes).toContain('UIView');
        });

        it('filters classes by prefix', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('getClassNames', { filter: 'UI' }) as any;
            expect(result.classes.every((c: string) => c.toLowerCase().includes('ui'))).toBe(true);
            expect(result.classes).toContain('UIView');
            expect(result.classes).not.toContain('NSObject');
        });

        it('returns empty array for non-matching filter', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('getClassNames', { filter: 'ZZZZZ_NoMatch' }) as any;
            expect(result.classes).toEqual([]);
        });

        it('handles filter with special characters', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('getClassNames', { filter: '<script>alert(1)</script>' }) as any;
            expect(result.classes).toEqual([]);
        });
    });

    // =======================================================================
    // Core API: getMethods
    // =======================================================================

    describe('getMethods', () => {
        it('returns instanceMethods and classMethods (device shape)', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('getMethods', { className: 'NSObject' }) as any;
            expect(result.instanceMethods).toBeInstanceOf(Array);
            expect(result.classMethods).toBeInstanceOf(Array);
            expect(result.instanceMethods).toContain('init');
            expect(result.instanceMethods).toContain('description');
            expect(result.classMethods).toContain('alloc');
            expect(result.classMethods).toContain('new');
        });

        it('rejects when className is missing', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('getMethods', {})).rejects.toThrow('className is required');
        });

        it('returns empty arrays when className is empty string', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('getMethods', { className: '' }) as any;
            expect(result.instanceMethods).toEqual([]);
            expect(result.classMethods).toEqual([]);
        });
    });

    // =======================================================================
    // Core API: evaluate
    // =======================================================================

    describe('evaluate', () => {
        it('evaluates simple code', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('evaluate', { code: '1 + 1' });
            expect(result).toEqual({ value: 'ok' });
        });

        it('evaluates code that reads __wnVersion', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('evaluate', { code: '__wnVersion' });
            expect(result).toEqual({ value: '2.0.0' });
        });

        it('evaluates code that reads Process.platform', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('evaluate', { code: 'Process.platform' });
            expect(result).toEqual({ value: 'ios' });
        });

        it('rejects when code is missing', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('evaluate', {})).rejects.toThrow('code is required');
        });

        it('returns error for code that throws', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('evaluate', { code: 'THROW_ERROR' }))
                .rejects.toThrow('Evaluation failed');
        });

        it('evaluates heap search (ObjC.choose)', async () => {
            await client.connect('127.0.0.1', port);
            const code = `
(function() {
    var out = [];
    ObjC.choose("UIView", {
        onMatch: function(i) { out.push(String(i)); return out.length >= 10 ? 'stop' : undefined; },
        onComplete: function() {}
    });
    return JSON.stringify({ count: out.length, samples: out });
})()`;
            const result = await client.call('evaluate', { code }) as { value: string };
            const parsed = JSON.parse(result.value);
            expect(parsed.count).toBe(3);
            expect(parsed.samples).toHaveLength(3);
        });
    });

    // =======================================================================
    // Core API: loadScript / unloadScript / listScripts
    // =======================================================================

    describe('script lifecycle', () => {
        it('loads and lists a script', async () => {
            await client.connect('127.0.0.1', port);
            await client.call('loadScript', { name: 'test-hook', code: 'console.log("hi")' });

            const list = await client.call('listScripts', {}) as any;
            expect(list.scripts).toContain('test-hook');
        });

        it('unloads a loaded script', async () => {
            await client.connect('127.0.0.1', port);
            await client.call('loadScript', { name: 'temp', code: '1' });
            await client.call('unloadScript', { name: 'temp' });

            const list = await client.call('listScripts', {}) as any;
            expect(list.scripts).not.toContain('temp');
        });

        it('rejects unloading non-existent script', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('unloadScript', { name: 'nonexistent' }))
                .rejects.toThrow("Script 'nonexistent' not found");
        });

        it('loads multiple scripts and lists all', async () => {
            await client.connect('127.0.0.1', port);
            await client.call('loadScript', { name: 'a', code: '1' });
            await client.call('loadScript', { name: 'b', code: '2' });
            await client.call('loadScript', { name: 'c', code: '3' });

            const list = await client.call('listScripts', {}) as any;
            expect(list.scripts).toEqual(['a', 'b', 'c']);
        });

        it('overwrites script with same name', async () => {
            await client.connect('127.0.0.1', port);
            await client.call('loadScript', { name: 'myScript', code: 'v1' });
            await client.call('loadScript', { name: 'myScript', code: 'v2' });

            const list = await client.call('listScripts', {}) as any;
            expect(list.scripts.filter((s: string) => s === 'myScript')).toHaveLength(1);
        });

        it('rejects loadScript without name', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('loadScript', { code: '1' })).rejects.toThrow('name is required');
        });

        it('rejects loadScript without code', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('loadScript', { name: 'x' })).rejects.toThrow('code is required');
        });
    });

    // =======================================================================
    // Core API: listHooks
    // =======================================================================

    describe('listHooks', () => {
        it('returns empty hooks initially', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('listHooks', {}) as any;
            expect(result.hooks).toEqual([]);
        });

        it('returns hooks after loading a tracing script', async () => {
            device.state.hooks.push('-[UIView setFrame:]', '-[NSURLSession dataTaskWithRequest:]');
            await client.connect('127.0.0.1', port);
            const result = await client.call('listHooks', {}) as any;
            expect(result.hooks).toHaveLength(2);
            expect(result.hooks).toContain('-[UIView setFrame:]');
        });
    });

    // =======================================================================
    // Core API: listModules
    // =======================================================================

    describe('listModules', () => {
        it('returns loaded modules', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('listModules', {}) as any;
            expect(result.modules).toBeInstanceOf(Array);
            expect(result.modules.length).toBeGreaterThan(0);
            expect(result.modules[0]).toHaveProperty('name');
            expect(result.modules[0]).toHaveProperty('base');
            expect(result.modules[0]).toHaveProperty('size');
        });
    });

    // =======================================================================
    // Core API: rpcCall
    // =======================================================================

    describe('rpcCall', () => {
        it('calls an exported RPC function', async () => {
            device.state.rpcExports.set('add', (a: any, b: any) => a + b);
            await client.connect('127.0.0.1', port);
            const result = await client.call('rpcCall', { method: 'add', args: [3, 4] });
            expect(result).toBe(7);
        });

        it('rejects when RPC export does not exist', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('rpcCall', { method: 'nonexistent', args: [] }))
                .rejects.toThrow("RPC export 'nonexistent' not found");
        });

        it('passes complex arguments to RPC', async () => {
            device.state.rpcExports.set('echo', (...args: any[]) => args);
            await client.connect('127.0.0.1', port);
            const result = await client.call('rpcCall', {
                method: 'echo',
                args: [{ key: 'value' }, [1, 2, 3], null, 'string', true],
            });
            expect(result).toEqual([{ key: 'value' }, [1, 2, 3], null, 'string', true]);
        });
    });

    // =======================================================================
    // Unknown method
    // =======================================================================

    describe('unknown method', () => {
        it('rejects with method not found error', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('totallyFakeMethod', {}))
                .rejects.toThrow("Method 'totallyFakeMethod' not found");
        });
    });

    // =======================================================================
    // Notifications (device -> client)
    // =======================================================================

    describe('notifications', () => {
        it('receives console notification', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();

            const notifPromise = new Promise<Record<string, unknown>>((resolve) => {
                client.on('console', resolve);
            });

            device.sendNotification('console', { level: 'log', message: 'Hello from device' });
            const params = await notifPromise;
            expect(params.level).toBe('log');
            expect(params.message).toBe('Hello from device');
        });

        it('receives scriptError notification', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();

            const notifPromise = new Promise<Record<string, unknown>>((resolve) => {
                client.on('scriptError', resolve);
            });

            device.sendNotification('scriptError', {
                message: 'ReferenceError: x is not defined',
                lineNumber: 5,
                fileName: 'test.js',
            });

            const params = await notifPromise;
            expect(params.message).toBe('ReferenceError: x is not defined');
            expect(params.lineNumber).toBe(5);
        });

        it('receives multiple notifications in order', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();

            const messages: string[] = [];
            client.on('console', (params: Record<string, unknown>) => {
                messages.push(params['message'] as string);
            });

            device.sendNotification('console', { level: 'log', message: 'msg1' });
            device.sendNotification('console', { level: 'log', message: 'msg2' });
            device.sendNotification('console', { level: 'log', message: 'msg3' });

            await new Promise(r => setTimeout(r, 200));
            expect(messages).toEqual(['msg1', 'msg2', 'msg3']);
        });
    });

    // =======================================================================
    // Boundary: concurrent requests
    // =======================================================================

    describe('concurrent requests', () => {
        it('handles 50 concurrent calls correctly', async () => {
            await client.connect('127.0.0.1', port);

            const promises = Array.from({ length: 50 }, (_, i) =>
                client.call('getClassNames', { filter: i % 2 === 0 ? 'NS' : 'UI' })
            );

            const results = await Promise.all(promises);
            expect(results).toHaveLength(50);
            for (const r of results) {
                expect((r as any).classes).toBeInstanceOf(Array);
            }
        });

        it('handles mixed concurrent calls to different methods', async () => {
            await client.connect('127.0.0.1', port);

            const results = await Promise.all([
                client.call('getClassNames', { filter: '' }),
                client.call('getMethods', { className: 'NSObject' }),
                client.call('listScripts', {}),
                client.call('listHooks', {}),
                client.call('listModules', {}),
                client.call('ping', {}),
                client.call('evaluate', { code: '__wnVersion' }),
            ]);

            expect((results[0] as any).classes.length).toBeGreaterThan(0);
            expect((results[1] as any).instanceMethods.length).toBeGreaterThan(0);
            expect((results[2] as any).scripts).toEqual([]);
            expect((results[3] as any).hooks).toEqual([]);
            expect((results[4] as any).modules.length).toBeGreaterThan(0);
            expect((results[5] as any).pong).toBe(true);
            expect((results[6] as any).value).toBe('2.0.0');
        });

        it('interleaves requests and notifications', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();

            const notifications: string[] = [];
            client.on('console', (p: any) => notifications.push(p.message));

            const callPromise = client.call('getClassNames', { filter: '' });
            device.sendNotification('console', { level: 'log', message: 'during-call' });
            const result = await callPromise;

            expect((result as any).classes.length).toBeGreaterThan(0);
            await new Promise(r => setTimeout(r, 200));
            expect(notifications).toContain('during-call');
        });
    });

    // =======================================================================
    // Boundary: large payloads
    // =======================================================================

    describe('large payloads', () => {
        it('sends and receives large code in evaluate', async () => {
            await client.connect('127.0.0.1', port);
            const largeCode = 'var x = ' + JSON.stringify('A'.repeat(100_000)) + ';';
            const result = await client.call('evaluate', { code: largeCode });
            expect(result).toEqual({ value: 'ok' });
        });

        it('sends large script in loadScript', async () => {
            await client.connect('127.0.0.1', port);
            const bigCode = '// ' + 'x'.repeat(200_000) + '\nconsole.log("loaded");';
            await client.call('loadScript', { name: 'big', code: bigCode });
            const list = await client.call('listScripts', {}) as any;
            expect(list.scripts).toContain('big');
        });
    });

    // =======================================================================
    // Boundary: special characters & encoding
    // =======================================================================

    describe('special characters and encoding', () => {
        it('handles unicode in evaluate code', async () => {
            await client.connect('127.0.0.1', port);
            const result = await client.call('evaluate', { code: 'console.log("中文测试 🎉 日本語")' });
            expect(result).toBeDefined();
        });

        it('handles script names with special characters', async () => {
            await client.connect('127.0.0.1', port);
            await client.call('loadScript', { name: 'my-script/v2.0', code: '1' });
            const list = await client.call('listScripts', {}) as any;
            expect(list.scripts).toContain('my-script/v2.0');
        });

        it('handles empty string code in evaluate', async () => {
            await client.connect('127.0.0.1', port);
            await expect(client.call('evaluate', { code: '' })).rejects.toThrow('code is required');
        });

        it('handles newlines in code', async () => {
            await client.connect('127.0.0.1', port);
            const code = 'var a = 1;\nvar b = 2;\nconsole.log(a + b);';
            const result = await client.call('evaluate', { code });
            expect(result).toBeDefined();
        });

        it('handles JSON with escaped quotes in code', async () => {
            await client.connect('127.0.0.1', port);
            const code = 'var obj = {"key": "value with \\"quotes\\""}; console.log(obj);';
            const result = await client.call('evaluate', { code });
            expect(result).toBeDefined();
        });
    });

    // =======================================================================
    // Boundary: rapid connect/disconnect cycles
    // =======================================================================

    describe('rapid connect/disconnect', () => {
        it('handles 10 rapid connect-disconnect cycles', async () => {
            for (let i = 0; i < 10; i++) {
                const c = new TcpClient();
                await c.connect('127.0.0.1', port);
                expect(c.isConnected).toBe(true);
                const result = await c.call('ping', {});
                expect(result).toEqual({ pong: true });
                c.disconnect();
                expect(c.isConnected).toBe(false);
            }
        });

        it('handles disconnect immediately after connect', async () => {
            const c = new TcpClient();
            await c.connect('127.0.0.1', port);
            c.disconnect();
            expect(c.isConnected).toBe(false);
            await expect(c.call('ping', {})).rejects.toThrow('Not connected');
        });
    });

    // =======================================================================
    // Boundary: call after disconnect
    // =======================================================================

    describe('calls after disconnect', () => {
        it('rejects call after client disconnect', async () => {
            await client.connect('127.0.0.1', port);
            client.disconnect();
            await expect(client.call('ping', {})).rejects.toThrow('Not connected');
        });

        it('rejects call after server drops connection', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();
            const disconnectPromise = new Promise<void>(r => client.on('disconnected', r));
            device.dropAllConnections();
            await disconnectPromise;
            await expect(client.call('ping', {})).rejects.toThrow('Not connected');
        });
    });

    // =======================================================================
    // Boundary: server sends malformed data
    // =======================================================================

    describe('malformed server responses', () => {
        it('survives server sending garbage data', async () => {
            const garbageDevice = new FakeDevice();
            const garbagePort = await garbageDevice.listen();

            garbageDevice.server.on('connection', (socket) => {
                socket.write('this is not json\n');
                socket.write('{"incomplete\n');
                socket.write('\n\n\n');
            });

            const c = new TcpClient();
            await c.connect('127.0.0.1', garbagePort);
            expect(c.isConnected).toBe(true);

            // Client should still be alive and connected
            await new Promise(r => setTimeout(r, 100));
            expect(c.isConnected).toBe(true);

            c.disconnect();
            await garbageDevice.close();
        });

        it('handles mixed valid and invalid messages', async () => {
            await client.connect('127.0.0.1', port);

            // Send some garbage through the connection, then a valid call
            for (const conn of device.connections) {
                conn.write('NOT_JSON_AT_ALL\n');
            }

            // Valid call should still work
            const result = await client.call('ping', {});
            expect(result).toEqual({ pong: true });
        });
    });

    // =======================================================================
    // Connection stability: server restart
    // =======================================================================

    describe('connection stability', () => {
        it('detects server going away', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();
            expect(client.isConnected).toBe(true);

            const disconnectPromise = new Promise<void>(r => client.on('disconnected', r));
            device.dropAllConnections();
            await disconnectPromise;
            expect(client.isConnected).toBe(false);
        });

        it('can connect to restarted server', async () => {
            await client.connect('127.0.0.1', port);
            await device.waitForConnection();
            const disconnectPromise = new Promise<void>(r => client.on('disconnected', r));

            // Simulate server restart
            await device.close();
            await disconnectPromise;
            expect(client.isConnected).toBe(false);

            // Start a new device on a new port
            const device2 = new FakeDevice();
            const port2 = await device2.listen();

            const client2 = new TcpClient();
            await client2.connect('127.0.0.1', port2);
            expect(client2.isConnected).toBe(true);
            const result = await client2.call('ping', {});
            expect(result).toEqual({ pong: true });

            client2.disconnect();
            await device2.close();
        });

        it('pending calls reject when connection drops mid-flight', async () => {
            const silentDevice = new FakeDevice(() => NO_RESPONSE);
            const silentPort = await silentDevice.listen();

            const c = new TcpClient();
            await c.connect('127.0.0.1', silentPort);
            await silentDevice.waitForConnection();

            const callPromise = c.call('getClassNames', { filter: '' });

            // Drop connection while call is pending
            await new Promise(r => setTimeout(r, 50));
            silentDevice.dropAllConnections();

            await expect(callPromise).rejects.toThrow();

            c.disconnect();
            await silentDevice.close();
        });
    });

    // =======================================================================
    // Full workflow: end-to-end scenario
    // =======================================================================

    describe('end-to-end workflow', () => {
        it('simulates a full debugging session', async () => {
            await client.connect('127.0.0.1', port);

            // 1. Check connection
            const ping = await client.call('ping', {});
            expect(ping).toEqual({ pong: true });

            // 2. List classes
            const classes = await client.call('getClassNames', { filter: 'UIView' }) as any;
            expect(classes.classes).toContain('UIView');

            // 3. Get methods of a class
            const methods = await client.call('getMethods', { className: 'UIView' }) as any;
            expect(methods.instanceMethods.length).toBeGreaterThan(0);

            // 4. Load a tracing script
            const traceCode = `
Interceptor.attach('-[UIView setFrame:]', {
    onEnter: function(self) { console.log('setFrame called'); }
});`;
            await client.call('loadScript', { name: 'trace-setFrame', code: traceCode });

            // 5. List loaded scripts
            const scripts = await client.call('listScripts', {}) as any;
            expect(scripts.scripts).toContain('trace-setFrame');

            // 6. Evaluate some code
            const evalResult = await client.call('evaluate', { code: '__wnVersion' }) as { value: string };
            expect(evalResult.value).toBe('2.0.0');

            // 7. List modules
            const modules = await client.call('listModules', {}) as any;
            expect(modules.modules.length).toBeGreaterThan(0);

            // 8. Unload the tracing script
            await client.call('unloadScript', { name: 'trace-setFrame' });
            const scriptsAfter = await client.call('listScripts', {}) as any;
            expect(scriptsAfter.scripts).not.toContain('trace-setFrame');

            // 9. Disconnect
            client.disconnect();
            expect(client.isConnected).toBe(false);
        });

        it('simulates RPC export workflow', async () => {
            device.state.rpcExports.set('getAppVersion', () => '3.2.1');
            device.state.rpcExports.set('multiply', (a: any, b: any) => a * b);

            await client.connect('127.0.0.1', port);

            // Load script that defines rpc.exports (simulated by state)
            await client.call('loadScript', {
                name: 'my-rpc',
                code: 'rpc.exports = { getAppVersion() { return "3.2.1"; }, multiply(a,b) { return a*b; } }',
            });

            // Call RPC exports
            const version = await client.call('rpcCall', { method: 'getAppVersion', args: [] });
            expect(version).toBe('3.2.1');

            const product = await client.call('rpcCall', { method: 'multiply', args: [6, 7] });
            expect(product).toBe(42);

            // Cleanup
            await client.call('unloadScript', { name: 'my-rpc' });
            client.disconnect();
        });
    });

    // =======================================================================
    // Timeout behavior
    // =======================================================================

    describe('timeout behavior', () => {
        it('call times out when server never responds', async () => {
            const silentDevice = new FakeDevice(() => NO_RESPONSE);
            const silentPort = await silentDevice.listen();

            const c = new TcpClient();
            await c.connect('127.0.0.1', silentPort);

            await expect(c.call('ping', {})).rejects.toThrow('Timeout');

            c.disconnect();
            await silentDevice.close();
        }, 35000);
    });
});
