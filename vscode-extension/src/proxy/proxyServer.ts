import * as http from 'http';
import * as net from 'net';
import * as url from 'url';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';

interface ConnectTunnel {
    client: Duplex;
    server: net.Socket | null;
}

export interface HostMappingRule {
    hostname: string;
    ip: string;
    groupTitle?: string;
}

/**
 * Lightweight HTTP/HTTPS forward proxy.
 * 
 * - HTTPS: Intercepts CONNECT tunnels, resolves hostname via host mapping,
 *   then relays raw TCP bytes. TLS is end-to-end between client and server,
 *   so SNI is preserved and no certificate is needed.
 * - HTTP:  Rewrites the target address using host mapping, forwards the
 *   request, and relays the response.
 */
export class ProxyServer extends EventEmitter {
    private server: http.Server | null = null;
    private rules: Map<string, string> = new Map();
    private connectTunnels: Set<ConnectTunnel> = new Set();
    private _port = 0;
    private _running = false;

    get port(): number { return this._port; }
    get running(): boolean { return this._running; }

    /**
     * Drop all active HTTPS CONNECT tunnels so the next request re-resolves host mapping.
     * Call when rules change so clients cannot keep using an upstream opened with old IP.
     */
    private closeAllConnectTunnels(reason: string): void {
        if (this.connectTunnels.size === 0) {
            return;
        }
        const n = this.connectTunnels.size;
        for (const t of this.connectTunnels) {
            try {
                t.server?.destroy();
                t.client.destroy();
            } catch {
                /* ignore */
            }
        }
        this.connectTunnels.clear();
        this.emit('log', `Closed ${n} HTTPS tunnel(s): ${reason}`);
    }

    updateRules(rules: HostMappingRule[]): void {
        const next = new Map<string, string>();
        for (const r of rules) {
            next.set(r.hostname.toLowerCase(), r.ip);
        }
        if (!this.rulesMapsEqual(this.rules, next)) {
            this.closeAllConnectTunnels('host mapping rules updated');
        }
        this.rules = next;
        this.emit('rulesUpdated', rules.length);
    }

    private rulesMapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
        if (a.size !== b.size) {
            return false;
        }
        for (const [k, v] of a) {
            if (b.get(k) !== v) {
                return false;
            }
        }
        return true;
    }

    private resolveHost(hostname: string): string {
        return this.rules.get(hostname.toLowerCase()) || hostname;
    }

    start(port: number): Promise<number> {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.stop();
            }

            const server = http.createServer((req, res) => {
                this.handleHttpRequest(req, res);
            });

            server.on('connect', (req, clientSocket, head) => {
                this.handleConnect(req, clientSocket, head);
            });

            server.on('error', (err) => {
                this.emit('error', err);
                reject(err);
            });

            server.listen(port, '0.0.0.0', () => {
                const addr = server.address();
                this._port = typeof addr === 'object' && addr ? addr.port : port;
                this._running = true;
                this.server = server;
                this.emit('started', this._port);
                resolve(this._port);
            });
        });
    }

    stop(): void {
        this.closeAllConnectTunnels('proxy stopped');
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this._running = false;
        this._port = 0;
        this.emit('stopped');
    }

    /**
     * CONNECT tunnel (HTTPS).
     * The client sends `CONNECT host:port HTTP/1.1`.
     * We resolve the hostname, open a TCP connection to the (possibly mapped) IP,
     * then relay bytes in both directions.
     */
    private handleConnect(
        req: http.IncomingMessage,
        clientSocket: Duplex,
        head: Buffer,
    ): void {
        const reqUrl = req.url || '';
        const [hostname, portStr] = reqUrl.split(':');
        const port = parseInt(portStr, 10) || 443;
        const resolvedHost = this.resolveHost(hostname);
        const mapped = resolvedHost !== hostname;
        const clientIp = req.socket.remoteAddress || 'unknown';
        this.emit(
            'log',
            `CONNECT ${hostname}:${port} -> ${resolvedHost}:${port} (mapped=${mapped ? 'yes' : 'no'}, client=${clientIp})`,
        );

        const tunnel: ConnectTunnel = { client: clientSocket, server: null };
        this.connectTunnels.add(tunnel);
        const detachTunnel = () => {
            this.connectTunnels.delete(tunnel);
        };
        clientSocket.once('close', detachTunnel);

        const serverSocket = net.connect(port, resolvedHost, () => {
            clientSocket.write(
                'HTTP/1.1 200 Connection Established\r\n' +
                'Proxy-Agent: WhiteNeedle-Proxy\r\n' +
                '\r\n',
            );
            if (head.length > 0) {
                serverSocket.write(head);
            }
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        tunnel.server = serverSocket;
        serverSocket.once('close', detachTunnel);

        serverSocket.on('error', (err) => {
            this.emit('log', `CONNECT error ${hostname}:${port} → ${err.message}`);
            detachTunnel();
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        });

        clientSocket.on('error', () => {
            detachTunnel();
            serverSocket.destroy();
        });
    }

    /**
     * Plain HTTP forward proxy.
     * The client sends a full-URL request like `GET http://host/path HTTP/1.1`.
     * We resolve the hostname, then forward to the (possibly mapped) IP.
     */
    private handleHttpRequest(
        clientReq: http.IncomingMessage,
        clientRes: http.ServerResponse,
    ): void {
        const reqUrl = clientReq.url || '/';

        if (!reqUrl.startsWith('http://')) {
            clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
            clientRes.end('WhiteNeedle Proxy: only absolute HTTP URLs are supported.\n');
            return;
        }

        const parsed = new url.URL(reqUrl);
        const hostname = parsed.hostname;
        const port = parseInt(parsed.port, 10) || 80;
        const resolvedHost = this.resolveHost(hostname);
        const mapped = resolvedHost !== hostname;
        const clientIp = clientReq.socket.remoteAddress || 'unknown';
        this.emit(
            'log',
            `HTTP ${clientReq.method || 'GET'} ${hostname}:${port}${parsed.pathname}${parsed.search} -> ${resolvedHost}:${port} (mapped=${mapped ? 'yes' : 'no'}, client=${clientIp})`,
        );

        const headers = { ...clientReq.headers };
        delete headers['proxy-connection'];
        if (!headers['host']) {
            headers['host'] = hostname;
        }

        const options: http.RequestOptions = {
            hostname: resolvedHost,
            port,
            path: parsed.pathname + parsed.search,
            method: clientReq.method,
            headers,
        };

        const proxyReq = http.request(options, (proxyRes) => {
            clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(clientRes);
        });

        proxyReq.on('error', (err) => {
            this.emit('log', `HTTP error ${hostname} → ${err.message}`);
            if (!clientRes.headersSent) {
                clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
            }
            clientRes.end(`Proxy error: ${err.message}\n`);
        });

        clientReq.pipe(proxyReq);
    }
}
