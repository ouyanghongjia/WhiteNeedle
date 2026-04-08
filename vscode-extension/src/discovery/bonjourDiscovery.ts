import { EventEmitter } from 'events';
import Bonjour, { type Service } from 'bonjour-service';

const SERVICE_TYPE = 'whiteneedle';
const REBROWSE_INTERVAL_MS = 5000;
const MAX_REBROWSE_ATTEMPTS = 12;

export interface WNDevice {
    name: string;
    host: string;
    port: number;
    bundleId: string;
    deviceName: string;
    systemVersion: string;
    model: string;
    wnVersion: string;
    enginePort: number;
    engineType: string;
    /** @deprecated No longer advertised; debugging uses ios_webkit_debug_proxy */
    inspectorPort: number;
    raw?: Service;
}

export class DeviceDiscovery extends EventEmitter {
    private bonjour: InstanceType<typeof Bonjour> | null = null;
    private browser: any = null;
    private devices: Map<string, WNDevice> = new Map();
    private rebrowseTimer: ReturnType<typeof setInterval> | null = null;
    private rebrowseCount = 0;

    start(): void {
        this.stop();
        this.bonjour = new Bonjour();
        this.rebrowseCount = 0;
        this.browse();
        this.startRebrowseTimer();
    }

    stop(): void {
        this.stopRebrowseTimer();
        this.browser?.stop();
        this.bonjour?.destroy();
        this.bonjour = null;
        this.browser = null;
        this.devices.clear();
    }

    restart(): void {
        this.stop();
        this.start();
    }

    getDevices(): WNDevice[] {
        return Array.from(this.devices.values());
    }

    /**
     * Periodically re-create the mDNS browser to send fresh queries.
     * Stops automatically after finding a device or after MAX_REBROWSE_ATTEMPTS.
     */
    private startRebrowseTimer(): void {
        this.stopRebrowseTimer();
        this.rebrowseTimer = setInterval(() => {
            if (this.devices.size > 0) {
                this.stopRebrowseTimer();
                return;
            }
            this.rebrowseCount++;
            if (this.rebrowseCount > MAX_REBROWSE_ATTEMPTS) {
                this.stopRebrowseTimer();
                return;
            }
            this.rebrowse();
        }, REBROWSE_INTERVAL_MS);
    }

    private stopRebrowseTimer(): void {
        if (this.rebrowseTimer) {
            clearInterval(this.rebrowseTimer);
            this.rebrowseTimer = null;
        }
    }

    /**
     * Destroy and recreate the Bonjour instance + browser to force
     * fresh mDNS queries. Preserves existing device list.
     */
    private rebrowse(): void {
        const savedDevices = new Map(this.devices);
        this.browser?.stop();
        this.bonjour?.destroy();
        this.bonjour = new Bonjour();
        this.devices = savedDevices;
        this.browse();
    }

    /**
     * Build a stable identity key for a physical device.
     * Uses bundleId + deviceName so the same iPad on WiFi and USB merges into one entry.
     * Falls back to host:port when TXT metadata is missing.
     */
    private deviceIdentityKey(device: WNDevice): string {
        if (device.bundleId && device.bundleId !== 'unknown' && device.deviceName) {
            return `${device.bundleId}@${device.deviceName}`;
        }
        return `${device.host}:${device.port}`;
    }

    /**
     * Choose the better IP when the same device is reachable from multiple interfaces.
     * Prefer routable LAN addresses over link-local (169.254.x.x / fe80::).
     */
    private isLinkLocal(host: string): boolean {
        return host.startsWith('169.254.') || host.startsWith('fe80');
    }

    private browse(): void {
        if (!this.bonjour) { return; }

        this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service: Service) => {
            const device = this.parseService(service);
            if (!device) { return; }

            const key = this.deviceIdentityKey(device);
            const existing = this.devices.get(key);
            if (existing) {
                // Same logical device seen again — prefer routable IP over link-local
                if (this.isLinkLocal(existing.host) && !this.isLinkLocal(device.host)) {
                    this.devices.set(key, device);
                    this.emit('deviceUpdated', device);
                } else if (!this.isLinkLocal(existing.host) && this.isLinkLocal(device.host)) {
                    // Keep existing routable IP, but store alternate addresses for reference
                } else {
                    this.devices.set(key, device);
                }
            } else {
                this.devices.set(key, device);
                this.emit('deviceFound', device);
            }
        });

        this.browser.on('down', (service: Service) => {
            const parsed = this.parseService(service);
            if (!parsed) { return; }
            const key = this.deviceIdentityKey(parsed);
            if (this.devices.has(key)) {
                const device = this.devices.get(key)!;
                this.devices.delete(key);
                this.emit('deviceLost', device);
            }
        });
    }

    private parseService(service: Service): WNDevice | null {
        const txt = service.txt || {};
        const addresses = service.addresses || [];
        const host = addresses.find(a => a.includes('.')) || addresses[0];
        if (!host) { return null; }

        const enginePort = parseInt(this.decodeTxt(txt['enginePort']) || String(service.port), 10);
        const inspectorPort = parseInt(this.decodeTxt(txt['inspectorPort']) || '0', 10);

        return {
            name: service.name,
            host,
            port: service.port,
            bundleId: this.decodeTxt(txt['bundleId']) || 'unknown',
            deviceName: this.decodeTxt(txt['device']) || service.name,
            systemVersion: this.decodeTxt(txt['systemVersion']) || 'unknown',
            model: this.decodeTxt(txt['model']) || 'unknown',
            wnVersion: this.decodeTxt(txt['wnVersion']) || 'unknown',
            enginePort,
            engineType: this.decodeTxt(txt['engineType']) || 'jscore',
            inspectorPort,
            raw: service,
        };
    }

    private decodeTxt(value: any): string {
        if (!value) { return ''; }
        if (typeof value === 'string') { return value; }
        if (Buffer.isBuffer(value)) { return value.toString('utf8'); }
        return String(value);
    }
}
