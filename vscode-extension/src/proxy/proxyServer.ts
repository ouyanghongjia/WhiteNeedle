import * as http from 'http';
import * as net from 'net';
import * as url from 'url';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';

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
    private _port = 0;
    private _running = false;

    get port(): number { return this._port; }
    get running(): boolean { return this._running; }

    updateRules(rules: HostMappingRule[]): void {
        this.rules.clear();
        for (const r of rules) {
            this.rules.set(r.hostname.toLowerCase(), r.ip);
        }
        this.emit('rulesUpdated', rules.length);
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
        if (mapped) {
            this.emit('log', `CONNECT ${hostname}:${port} → ${resolvedHost}:${port}`);
        }

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

        serverSocket.on('error', (err) => {
            this.emit('log', `CONNECT error ${hostname}:${port} → ${err.message}`);
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        });

        clientSocket.on('error', () => {
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

        if (mapped) {
            this.emit('log', `HTTP ${clientReq.method} ${hostname} → ${resolvedHost}`);
        }

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
