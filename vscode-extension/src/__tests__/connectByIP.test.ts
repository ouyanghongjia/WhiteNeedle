/**
 * Tests for manual IP connection flow, fallback connection,
 * and device info resolution after connecting.
 *
 * These tests cover the logic in extension.ts commands:
 * - whiteneedle.connectByIP
 * - scheduleLastDeviceFallback
 * - auto-connect via Bonjour discovery
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            update: vi.fn().mockResolvedValue(undefined),
            get: vi.fn((key: string, def?: any) => def),
        }),
    },
    ConfigurationTarget: { Global: 1 },
}));

class MockTcpBridge extends EventEmitter {
    isConnected = false;
    connectFn = vi.fn<[string, number], Promise<void>>();
    callFn = vi.fn<[string, Record<string, unknown>], Promise<unknown>>();

    async connect(host: string, port: number): Promise<void> {
        await this.connectFn(host, port);
        this.isConnected = true;
    }

    disconnect(): void {
        this.isConnected = false;
    }

    async call(method: string, params: Record<string, unknown>): Promise<unknown> {
        return this.callFn(method, params);
    }
}

let mockBridgeInstance: MockTcpBridge;

vi.mock('../bridge/tcpBridge', () => ({
    TcpBridge: function TcpBridge() {
        mockBridgeInstance = new MockTcpBridge();
        return mockBridgeInstance;
    },
}));

import { DeviceManager } from '../device/deviceManager';
import type { WNDevice } from '../discovery/bonjourDiscovery';

function makeOutputChannel() {
    return { appendLine: vi.fn() } as any;
}

describe('Manual IP Connection (connectByIP)', () => {
    let dm: DeviceManager;
    let outputChannel: ReturnType<typeof makeOutputChannel>;

    beforeEach(() => {
        outputChannel = makeOutputChannel();
        dm = new DeviceManager(outputChannel);
    });

    describe('IP address parsing validation', () => {
        it('valid IP:PORT format should be accepted', () => {
            const valid = '192.168.1.10:27042';
            expect(valid.match(/^[\d.]+:\d+$/)).toBeTruthy();
        });

        it('rejects IP without port', () => {
            const invalid = '192.168.1.10';
            expect(invalid.match(/^[\d.]+:\d+$/)).toBeNull();
        });

        it('rejects hostname format', () => {
            const invalid = 'mydevice.local:27042';
            expect(invalid.match(/^[\d.]+:\d+$/)).toBeNull();
        });

        it('rejects empty string', () => {
            const invalid = '';
            expect(invalid.match(/^[\d.]+:\d+$/)).toBeNull();
        });

        it('rejects port-only format', () => {
            const invalid = ':27042';
            expect(invalid.match(/^[\d.]+:\d+$/)).toBeNull();
        });

        it('accepts USB link-local addresses', () => {
            const valid = '169.254.115.191:27042';
            expect(valid.match(/^[\d.]+:\d+$/)).toBeTruthy();
        });
    });

    describe('manual device creation', () => {
        it('creates WNDevice from IP:PORT input', () => {
            const input = '169.254.115.191:27042';
            const [host, portStr] = input.split(':');
            const port = parseInt(portStr, 10);

            const manualDevice: WNDevice = {
                name: `Manual (${host})`,
                host,
                port,
                bundleId: 'manual',
                deviceName: host,
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: port,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            expect(manualDevice.host).toBe('169.254.115.191');
            expect(manualDevice.port).toBe(27042);
            expect(manualDevice.enginePort).toBe(27042);
            expect(manualDevice.deviceName).toBe('169.254.115.191');
        });

        it('BUG: deviceName is set to raw IP address, not actual device name', () => {
            const host = '10.0.0.1';
            const manualDevice: WNDevice = {
                name: `Manual (${host})`,
                host,
                port: 27042,
                bundleId: 'manual',
                deviceName: host, // This is the bug
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            // The deviceName should be resolved after connection by querying the device
            // Currently it stays as the IP address
            expect(manualDevice.deviceName).toBe('10.0.0.1');
            expect(manualDevice.bundleId).toBe('manual');
            expect(manualDevice.systemVersion).toBe('unknown');
        });
    });

    describe('connecting with manual device', () => {
        it('successfully connects to manual IP device', async () => {
            const manualDevice: WNDevice = {
                name: 'Manual (10.0.0.1)',
                host: '10.0.0.1',
                port: 27042,
                bundleId: 'manual',
                deviceName: '10.0.0.1',
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            await dm.connect(manualDevice);
            expect(dm.isConnected).toBe(true);
            expect(dm.getConnectedDevice()?.host).toBe('10.0.0.1');
        });

        it('port is used as both service port and engine port', async () => {
            const manualDevice: WNDevice = {
                name: 'Manual (10.0.0.1)',
                host: '10.0.0.1',
                port: 27042,
                bundleId: 'manual',
                deviceName: '10.0.0.1',
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            await dm.connect(manualDevice);
            // connect() uses device.enginePort for actual TCP connection
            expect(mockBridgeInstance.connectFn).toHaveBeenCalledWith('10.0.0.1', 27042);
        });
    });

    describe('device info resolution after manual connect', () => {
        it('BUG: does not query device info after manual connection', async () => {
            const manualDevice: WNDevice = {
                name: 'Manual (10.0.0.1)',
                host: '10.0.0.1',
                port: 27042,
                bundleId: 'manual',
                deviceName: '10.0.0.1',
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            await dm.connect(manualDevice);

            // Currently the bridge.call is NOT called with getDeviceInfo or similar
            const callArgs = mockBridgeInstance.callFn.mock.calls;
            const hasDeviceInfoCall = callArgs.some(
                ([method]) => method === 'getDeviceInfo' || method === 'deviceInfo'
            );
            expect(hasDeviceInfoCall).toBe(false);

            // The device info stays as placeholder values
            const device = dm.getConnectedDevice()!;
            expect(device.deviceName).toBe('10.0.0.1');
            expect(device.systemVersion).toBe('unknown');
            expect(device.model).toBe('unknown');
            expect(device.bundleId).toBe('manual');
        });

        it('EXPECTED: after connect, should update device with queried info', async () => {
            // This test documents what the expected behavior should be:
            // After connecting to a manual IP device, the DeviceManager should
            // call something like bridge.call('getDeviceInfo', {}) to get the
            // actual device name, model, iOS version, bundleId, etc.
            // Then update the connectedDevice with that info.

            const manualDevice: WNDevice = {
                name: 'Manual (10.0.0.1)',
                host: '10.0.0.1',
                port: 27042,
                bundleId: 'manual',
                deviceName: '10.0.0.1',
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            await dm.connect(manualDevice);

            // After connecting, device info is still raw — this is the bug
            expect(dm.getConnectedDevice()?.deviceName).toBe('10.0.0.1');
        });
    });

    describe('fallback connection (scheduleLastDeviceFallback)', () => {
        it('fallback device uses lastHost from configuration', () => {
            const lastHost = '192.168.1.50';
            const port = 27042;
            const inspectorPort = 9222;

            const fallbackDevice: WNDevice = {
                name: `Fallback (${lastHost})`,
                host: lastHost,
                port,
                bundleId: 'unknown',
                deviceName: lastHost,
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: port,
                engineType: 'jscore',
                inspectorPort,
            };

            expect(fallbackDevice.deviceName).toBe(lastHost);
            expect(fallbackDevice.bundleId).toBe('unknown');
        });

        it('BUG: fallback device also has IP as deviceName', () => {
            const lastHost = '10.0.0.5';
            const fallbackDevice: WNDevice = {
                name: `Fallback (${lastHost})`,
                host: lastHost,
                port: 27042,
                bundleId: 'unknown',
                deviceName: lastHost,
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            // Same issue as manual connect — deviceName is just the IP
            expect(fallbackDevice.deviceName).toBe('10.0.0.5');
        });
    });

    describe('auto-connect via Bonjour', () => {
        it('Bonjour-discovered devices have full device info', () => {
            // When a device is discovered via Bonjour, it has full info from TXT records
            const bonjourDevice: WNDevice = {
                name: 'WhiteNeedle App',
                host: '192.168.1.100',
                port: 27042,
                bundleId: 'com.example.myapp',
                deviceName: 'iPhone 15 Pro',
                systemVersion: '18.0',
                model: 'iPhone16,1',
                wnVersion: '1.0.0',
                enginePort: 27043,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            expect(bonjourDevice.deviceName).toBe('iPhone 15 Pro');
            expect(bonjourDevice.model).toBe('iPhone16,1');
            expect(bonjourDevice.bundleId).not.toBe('manual');
            expect(bonjourDevice.bundleId).not.toBe('unknown');
        });
    });

    describe('device deduplication between Bonjour and manual', () => {
        it('manual device and Bonjour device for same host should be recognized as same', async () => {
            const manualDevice: WNDevice = {
                name: 'Manual (192.168.1.100)',
                host: '192.168.1.100',
                port: 27042,
                bundleId: 'manual',
                deviceName: '192.168.1.100',
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            await dm.connect(manualDevice);

            const bonjourDevice: WNDevice = {
                name: 'WhiteNeedle App',
                host: '192.168.1.100',
                port: 27042,
                bundleId: 'com.example.app',
                deviceName: 'iPhone 15',
                systemVersion: '18.0',
                model: 'iPhone15,1',
                wnVersion: '1.0.0',
                enginePort: 27043,
                engineType: 'jscore',
                inspectorPort: 9222,
            };

            // Manual device has bundleId='manual' (treated as 'unknown' by identity check).
            // Bonjour device has a real bundleId+deviceName, so isConnectedTo falls back
            // to host+port comparison. Manual port=27042, Bonjour port=27042 → match.
            // However, manual deviceName='192.168.1.100' vs Bonjour deviceName='iPhone 15'
            // AND Bonjour bundleId is valid, so identity path fires and returns false.
            // This is a known limitation when mixing manual and discovered devices.
            expect(dm.isConnectedTo(bonjourDevice)).toBe(false);

            // But if the Bonjour device has a different enginePort than the manual one,
            // the tree dedup (which uses host:enginePort) might see them as different
            // This inconsistency can lead to the device appearing twice in the tree
        });

        it('BUG: manual port=27042 vs Bonjour enginePort=27043 causes dedup mismatch in tree', () => {
            // In the tree provider, listRootDevices uses:
            //   key = `${d.host}:${d.enginePort}`
            //
            // Manual device: host=10.0.0.1, enginePort=27042
            // Bonjour device: host=10.0.0.1, enginePort=27043
            // → Different keys → both appear in tree
            //
            // In DeviceManager.isConnectedTo:
            //   host === device.host && port === device.port
            //
            // Manual device: port=27042
            // Bonjour device: port=27042 (mDNS service port)
            // → Same → device shows as connected
            //
            // Result: Bonjour device appears in tree BUT shows as connected,
            // while the manual device also appears → two entries, one connected

            const manualKey = '10.0.0.1:27042';
            const bonjourKey = '10.0.0.1:27043';
            expect(manualKey).not.toBe(bonjourKey); // Different keys = two entries
        });
    });
});
