/**
 * Manages USB tunnel lifecycle for device connections.
 *
 * When DeviceManager wants to connect to a USB device, this manager creates
 * a usbmuxd tunnel and returns host/port that TcpBridge can connect to.
 *
 * Design: Instead of refactoring TcpBridge to accept raw sockets, we create
 * a local TCP server that proxies to the usbmuxd tunnel. This keeps the
 * existing TcpBridge code untouched — it just connects to localhost:localPort.
 */

import * as net from 'net';
import { UsbmuxdClient } from './usbmuxd';

interface ActiveTunnel {
    localServer: net.Server;
    localPort: number;
    usbDeviceId: number;
    remotePort: number;
    tunnelSocket: net.Socket | null;
}

export class UsbTunnelManager {
    private tunnels = new Map<string, ActiveTunnel>();

    /**
     * Create a local TCP proxy that tunnels to the USB device.
     * Returns { host: '127.0.0.1', port: localPort } for TcpBridge to connect.
     */
    async createTunnel(usbDeviceId: number, remotePort: number): Promise<{ host: string; port: number }> {
        const key = `${usbDeviceId}:${remotePort}`;

        // Reuse existing tunnel if available
        const existing = this.tunnels.get(key);
        if (existing) {
            return { host: '127.0.0.1', port: existing.localPort };
        }

        const localPort = await this.findFreePort();
        const tunnel = await this.startLocalProxy(usbDeviceId, remotePort, localPort);
        this.tunnels.set(key, tunnel);

        return { host: '127.0.0.1', port: localPort };
    }

    /**
     * Tear down a specific tunnel.
     */
    closeTunnel(usbDeviceId: number, remotePort: number): void {
        const key = `${usbDeviceId}:${remotePort}`;
        const tunnel = this.tunnels.get(key);
        if (!tunnel) { return; }

        tunnel.tunnelSocket?.destroy();
        tunnel.localServer.close();
        this.tunnels.delete(key);
    }

    /**
     * Close all active tunnels.
     */
    closeAll(): void {
        for (const [key, tunnel] of this.tunnels.entries()) {
            tunnel.tunnelSocket?.destroy();
            tunnel.localServer.close();
            this.tunnels.delete(key);
        }
    }

    hasTunnel(usbDeviceId: number, remotePort: number): boolean {
        return this.tunnels.has(`${usbDeviceId}:${remotePort}`);
    }

    private async startLocalProxy(usbDeviceId: number, remotePort: number, localPort: number): Promise<ActiveTunnel> {
        const tunnel: ActiveTunnel = {
            localServer: net.createServer(),
            localPort,
            usbDeviceId,
            remotePort,
            tunnelSocket: null,
        };

        tunnel.localServer.on('connection', async (clientSocket) => {
            const client = new UsbmuxdClient();
            try {
                const usbSocket = await client.connect(usbDeviceId, remotePort);
                tunnel.tunnelSocket = usbSocket;

                // Bidirectional piping
                clientSocket.pipe(usbSocket);
                usbSocket.pipe(clientSocket);

                clientSocket.on('close', () => usbSocket.destroy());
                usbSocket.on('close', () => clientSocket.destroy());
                clientSocket.on('error', () => usbSocket.destroy());
                usbSocket.on('error', () => clientSocket.destroy());
            } catch (err) {
                clientSocket.destroy();
            }
        });

        return new Promise((resolve, reject) => {
            tunnel.localServer.listen(localPort, '127.0.0.1', () => {
                resolve(tunnel);
            });
            tunnel.localServer.on('error', reject);
        });
    }

    private findFreePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const srv = net.createServer();
            srv.listen(0, '127.0.0.1', () => {
                const addr = srv.address() as net.AddressInfo;
                srv.close(() => resolve(addr.port));
            });
            srv.on('error', reject);
        });
    }
}
