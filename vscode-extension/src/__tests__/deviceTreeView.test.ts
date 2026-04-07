import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('vscode', () => {
    class MockTreeItem {
        label: string;
        collapsibleState: number;
        description?: string;
        iconPath?: any;
        contextValue?: string;
        command?: any;

        constructor(label: string, collapsibleState: number) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    }

    return {
        TreeItem: MockTreeItem,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class ThemeIcon { constructor(public id: string) {} },
        EventEmitter: class VscodeEmitter {
            private _cbs: Function[] = [];
            event = (cb: Function) => { this._cbs.push(cb); };
            fire(data: any) { this._cbs.forEach(cb => cb(data)); }
        },
        workspace: {
            getConfiguration: () => ({ update: vi.fn().mockResolvedValue(undefined) }),
        },
        ConfigurationTarget: { Global: 1 },
    };
});

import type { WNDevice } from '../discovery/bonjourDiscovery';

function makeDevice(overrides?: Partial<WNDevice>): WNDevice {
    return {
        name: 'TestApp',
        host: '192.168.1.100',
        port: 27042,
        bundleId: 'com.test.app',
        deviceName: 'iPhone 15',
        systemVersion: '18.0',
        model: 'iPhone15,1',
        wnVersion: '1.0.0',
        enginePort: 27043,
        engineType: 'jscore',
        inspectorPort: 9222,
        ...overrides,
    };
}

class MockDiscovery extends EventEmitter {
    private devices: WNDevice[] = [];

    setDevices(devices: WNDevice[]): void {
        this.devices = devices;
    }

    getDevices(): WNDevice[] {
        return this.devices;
    }
}

class MockDeviceManager extends EventEmitter {
    private connected: WNDevice | null = null;
    private _isConnected = false;

    setConnected(device: WNDevice | null): void {
        this.connected = device;
        this._isConnected = device !== null;
    }

    get isConnected(): boolean {
        return this._isConnected;
    }

    getConnectedDevice(): WNDevice | null {
        return this.connected;
    }

    isConnectedTo(device: WNDevice): boolean {
        if (!this.connected) { return false; }
        return this.connected.host === device.host && this.connected.port === device.port;
    }
}

import { DeviceTreeProvider } from '../views/deviceTreeView';

describe('DeviceTreeProvider', () => {
    let discovery: MockDiscovery;
    let deviceManager: MockDeviceManager;
    let treeProvider: DeviceTreeProvider;

    beforeEach(() => {
        discovery = new MockDiscovery();
        deviceManager = new MockDeviceManager();
        treeProvider = new DeviceTreeProvider(discovery as any, deviceManager as any);
    });

    describe('getChildren (root level)', () => {
        it('shows scanning message when no devices found', async () => {
            discovery.setDevices([]);
            const items = await treeProvider.getChildren();
            expect(items.length).toBe(1);
            expect(items[0].label).toBe('Scanning for devices...');
        });

        it('lists discovered devices', async () => {
            const d1 = makeDevice({ host: '10.0.0.1', deviceName: 'iPhone A' });
            const d2 = makeDevice({ host: '10.0.0.2', deviceName: 'iPhone B' });
            discovery.setDevices([d1, d2]);

            const items = await treeProvider.getChildren();
            expect(items.length).toBe(2);
            expect(items[0].label).toBe('iPhone A');
            expect(items[1].label).toBe('iPhone B');
        });

        it('marks connected device with correct contextValue', async () => {
            const device = makeDevice();
            discovery.setDevices([device]);
            deviceManager.setConnected(device);

            const items = await treeProvider.getChildren();
            expect(items.length).toBe(1);
            expect(items[0].contextValue).toBe('connectedDevice');
        });

        it('marks disconnected devices with "device" contextValue', async () => {
            const device = makeDevice();
            discovery.setDevices([device]);

            const items = await treeProvider.getChildren();
            expect(items[0].contextValue).toBe('device');
        });

        it('shows description as bundleId', async () => {
            const device = makeDevice({ bundleId: 'com.example.myapp' });
            discovery.setDevices([device]);

            const items = await treeProvider.getChildren();
            expect(items[0].description).toBe('com.example.myapp');
        });

        it('adds connect command to disconnected devices', async () => {
            const device = makeDevice();
            discovery.setDevices([device]);

            const items = await treeProvider.getChildren();
            expect(items[0].command?.command).toBe('whiteneedle.connectDevice');
        });

        it('does not add connect command to connected device', async () => {
            const device = makeDevice();
            discovery.setDevices([device]);
            deviceManager.setConnected(device);

            const items = await treeProvider.getChildren();
            expect(items[0].command).toBeUndefined();
        });
    });

    describe('connected device not in discovery (fallback / manual IP)', () => {
        it('includes manually connected device in tree even when not discovered', async () => {
            discovery.setDevices([]);
            const manualDevice = makeDevice({
                host: '10.0.0.99',
                deviceName: '10.0.0.99', // manual IP shows IP as name
                enginePort: 27042,
            });
            deviceManager.setConnected(manualDevice);

            const items = await treeProvider.getChildren();
            expect(items.length).toBe(1);
            expect(items[0].label).toBe('10.0.0.99');
            expect(items[0].contextValue).toBe('connectedDevice');
        });

        it('does not duplicate connected device when it matches a discovered one', async () => {
            const device = makeDevice({ host: '10.0.0.1', enginePort: 27043 });
            discovery.setDevices([device]);
            deviceManager.setConnected(device);

            const items = await treeProvider.getChildren();
            expect(items.length).toBe(1);
        });

        it('BUG: dedup uses host:enginePort but isConnectedTo uses host:port - can cause mismatch', async () => {
            // Device discovered via Bonjour with port=27042, enginePort=27043
            const discoveredDevice = makeDevice({
                host: '10.0.0.1',
                port: 27042,
                enginePort: 27043,
            });
            discovery.setDevices([discoveredDevice]);

            // Same device connected manually with port=27043 (used enginePort as port)
            const connectedDevice = makeDevice({
                host: '10.0.0.1',
                port: 27043,
                enginePort: 27043,
            });
            deviceManager.setConnected(connectedDevice);

            const items = await treeProvider.getChildren();
            // listRootDevices dedupes by host:enginePort, so it should see them as the same
            // But isConnectedTo checks host+port, and port differs (27042 vs 27043)
            // This means the tree may show the device but not mark it as connected
            const connectedItems = items.filter(i => i.contextValue === 'connectedDevice');
            // The discovered device has port=27042, but connected has port=27043
            // isConnectedTo(discoveredDevice) → false because ports differ
            expect(connectedItems.length).toBe(0); // BUG: should be 1
        });
    });

    describe('getChildren (detail level)', () => {
        it('shows device details when expanded', async () => {
            const device = makeDevice({
                host: '192.168.1.100',
                port: 27042,
                bundleId: 'com.test.app',
                systemVersion: '18.0',
                model: 'iPhone15,1',
                enginePort: 27043,
                engineType: 'jscore',
                wnVersion: '1.0.0',
            });
            discovery.setDevices([device]);

            const rootItems = await treeProvider.getChildren();
            const details = await treeProvider.getChildren(rootItems[0]);

            expect(details.length).toBe(7);
            expect(details.some(d => (d.label as string).includes('IP'))).toBe(true);
            expect(details.some(d => (d.label as string).includes('Bundle'))).toBe(true);
            expect(details.some(d => (d.label as string).includes('iOS'))).toBe(true);
            expect(details.some(d => (d.label as string).includes('Model'))).toBe(true);
        });
    });

    describe('refresh', () => {
        it('fires onDidChangeTreeData event on refresh()', () => {
            const spy = vi.fn();
            treeProvider.onDidChangeTreeData(spy);
            treeProvider.refresh();
            expect(spy).toHaveBeenCalled();
        });

        it('refreshes when discovery emits deviceFound', () => {
            const spy = vi.fn();
            treeProvider.onDidChangeTreeData(spy);
            discovery.emit('deviceFound', makeDevice());
            expect(spy).toHaveBeenCalled();
        });

        it('refreshes when discovery emits deviceLost', () => {
            const spy = vi.fn();
            treeProvider.onDidChangeTreeData(spy);
            discovery.emit('deviceLost', makeDevice());
            expect(spy).toHaveBeenCalled();
        });

        it('refreshes when deviceManager state changes', () => {
            const spy = vi.fn();
            treeProvider.onDidChangeTreeData(spy);
            deviceManager.emit('stateChanged', 'connected');
            expect(spy).toHaveBeenCalled();
        });
    });

    describe('manual IP device display', () => {
        it('BUG: manual IP device shows IP as deviceName instead of actual device name', async () => {
            discovery.setDevices([]);
            const manualDevice: WNDevice = {
                name: 'Manual (169.254.115.191)',
                host: '169.254.115.191',
                port: 27042,
                bundleId: 'manual',
                deviceName: '169.254.115.191', // This is the bug: should be resolved to actual device name
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };
            deviceManager.setConnected(manualDevice);

            const items = await treeProvider.getChildren();
            expect(items.length).toBe(1);
            // Currently shows IP as label
            expect(items[0].label).toBe('169.254.115.191');
            // Should ideally show a real device name after querying the device
        });

        it('shows "unknown" fields for manual connection', async () => {
            discovery.setDevices([]);
            const manualDevice = makeDevice({
                deviceName: '10.0.0.1',
                bundleId: 'manual',
                systemVersion: 'unknown',
                model: 'unknown',
            });
            deviceManager.setConnected(manualDevice);

            const rootItems = await treeProvider.getChildren();
            const details = await treeProvider.getChildren(rootItems[0]);
            const iosDetail = details.find(d => (d.label as string).includes('iOS'));
            expect(iosDetail?.label).toContain('unknown');
        });
    });
});
