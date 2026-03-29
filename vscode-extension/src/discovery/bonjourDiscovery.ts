import { EventEmitter } from 'events';
import Bonjour, { type Service } from 'bonjour-service';

const SERVICE_TYPE = 'whiteneedle';

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
    inspectorPort: number;
    raw?: Service;
}

export class DeviceDiscovery extends EventEmitter {
    private bonjour: InstanceType<typeof Bonjour> | null = null;
    private browser: any = null;
    private devices: Map<string, WNDevice> = new Map();

    start(): void {
        this.bonjour = new Bonjour();
        this.browse();
    }

    stop(): void {
        this.browser?.stop();
        this.bonjour?.destroy();
        this.devices.clear();
    }

    restart(): void {
        this.stop();
        this.start();
    }

    getDevices(): WNDevice[] {
        return Array.from(this.devices.values());
    }

    private browse(): void {
        if (!this.bonjour) { return; }

        this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service: Service) => {
            const device = this.parseService(service);
            if (!device) { return; }

            const key = `${device.host}:${device.port}`;
            this.devices.set(key, device);
            this.emit('deviceFound', device);
        });

        this.browser.on('down', (service: Service) => {
            const addresses = service.addresses || [];
            for (const addr of addresses) {
                const key = `${addr}:${service.port}`;
                if (this.devices.has(key)) {
                    const device = this.devices.get(key)!;
                    this.devices.delete(key);
                    this.emit('deviceLost', device);
                }
            }
        });
    }

    private parseService(service: Service): WNDevice | null {
        const txt = service.txt || {};
        const addresses = service.addresses || [];
        const host = addresses.find(a => a.includes('.')) || addresses[0];
        if (!host) { return null; }

        const enginePort = parseInt(this.decodeTxt(txt['enginePort']) || String(service.port), 10);
        const inspectorPort = parseInt(this.decodeTxt(txt['inspectorPort']) || '9222', 10);

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
