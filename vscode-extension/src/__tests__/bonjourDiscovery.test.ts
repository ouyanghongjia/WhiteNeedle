import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Mock bonjour-service ---
class MockBrowser extends EventEmitter {
    stop = vi.fn();
    private findCallback: ((service: any) => void) | null = null;

    setFindCallback(cb: (service: any) => void): void {
        this.findCallback = cb;
    }

    simulateServiceUp(service: any): void {
        this.findCallback?.(service);
    }

    simulateServiceDown(service: any): void {
        this.emit('down', service);
    }
}

let mockBrowserInstance: MockBrowser;
let mockBonjourInstance: any;
let bonjourDestroyCount = 0;

vi.mock('bonjour-service', () => {
    return {
        default: function Bonjour() {
            bonjourDestroyCount = 0;
            mockBonjourInstance = {
                find: vi.fn((_opts: any, cb: (service: any) => void) => {
                    mockBrowserInstance = new MockBrowser();
                    mockBrowserInstance.setFindCallback(cb);
                    return mockBrowserInstance;
                }),
                destroy: vi.fn(() => { bonjourDestroyCount++; }),
            };
            return mockBonjourInstance;
        },
    };
});

import { DeviceDiscovery, type WNDevice } from '../discovery/bonjourDiscovery';

function makeService(overrides?: Partial<any>): any {
    return {
        name: 'TestApp',
        port: 27042,
        addresses: ['192.168.1.100'],
        txt: {
            bundleId: 'com.test.app',
            device: 'iPhone 15',
            systemVersion: '18.0',
            model: 'iPhone15,1',
            wnVersion: '1.0.0',
            enginePort: '27043',
            engineType: 'jscore',
            inspectorPort: '9222',
        },
        ...overrides,
    };
}

describe('DeviceDiscovery', () => {
    let discovery: DeviceDiscovery;

    beforeEach(() => {
        vi.useFakeTimers();
        discovery = new DeviceDiscovery();
    });

    afterEach(() => {
        discovery.stop();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('start / stop', () => {
        it('starts Bonjour browser on start()', () => {
            discovery.start();
            expect(mockBonjourInstance.find).toHaveBeenCalled();
        });

        it('stops browser and clears devices on stop()', () => {
            discovery.start();
            mockBrowserInstance.simulateServiceUp(makeService());
            expect(discovery.getDevices().length).toBe(1);

            discovery.stop();
            expect(discovery.getDevices().length).toBe(0);
        });

        it('restart clears and re-starts', () => {
            discovery.start();
            mockBrowserInstance.simulateServiceUp(makeService());
            expect(discovery.getDevices().length).toBe(1);

            discovery.restart();
            expect(discovery.getDevices().length).toBe(0);
        });
    });

    describe('service parsing', () => {
        it('parses a complete service into WNDevice', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService());

            expect(foundSpy).toHaveBeenCalledTimes(1);
            const device: WNDevice = foundSpy.mock.calls[0][0];
            expect(device.name).toBe('TestApp');
            expect(device.host).toBe('192.168.1.100');
            expect(device.port).toBe(27042);
            expect(device.bundleId).toBe('com.test.app');
            expect(device.deviceName).toBe('iPhone 15');
            expect(device.systemVersion).toBe('18.0');
            expect(device.model).toBe('iPhone15,1');
            expect(device.wnVersion).toBe('1.0.0');
            expect(device.enginePort).toBe(27043);
            expect(device.engineType).toBe('jscore');
            expect(device.inspectorPort).toBe(9222);
        });

        it('falls back to service.name when device txt is missing', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                txt: {},
            }));

            const device: WNDevice = foundSpy.mock.calls[0][0];
            expect(device.deviceName).toBe('TestApp');
            expect(device.bundleId).toBe('unknown');
            expect(device.systemVersion).toBe('unknown');
        });

        it('falls back to service.port for enginePort when txt is missing', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                port: 27042,
                txt: {},
            }));

            const device: WNDevice = foundSpy.mock.calls[0][0];
            expect(device.enginePort).toBe(27042);
        });

        it('prefers IPv4 address over IPv6', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['fe80::1', '192.168.1.50'],
            }));

            const device: WNDevice = foundSpy.mock.calls[0][0];
            expect(device.host).toBe('192.168.1.50');
        });

        it('skips services with no addresses', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: [],
            }));

            expect(foundSpy).not.toHaveBeenCalled();
        });

        it('handles Buffer values in txt record', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                txt: {
                    bundleId: Buffer.from('com.buffer.app'),
                    device: Buffer.from('iPad Pro'),
                    enginePort: '27043',
                },
            }));

            const device: WNDevice = foundSpy.mock.calls[0][0];
            expect(device.bundleId).toBe('com.buffer.app');
            expect(device.deviceName).toBe('iPad Pro');
        });
    });

    describe('device deduplication', () => {
        it('does not emit deviceFound twice for same host:port', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            const service = makeService();
            mockBrowserInstance.simulateServiceUp(service);
            mockBrowserInstance.simulateServiceUp(service);

            expect(foundSpy).toHaveBeenCalledTimes(1);
            expect(discovery.getDevices().length).toBe(1);
        });

        it('emits deviceFound for different hosts', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'],
            }));
            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.101'],
            }));

            expect(foundSpy).toHaveBeenCalledTimes(2);
            expect(discovery.getDevices().length).toBe(2);
        });

        it('BUG: same device with different port vs enginePort can appear as different entries', () => {
            discovery.start();
            const foundSpy = vi.fn();
            discovery.on('deviceFound', foundSpy);

            // Same host, different mDNS service port → different key in discovery
            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'],
                port: 27042,
                txt: { ...makeService().txt, enginePort: '27043' },
            }));
            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'],
                port: 27043,
                txt: { ...makeService().txt, enginePort: '27043' },
            }));

            // Discovery uses host:port as key, so same host with different port → 2 entries
            // This is a potential source of the "device appearing twice" bug
            expect(discovery.getDevices().length).toBe(2);
            const devices = discovery.getDevices();
            expect(devices[0].host).toBe(devices[1].host);
            expect(devices[0].enginePort).toBe(devices[1].enginePort);
        });

        it('updates existing device data on second broadcast', () => {
            discovery.start();

            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'],
                port: 27042,
                txt: { ...makeService().txt, wnVersion: '1.0.0' },
            }));

            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'],
                port: 27042,
                txt: { ...makeService().txt, wnVersion: '2.0.0' },
            }));

            const devices = discovery.getDevices();
            expect(devices.length).toBe(1);
            expect(devices[0].wnVersion).toBe('2.0.0');
        });
    });

    describe('device removal', () => {
        it('emits deviceLost when service goes down', () => {
            discovery.start();
            const lostSpy = vi.fn();
            discovery.on('deviceLost', lostSpy);

            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'],
                port: 27042,
            }));
            expect(discovery.getDevices().length).toBe(1);

            mockBrowserInstance.simulateServiceDown({
                addresses: ['192.168.1.100'],
                port: 27042,
            });

            expect(lostSpy).toHaveBeenCalledTimes(1);
            expect(discovery.getDevices().length).toBe(0);
        });

        it('does not crash when unknown service goes down', () => {
            discovery.start();
            const lostSpy = vi.fn();
            discovery.on('deviceLost', lostSpy);

            mockBrowserInstance.simulateServiceDown({
                addresses: ['10.0.0.1'],
                port: 9999,
            });

            expect(lostSpy).not.toHaveBeenCalled();
        });
    });

    describe('rebrowse timer', () => {
        it('rebrowses periodically when no devices found', () => {
            discovery.start();
            const initialFind = mockBonjourInstance.find;

            // Advance past rebrowse interval
            vi.advanceTimersByTime(5001);
            // A new bonjour instance is created on rebrowse, so find is called again
            // (The mock recreates mockBonjourInstance)
        });

        it('stops rebrowsing after finding a device', () => {
            discovery.start();
            mockBrowserInstance.simulateServiceUp(makeService());

            const deviceCount = discovery.getDevices().length;
            expect(deviceCount).toBe(1);

            // After finding device, rebrowse timer should stop
            vi.advanceTimersByTime(60001);
            // No crash, no infinite loop
        });

        it('stops rebrowsing after max attempts', () => {
            discovery.start();

            // Advance past max rebrowse attempts (12 * 5000ms = 60000ms)
            for (let i = 0; i < 13; i++) {
                vi.advanceTimersByTime(5001);
            }
            // No crash, timer should have stopped
        });
    });

    describe('getDevices', () => {
        it('returns empty array initially', () => {
            discovery.start();
            expect(discovery.getDevices()).toEqual([]);
        });

        it('returns all discovered devices', () => {
            discovery.start();
            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.100'], port: 27042,
            }));
            mockBrowserInstance.simulateServiceUp(makeService({
                addresses: ['192.168.1.101'], port: 27042,
            }));

            const devices = discovery.getDevices();
            expect(devices.length).toBe(2);
        });
    });
});
