/**
 * USB device discovery for WhiteNeedle.
 *
 * Uses the native usbmuxd client to detect attached iOS devices over USB,
 * then probes the WhiteNeedle engine port to confirm the framework is running.
 * Emits the same event interface as Bonjour discovery so both can feed into
 * a unified device list.
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { UsbmuxdClient, UsbDevice } from './usbmuxd';
import { WNDevice } from '../discovery/bonjourDiscovery';

const ENGINE_PORT = 27042;
const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 3000;

export class UsbDiscovery extends EventEmitter {
    private client: UsbmuxdClient | null = null;
    private knownDevices = new Map<number, WNDevice>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;

    get running(): boolean {
        return this._running;
    }

    getDevices(): WNDevice[] {
        return Array.from(this.knownDevices.values());
    }

    async start(): Promise<void> {
        if (this._running) { return; }
        this._running = true;
        this.client = new UsbmuxdClient();

        try {
            // Initial scan
            await this.scanDevices();
        } catch {
            // usbmuxd may not be available — degrade gracefully
        }

        // Periodic polling: re-enumerate and probe engine availability.
        // We use polling rather than usbmuxd Listen because the Listen channel
        // only reports USB attach/detach — it can't tell us when the *app* starts
        // (and WhiteNeedle engine becomes available on the port).
        this.pollTimer = setInterval(() => {
            this.scanDevices().catch(() => { /* ignore */ });
        }, POLL_INTERVAL_MS);
    }

    stop(): void {
        this._running = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.client?.stopListening();
        this.client = null;

        for (const [id, device] of this.knownDevices.entries()) {
            this.knownDevices.delete(id);
            this.emit('deviceLost', device);
        }
    }

    private async scanDevices(): Promise<void> {
        if (!this.client) { return; }

        let devices: UsbDevice[];
        try {
            devices = await this.client.listDevices();
        } catch {
            return;
        }

        const currentIds = new Set<number>();
        for (const dev of devices) {
            const id = dev.DeviceID ?? dev.Properties?.DeviceID;
            if (!id) { continue; }
            currentIds.add(id);

            if (this.knownDevices.has(id)) { continue; }

            // Probe the engine port through USB tunnel
            const wnDevice = await this.probeDevice(dev);
            if (wnDevice) {
                this.knownDevices.set(id, wnDevice);
                this.emit('deviceFound', wnDevice);
            }
        }

        // Remove devices that are no longer connected
        for (const [id, device] of this.knownDevices.entries()) {
            if (!currentIds.has(id)) {
                this.knownDevices.delete(id);
                this.emit('deviceLost', device);
            }
        }
    }

    /**
     * Probe a USB device to see if WhiteNeedle engine is running.
     * Creates a transient usbmuxd tunnel, sends a JSON-RPC ping, and
     * extracts device metadata from the response.
     */
    private async probeDevice(usbDev: UsbDevice): Promise<WNDevice | null> {
        const client = new UsbmuxdClient();
        const deviceId = usbDev.DeviceID ?? usbDev.Properties?.DeviceID;
        const serial = usbDev.Properties?.SerialNumber || usbDev.Properties?.USBSerialNumber || '';

        let tunnelSocket: net.Socket;
        try {
            tunnelSocket = await client.connect(deviceId, ENGINE_PORT);
        } catch {
            return null;
        }

        try {
            const pingResult = await this.sendPing(tunnelSocket);
            tunnelSocket.destroy();

            return {
                name: `USB: ${serial.substring(0, 12) || deviceId}`,
                host: '127.0.0.1',
                port: ENGINE_PORT,
                bundleId: pingResult?.bundleId || 'unknown',
                deviceName: pingResult?.deviceName || `USB-${serial.substring(0, 8)}`,
                systemVersion: pingResult?.systemVersion || 'unknown',
                model: pingResult?.model || 'unknown',
                wnVersion: pingResult?.wnVersion || 'unknown',
                enginePort: ENGINE_PORT,
                engineType: pingResult?.engineType || 'jscore',
                inspectorPort: 0,
                transport: 'usb',
                usbDeviceId: deviceId,
                serialNumber: serial,
                // Use engine-reported deviceId (matches Bonjour TXT) for consistent dedup
                deviceId: pingResult?.deviceId || serial || String(deviceId),
            } as WNDevice;
        } catch {
            tunnelSocket.destroy();
            return null;
        }
    }

    private sendPing(sock: net.Socket): Promise<Record<string, string> | null> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                sock.removeAllListeners('data');
                resolve(null);
            }, PROBE_TIMEOUT_MS);

            let buf = '';
            sock.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                const nlIdx = buf.indexOf('\n');
                if (nlIdx < 0) { return; }
                clearTimeout(timeout);
                sock.removeAllListeners('data');

                try {
                    const msg = JSON.parse(buf.substring(0, nlIdx));
                    resolve(msg?.result || null);
                } catch {
                    resolve(null);
                }
            });

            const pingMsg = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'ping',
                params: {},
            }) + '\n';
            sock.write(pingMsg);
        });
    }
}
