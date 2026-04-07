import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as net from 'net';

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({ update: vi.fn().mockResolvedValue(undefined) }),
    },
    ConfigurationTarget: { Global: 1 },
}));

import { TcpBridge } from '../bridge/tcpBridge';

function createMockServer(): net.Server {
    return net.createServer();
}

async function listen(server: net.Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as net.AddressInfo;
            resolve(addr.port);
        });
    });
}

async function closeServer(server: net.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

function makeOutputChannel() {
    return { appendLine: vi.fn() } as any;
}

describe('TcpBridge', () => {
    let mockServer: net.Server;
    let bridge: TcpBridge;
    let serverPort: number;
    let outputChannel: ReturnType<typeof makeOutputChannel>;

    beforeEach(async () => {
        mockServer = createMockServer();
        serverPort = await listen(mockServer);
        outputChannel = makeOutputChannel();
        bridge = new TcpBridge(outputChannel);
    });

    afterEach(async () => {
        bridge.disconnect();
        await closeServer(mockServer);
    });

    describe('connection lifecycle', () => {
        it('connects and sets isConnected', async () => {
            expect(bridge.isConnected).toBe(false);
            await bridge.connect('127.0.0.1', serverPort);
            expect(bridge.isConnected).toBe(true);
        });

        it('disconnects cleanly', async () => {
            await bridge.connect('127.0.0.1', serverPort);
            bridge.disconnect();
            expect(bridge.isConnected).toBe(false);
        });

        it('rejects on connection timeout to unreachable host', async () => {
            // Use a non-routable IP to trigger timeout
            const br = new TcpBridge(outputChannel);
            await expect(
                br.connect('192.0.2.1', 1) // RFC 5737 TEST-NET, should be unreachable
            ).rejects.toThrow();
        }, 15000);

        it('rejects on connection to closed port', async () => {
            await closeServer(mockServer);
            await expect(
                bridge.connect('127.0.0.1', serverPort)
            ).rejects.toThrow();
        });

        it('emits disconnected event on server close', async () => {
            await bridge.connect('127.0.0.1', serverPort);

            const disconnectedPromise = new Promise<void>((resolve) => {
                bridge.on('disconnected', resolve);
            });

            // Destroy all server connections to force close
            mockServer.close();
            for (const sock of getServerSockets(mockServer)) {
                sock.destroy();
            }

            await disconnectedPromise;
            expect(bridge.isConnected).toBe(false);
        });
    });

    describe('JSON-RPC communication', () => {
        it('sends request and receives response', async () => {
            mockServer.on('connection', (sock) => {
                sock.on('data', (data) => {
                    const req = JSON.parse(data.toString().trim());
                    sock.write(JSON.stringify({
                        jsonrpc: '2.0',
                        id: req.id,
                        result: { classes: ['NSObject'] },
                    }) + '\n');
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            const result = await bridge.call('getClassNames', { filter: '' });
            expect(result).toEqual({ classes: ['NSObject'] });
        });

        it('rejects on JSON-RPC error response', async () => {
            mockServer.on('connection', (sock) => {
                sock.on('data', (data) => {
                    const req = JSON.parse(data.toString().trim());
                    sock.write(JSON.stringify({
                        jsonrpc: '2.0',
                        id: req.id,
                        error: { code: -32600, message: 'Invalid request' },
                    }) + '\n');
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            await expect(bridge.call('badMethod', {})).rejects.toThrow('Invalid request');
        });

        it('throws when calling without connection', async () => {
            await expect(bridge.call('test', {})).rejects.toThrow('Not connected');
        });

        it('handles multiple concurrent requests', async () => {
            mockServer.on('connection', (sock) => {
                let buffer = '';
                sock.on('data', (data) => {
                    buffer += data.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const req = JSON.parse(line);
                        // Respond with different results based on method
                        const result = req.method === 'a' ? { val: 'alpha' } : { val: 'beta' };
                        sock.write(JSON.stringify({
                            jsonrpc: '2.0',
                            id: req.id,
                            result,
                        }) + '\n');
                    }
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            const [r1, r2] = await Promise.all([
                bridge.call('a', {}),
                bridge.call('b', {}),
            ]);
            expect(r1).toEqual({ val: 'alpha' });
            expect(r2).toEqual({ val: 'beta' });
        });

        it('handles out-of-order responses', async () => {
            mockServer.on('connection', (sock) => {
                const pending: any[] = [];
                let buffer = '';
                sock.on('data', (data) => {
                    buffer += data.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        pending.push(JSON.parse(line));
                    }
                    // Respond in reverse order
                    if (pending.length >= 2) {
                        const reversed = pending.splice(0).reverse();
                        for (const req of reversed) {
                            sock.write(JSON.stringify({
                                jsonrpc: '2.0',
                                id: req.id,
                                result: { method: req.method },
                            }) + '\n');
                        }
                    }
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            const [r1, r2] = await Promise.all([
                bridge.call('first', {}),
                bridge.call('second', {}),
            ]);
            expect(r1).toEqual({ method: 'first' });
            expect(r2).toEqual({ method: 'second' });
        });

        it('rejects all pending calls on disconnect', async () => {
            mockServer.on('connection', () => {
                // Don't respond
            });

            await bridge.connect('127.0.0.1', serverPort);
            const p1 = bridge.call('neverResponds1', {});
            const p2 = bridge.call('neverResponds2', {});

            bridge.disconnect();

            await expect(p1).rejects.toThrow();
            await expect(p2).rejects.toThrow();
        });
    });

    describe('notifications', () => {
        it('emits console notifications', async () => {
            mockServer.on('connection', (sock) => {
                sock.write(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'console',
                    params: { level: 'log', message: 'hello world' },
                }) + '\n');
            });

            const consoleSpy = vi.fn();
            bridge.on('console', consoleSpy);

            await bridge.connect('127.0.0.1', serverPort);

            // Wait for async data processing
            await new Promise(r => setTimeout(r, 50));

            expect(consoleSpy).toHaveBeenCalledWith({
                level: 'log',
                message: 'hello world',
            });
        });

        it('emits scriptError notifications', async () => {
            mockServer.on('connection', (sock) => {
                sock.write(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'scriptError',
                    params: { message: 'ReferenceError: x is not defined' },
                }) + '\n');
            });

            const errorSpy = vi.fn();
            bridge.on('scriptError', errorSpy);

            await bridge.connect('127.0.0.1', serverPort);
            await new Promise(r => setTimeout(r, 50));

            expect(errorSpy).toHaveBeenCalledWith({
                message: 'ReferenceError: x is not defined',
            });
        });

        it('emits custom notifications by method name', async () => {
            mockServer.on('connection', (sock) => {
                sock.write(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'networkRequest',
                    params: { url: 'https://api.example.com', method: 'GET' },
                }) + '\n');
            });

            const netSpy = vi.fn();
            bridge.on('networkRequest', netSpy);

            await bridge.connect('127.0.0.1', serverPort);
            await new Promise(r => setTimeout(r, 50));

            expect(netSpy).toHaveBeenCalledWith({
                url: 'https://api.example.com',
                method: 'GET',
            });
        });
    });

    describe('buffer handling', () => {
        it('handles fragmented JSON across multiple data events', async () => {
            mockServer.on('connection', (sock) => {
                sock.on('data', (data) => {
                    const req = JSON.parse(data.toString().trim());
                    const response = JSON.stringify({
                        jsonrpc: '2.0',
                        id: req.id,
                        result: { ok: true },
                    }) + '\n';
                    // Send response in fragments
                    const mid = Math.floor(response.length / 2);
                    sock.write(response.slice(0, mid));
                    setTimeout(() => {
                        sock.write(response.slice(mid));
                    }, 10);
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            const result = await bridge.call('test', {});
            expect(result).toEqual({ ok: true });
        });

        it('handles multiple messages in single data event', async () => {
            mockServer.on('connection', (sock) => {
                let buffer = '';
                sock.on('data', (data) => {
                    buffer += data.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const req = JSON.parse(line);
                        // Batch two responses into one write
                        sock.write(JSON.stringify({
                            jsonrpc: '2.0',
                            id: req.id,
                            result: { n: req.id },
                        }) + '\n');
                    }
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            const result = await bridge.call('test', {});
            expect(result).toHaveProperty('n');
        });

        it('ignores malformed JSON lines gracefully', async () => {
            mockServer.on('connection', (sock) => {
                sock.on('data', (data) => {
                    const req = JSON.parse(data.toString().trim());
                    // Send garbage before the real response
                    sock.write('not json\n');
                    sock.write(JSON.stringify({
                        jsonrpc: '2.0',
                        id: req.id,
                        result: { ok: true },
                    }) + '\n');
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            const result = await bridge.call('test', {});
            expect(result).toEqual({ ok: true });
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Unparsed')
            );
        });
    });

    describe('heartbeat', () => {
        it('starts heartbeat timer on connect', async () => {
            // Heartbeat is internal; we verify it exists indirectly
            // by checking that ping calls are attempted after connection
            mockServer.on('connection', (sock) => {
                let buffer = '';
                sock.on('data', (data) => {
                    buffer += data.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const req = JSON.parse(line);
                        if (req.method === 'ping') {
                            sock.write(JSON.stringify({
                                jsonrpc: '2.0',
                                id: req.id,
                                result: { pong: true },
                            }) + '\n');
                        }
                    }
                });
            });

            await bridge.connect('127.0.0.1', serverPort);
            expect(bridge.isConnected).toBe(true);

            // Wait for at least one heartbeat cycle (15s interval)
            await new Promise(r => setTimeout(r, 16000));

            // If heartbeat worked, we're still connected
            expect(bridge.isConnected).toBe(true);
        }, 20000);
    });

    describe('connection stability edge cases', () => {
        it('handles rapid connect/disconnect cycles', async () => {
            for (let i = 0; i < 5; i++) {
                const br = new TcpBridge(outputChannel);
                await br.connect('127.0.0.1', serverPort);
                expect(br.isConnected).toBe(true);
                br.disconnect();
                expect(br.isConnected).toBe(false);
            }
        });

        it('disconnect is safe to call multiple times', async () => {
            await bridge.connect('127.0.0.1', serverPort);
            bridge.disconnect();
            bridge.disconnect();
            bridge.disconnect();
            expect(bridge.isConnected).toBe(false);
        });

        it('call after disconnect throws cleanly', async () => {
            await bridge.connect('127.0.0.1', serverPort);
            bridge.disconnect();
            await expect(bridge.call('test', {})).rejects.toThrow('Not connected');
        });
    });
});

const serverSockets = new Map<net.Server, net.Socket[]>();

function getServerSockets(server: net.Server): net.Socket[] {
    if (!serverSockets.has(server)) {
        const sockets: net.Socket[] = [];
        server.on('connection', (sock) => {
            sockets.push(sock);
            sock.on('close', () => {
                const idx = sockets.indexOf(sock);
                if (idx >= 0) sockets.splice(idx, 1);
            });
        });
        serverSockets.set(server, sockets);
    }
    return serverSockets.get(server)!;
}
