import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { TcpClient } from '../tcpClient.js';

function createMockServer(): net.Server & { port: number } {
    const server = net.createServer() as net.Server & { port: number };
    server.port = 0;
    return server;
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

describe('TcpClient', () => {
    let mockServer: net.Server;
    let client: TcpClient;
    let serverPort: number;

    beforeEach(async () => {
        mockServer = createMockServer();
        serverPort = await listen(mockServer);
        client = new TcpClient();
    });

    afterEach(async () => {
        client.disconnect();
        await closeServer(mockServer);
    });

    it('connects and sets isConnected', async () => {
        expect(client.isConnected).toBe(false);
        await client.connect('127.0.0.1', serverPort);
        expect(client.isConnected).toBe(true);
    });

    it('disconnects cleanly', async () => {
        await client.connect('127.0.0.1', serverPort);
        client.disconnect();
        expect(client.isConnected).toBe(false);
    });

    it('sends JSON-RPC and receives response', async () => {
        mockServer.on('connection', (sock) => {
            sock.on('data', (data) => {
                const req = JSON.parse(data.toString().trim());
                const response = {
                    jsonrpc: '2.0',
                    id: req.id,
                    result: { classes: ['NSObject', 'UIView'] },
                };
                sock.write(JSON.stringify(response) + '\n');
            });
        });

        await client.connect('127.0.0.1', serverPort);
        const result = await client.call('getClassNames', { filter: '' });
        expect(result).toEqual({ classes: ['NSObject', 'UIView'] });
    });

    it('rejects on JSON-RPC error response', async () => {
        mockServer.on('connection', (sock) => {
            sock.on('data', (data) => {
                const req = JSON.parse(data.toString().trim());
                const response = {
                    jsonrpc: '2.0',
                    id: req.id,
                    error: { code: -32600, message: 'Invalid request' },
                };
                sock.write(JSON.stringify(response) + '\n');
            });
        });

        await client.connect('127.0.0.1', serverPort);
        await expect(client.call('badMethod', {})).rejects.toThrow('Invalid request');
    });

    it('throws when calling without connection', async () => {
        await expect(client.call('getClassNames', {})).rejects.toThrow('Not connected');
    });

    it('emits disconnected on server close', async () => {
        await client.connect('127.0.0.1', serverPort);

        const disconnectedPromise = new Promise<void>((resolve) => {
            client.on('disconnected', resolve);
        });

        mockServer.close();

        for (const sock of await getServerSockets(mockServer)) {
            sock.destroy();
        }

        await disconnectedPromise;
        expect(client.isConnected).toBe(false);
    });

    it('handles notifications from server', async () => {
        mockServer.on('connection', (sock) => {
            const notification = {
                jsonrpc: '2.0',
                method: 'console',
                params: { level: 'log', message: 'hello' },
            };
            sock.write(JSON.stringify(notification) + '\n');
        });

        const notifPromise = new Promise<Record<string, unknown>>((resolve) => {
            client.on('console', (params: Record<string, unknown>) => resolve(params));
        });

        await client.connect('127.0.0.1', serverPort);
        const params = await notifPromise;
        expect(params).toEqual({ level: 'log', message: 'hello' });
    });

    it('rejects all pending on disconnect', async () => {
        mockServer.on('connection', () => {
            // don't respond
        });

        await client.connect('127.0.0.1', serverPort);
        const callPromise = client.call('neverResponds', {});
        client.disconnect();
        await expect(callPromise).rejects.toThrow('Disconnected');
    });
});

function getServerSockets(server: net.Server): Promise<net.Socket[]> {
    return new Promise((resolve) => {
        const sockets: net.Socket[] = [];
        server.getConnections((_err, _count) => {
            resolve(sockets);
        });
        server.on('connection', (sock) => sockets.push(sock));
    });
}
