/**
 * USB device discovery for WhiteNeedle.
 *
 * Uses the native usbmuxd client to detect attached iOS devices over USB,
 * then probes WhiteNeedle engine ports to confirm the framework is running.
 * A single physical device may host multiple apps each listening on a
 * different port (27042, 27043, …, up to 27062). Each app appears as a
 * separate entry in the device list.
 *
 * Emits the same event interface as Bonjour discovery so both can feed into
 * a unified device list.
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { UsbmuxdClient, UsbDevice } from './usbmuxd';
import { WNDevice } from '../discovery/bonjourDiscovery';

const ENGINE_PORT_BASE = 27042;
const ENGINE_PORT_RANGE = 20;
const PROBE_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 3000;

/**
 * Composite key: a physical USB device + port uniquely identifies one app.
 */
function slotKey(usbDeviceId: number, port: number): string {
    return `${usbDeviceId}:${port}`;
}

export class UsbDiscovery extends EventEmitter {
    private client: UsbmuxdClient | null = null;
    private knownDevices = new Map<string, WNDevice>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;
    private _scanning = false;

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
            await this.scanDevices();
        } catch {
            // usbmuxd may not be available — degrade gracefully
        }

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

        for (const [key, device] of this.knownDevices.entries()) {
            this.knownDevices.delete(key);
            this.emit('deviceLost', device);
        }
    }

    private async scanDevices(): Promise<void> {
        if (!this.client || this._scanning) { return; }
        this._scanning = true;

        try {
            await this.doScan();
        } finally {
            this._scanning = false;
        }
    }

    private async doScan(): Promise<void> {
        let devices: UsbDevice[];
        try {
            devices = await this.client!.listDevices();
        } catch {
            return;
        }

        const activeKeys = new Set<string>();

        for (const dev of devices) {
            const id = dev.DeviceID ?? dev.Properties?.DeviceID;
            if (!id) { continue; }

            const foundDevices = await this.probeAllPorts(dev);
            for (const wnDevice of foundDevices) {
                const key = slotKey(id, wnDevice.enginePort);
                activeKeys.add(key);

                const existing = this.knownDevices.get(key);
                if (!existing) {
                    this.knownDevices.set(key, wnDevice);
                    this.emit('deviceFound', wnDevice);
                } else if (existing.bundleId !== wnDevice.bundleId) {
                    this.knownDevices.set(key, wnDevice);
                    this.emit('deviceLost', existing);
                    this.emit('deviceFound', wnDevice);
                }
            }
        }

        // Remove entries whose USB device is gone or whose port no longer responds
        for (const [key, device] of this.knownDevices.entries()) {
            if (!activeKeys.has(key)) {
                this.knownDevices.delete(key);
                this.emit('deviceLost', device);
            }
        }
    }

    /**
     * Probe all ports in range for a single physical USB device.
     * Runs probes in parallel for speed.
     */
    private async probeAllPorts(usbDev: UsbDevice): Promise<WNDevice[]> {
        const deviceId = usbDev.DeviceID ?? usbDev.Properties?.DeviceID;
        const serial = usbDev.Properties?.SerialNumber || usbDev.Properties?.USBSerialNumber || '';

        const ports: number[] = [];
        for (let i = 0; i <= ENGINE_PORT_RANGE; i++) {
            ports.push(ENGINE_PORT_BASE + i);
        }

        const results = await Promise.all(
            ports.map(port => this.probePort(deviceId, serial, port))
        );

        return results.filter((d): d is WNDevice => d !== null);
    }

    /**
     * Probe a single port on a USB device.
     * Creates a transient usbmuxd tunnel, sends a JSON-RPC ping, and
     * extracts device metadata from the response.
     */
    private async probePort(deviceId: number, serial: string, port: number): Promise<WNDevice | null> {
        const client = new UsbmuxdClient();

        let tunnelSocket: net.Socket;
        try {
            tunnelSocket = await client.connect(deviceId, port);
        } catch {
            return null;
        }

        try {
            const pingResult = await this.sendPing(tunnelSocket);
            tunnelSocket.destroy();

            if (!pingResult) { return null; }

            return {
                name: `USB: ${serial.substring(0, 12) || deviceId}`,
                host: '127.0.0.1',
                port,
                bundleId: pingResult.bundleId || 'unknown',
                deviceName: pingResult.deviceName || `USB-${serial.substring(0, 8)}`,
                systemVersion: pingResult.systemVersion || 'unknown',
                model: pingResult.model || 'unknown',
                wnVersion: pingResult.wnVersion || 'unknown',
                enginePort: port,
                engineType: pingResult.engineType || 'jscore',
                inspectorPort: 0,
                transport: 'usb',
                usbDeviceId: deviceId,
                serialNumber: serial,
                deviceId: pingResult.deviceId || serial || String(deviceId),
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
