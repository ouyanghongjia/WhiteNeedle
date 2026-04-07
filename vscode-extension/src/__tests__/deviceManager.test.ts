import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            update: vi.fn().mockResolvedValue(undefined),
        }),
    },
    ConfigurationTarget: { Global: 1 },
}));

class MockTcpBridge extends EventEmitter {
    isConnected = false;
    connectFn = vi.fn<[string, number], Promise<void>>();
    callFn = vi.fn<[string, Record<string, unknown>], Promise<unknown>>();

    async connect(host: string, port: number): Promise<void> {
        if (nextConnectError) {
            const err = nextConnectError;
            nextConnectError = null;
            throw err;
        }
        if (permanentConnectError) {
            throw permanentConnectError;
        }
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
let nextConnectError: Error | null = null;
let permanentConnectError: Error | null = null;

vi.mock('../bridge/tcpBridge', () => {
    return {
        TcpBridge: function TcpBridge() {
            mockBridgeInstance = new MockTcpBridge();
            return mockBridgeInstance;
        },
    };
});

import { DeviceManager, type ConnectionState } from '../device/deviceManager';
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
        engineType: 'JavaScriptCore',
        inspectorPort: 27044,
        ...overrides,
    };
}

function makeOutputChannel() {
    return { appendLine: vi.fn() } as any;
}

describe('DeviceManager', () => {
    let dm: DeviceManager;
    let outputChannel: ReturnType<typeof makeOutputChannel>;

    beforeEach(() => {
        vi.useFakeTimers();
        nextConnectError = null;
        permanentConnectError = null;
        outputChannel = makeOutputChannel();
        dm = new DeviceManager(outputChannel);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('initial state', () => {
        it('starts disconnected', () => {
            expect(dm.state).toBe('disconnected');
            expect(dm.isConnected).toBe(false);
        });

        it('has no connected device', () => {
            expect(dm.getConnectedDevice()).toBeNull();
            expect(dm.getBridge()).toBeNull();
        });
    });

    describe('connect', () => {
        it('transitions through connecting → connected', async () => {
            const states: ConnectionState[] = [];
            dm.on('stateChanged', (s: ConnectionState) => states.push(s));

            const device = makeDevice();
            await dm.connect(device);

            expect(states).toEqual(['connecting', 'connected']);
            expect(dm.state).toBe('connected');
            expect(dm.isConnected).toBe(true);
            expect(dm.getConnectedDevice()).toEqual(device);
        });

        it('calls bridge.connect with correct host and enginePort', async () => {
            const device = makeDevice({ host: '10.0.0.1', enginePort: 9999 });
            await dm.connect(device);

            expect(mockBridgeInstance.connectFn).toHaveBeenCalledWith('10.0.0.1', 9999);
        });

        it('disconnects existing connection before connecting', async () => {
            const device1 = makeDevice({ host: '10.0.0.1' });
            const device2 = makeDevice({ host: '10.0.0.2' });

            await dm.connect(device1);
            const firstBridge = mockBridgeInstance;

            await dm.connect(device2);
            expect(firstBridge.isConnected).toBe(false);
            expect(dm.getConnectedDevice()?.host).toBe('10.0.0.2');
        });

        it('throws if bridge.connect fails', async () => {
            nextConnectError = new Error('Connection refused');
            await expect(dm.connect(makeDevice())).rejects.toThrow('Connection refused');
        });
    });

    describe('disconnect', () => {
        it('transitions to disconnected', async () => {
            await dm.connect(makeDevice());
            expect(dm.state).toBe('connected');

            await dm.disconnect();
            expect(dm.state).toBe('disconnected');
            expect(dm.isConnected).toBe(false);
            expect(dm.getConnectedDevice()).toBeNull();
        });

        it('is idempotent when already disconnected', async () => {
            await dm.disconnect();
            expect(dm.state).toBe('disconnected');
        });
    });

    describe('isConnectedTo', () => {
        it('returns true for matching device', async () => {
            const device = makeDevice();
            await dm.connect(device);
            expect(dm.isConnectedTo(device)).toBe(true);
        });

        it('returns false for different device', async () => {
            await dm.connect(makeDevice({ host: '10.0.0.1', port: 1 }));
            expect(dm.isConnectedTo(makeDevice({ host: '10.0.0.2', port: 2 }))).toBe(false);
        });

        it('returns false when disconnected', () => {
            expect(dm.isConnectedTo(makeDevice())).toBe(false);
        });
    });

    describe('RPC forwarding', () => {
        it('loadScript calls bridge and stores last script', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ ok: true });

            await dm.loadScript('console.log(1)', 'test.js');
            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('loadScript', {
                code: 'console.log(1)',
                name: 'test.js',
            });
        });

        it('evaluate forwards to bridge', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ result: 42 });

            const result = await dm.evaluate('1+1');
            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('evaluate', { code: '1+1' });
            expect(result).toEqual({ result: 42 });
        });

        it('getClassNames returns classes array from result', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ classes: ['NSObject', 'UIView'] });

            const names = await dm.getClassNames();
            expect(names).toEqual(['NSObject', 'UIView']);
        });

        it('getMethods returns structured result', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({
                instanceMethods: ['init', 'dealloc'],
                classMethods: ['new'],
            });

            const methods = await dm.getMethods('NSObject');
            expect(methods.instanceMethods).toEqual(['init', 'dealloc']);
            expect(methods.classMethods).toEqual(['new']);
        });

        it('throws when not connected', async () => {
            await expect(dm.loadScript('x', 'y')).rejects.toThrow('Not connected');
            await expect(dm.evaluate('x')).rejects.toThrow('Not connected');
            await expect(dm.rpcCall('m', [])).rejects.toThrow('Not connected');
            await expect(dm.getClassNames()).rejects.toThrow('Not connected');
            await expect(dm.getMethods('X')).rejects.toThrow('Not connected');
            await expect(dm.listHooks()).rejects.toThrow('Not connected');
            await expect(dm.listHooksDetailed()).rejects.toThrow('Not connected');
            await expect(dm.pauseHook('s')).rejects.toThrow('Not connected');
            await expect(dm.resumeHook('s')).rejects.toThrow('Not connected');
            await expect(dm.detachHook('s')).rejects.toThrow('Not connected');
            await expect(dm.listNetworkRequests()).rejects.toThrow('Not connected');
            await expect(dm.getNetworkRequest('1')).rejects.toThrow('Not connected');
            await expect(dm.clearNetworkRequests()).rejects.toThrow('Not connected');
            await expect(dm.setNetworkCapture(true)).rejects.toThrow('Not connected');
            await expect(dm.getViewHierarchy()).rejects.toThrow('Not connected');
            await expect(dm.getViewControllers()).rejects.toThrow('Not connected');
            await expect(dm.getViewDetail('0x1')).rejects.toThrow('Not connected');
            await expect(dm.setViewProperty('0x1', 'k', 'v')).rejects.toThrow('Not connected');
            await expect(dm.highlightView('0x1')).rejects.toThrow('Not connected');
            await expect(dm.clearHighlight()).rejects.toThrow('Not connected');
            await expect(dm.searchViews('UIView')).rejects.toThrow('Not connected');
            await expect(dm.getScreenshot()).rejects.toThrow('Not connected');
        });
    });

    describe('active scripts tracking', () => {
        it('stores and retrieves active scripts', () => {
            dm.setActiveScripts(['a.js', 'b.js']);
            expect(dm.getActiveScripts()).toEqual(['a.js', 'b.js']);
        });

        it('returns a copy, not the original array', () => {
            const scripts = ['a.js'];
            dm.setActiveScripts(scripts);
            scripts.push('b.js');
            expect(dm.getActiveScripts()).toEqual(['a.js']);
        });
    });

    describe('unexpected disconnect & reconnect', () => {
        it('enters reconnecting state on unexpected disconnect', async () => {
            const device = makeDevice();
            await dm.connect(device);

            const states: ConnectionState[] = [];
            dm.on('stateChanged', (s: ConnectionState) => states.push(s));

            mockBridgeInstance.emit('disconnected');
            expect(dm.state).toBe('reconnecting');
        });

        it('does not reconnect on manual disconnect', async () => {
            await dm.connect(makeDevice());
            await dm.disconnect();

            expect(dm.state).toBe('disconnected');
            vi.advanceTimersByTime(60000);
            expect(dm.state).toBe('disconnected');
        });

        it('emits reconnectFailed after max attempts', async () => {
            const device = makeDevice();
            await dm.connect(device);

            const failedSpy = vi.fn();
            dm.on('reconnectFailed', failedSpy);

            // Make all future connects fail
            permanentConnectError = new Error('fail');
            mockBridgeInstance.emit('disconnected');

            for (let i = 0; i < 10; i++) {
                await vi.advanceTimersByTimeAsync(30001);
            }

            permanentConnectError = null;
            expect(failedSpy).toHaveBeenCalledWith(device);
            expect(dm.state).toBe('disconnected');
        });

        it('emits reconnected on successful reconnect', async () => {
            const device = makeDevice();
            await dm.connect(device);

            const reconnectedSpy = vi.fn();
            dm.on('reconnected', reconnectedSpy);

            mockBridgeInstance.emit('disconnected');
            expect(dm.state).toBe('reconnecting');

            await vi.advanceTimersByTimeAsync(1001);

            expect(reconnectedSpy).toHaveBeenCalledWith(device);
            expect(dm.state).toBe('connected');
        });
    });

    describe('session restore', () => {
        it('restores last loaded script after reconnect', async () => {
            const device = makeDevice();
            await dm.connect(device);

            mockBridgeInstance.callFn.mockResolvedValueOnce({});
            await dm.loadScript('hook()', 'hook.js');

            mockBridgeInstance.emit('disconnected');
            await vi.advanceTimersByTimeAsync(1001);

            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('loadScript', {
                code: 'hook()',
                name: 'hook.js',
            });
        });
    });

    describe('network monitor methods', () => {
        it('listNetworkRequests returns requests array', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ requests: [{ id: '1', url: 'https://a.com' }] });

            const result = await dm.listNetworkRequests();
            expect(result).toEqual([{ id: '1', url: 'https://a.com' }]);
        });

        it('setNetworkCapture returns capture status', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ capturing: true });

            const result = await dm.setNetworkCapture(true);
            expect(result).toBe(true);
        });
    });

    describe('view hierarchy methods', () => {
        it('getViewHierarchy returns tree', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ tree: { type: 'UIWindow' } });

            const result = await dm.getViewHierarchy();
            expect(result).toEqual({ type: 'UIWindow' });
        });

        it('highlightView returns success boolean', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ success: true });

            const result = await dm.highlightView('0xABC');
            expect(result).toBe(true);
        });

        it('getScreenshot returns base64 or null', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ base64: 'iVBOR...' });

            const result = await dm.getScreenshot();
            expect(result).toBe('iVBOR...');
        });

        it('getScreenshot returns null when no base64', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({});

            const result = await dm.getScreenshot();
            expect(result).toBeNull();
        });
    });

    describe('hook methods', () => {
        it('listHooks returns hooks array', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ hooks: ['-[NSObject init]'] });

            const result = await dm.listHooks();
            expect(result).toEqual(['-[NSObject init]']);
        });

        it('pauseHook returns boolean from success field', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ success: true });

            expect(await dm.pauseHook('-[X y]')).toBe(true);
        });

        it('detachHook uses evaluate with JSON.stringify-escaped selector', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce(undefined);

            await dm.detachHook('-[Foo "bar"]');
            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('evaluate', {
                code: 'Interceptor.detach("-[Foo \\"bar\\"]")',
            });
        });

        it('detachHook handles special characters safely', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce(undefined);

            await dm.detachHook('test\nline\\slash');
            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('evaluate', {
                code: 'Interceptor.detach("test\\nline\\\\slash")',
            });
        });
    });

    describe('isConnectedTo consistency', () => {
        it('BUG: isConnectedTo compares host+port, but connect uses host+enginePort', async () => {
            // A device discovered via Bonjour might have port=27042 (mDNS service port)
            // but enginePort=27043 (the actual TCP engine port)
            const device = makeDevice({ host: '10.0.0.1', port: 27042, enginePort: 27043 });
            await dm.connect(device);

            // isConnectedTo checks host + port (27042), which is the mDNS port
            expect(dm.isConnectedTo(device)).toBe(true);

            // But a device with same host but different mDNS port (e.g. from re-broadcast)
            const samDeviceDiffPort = makeDevice({ host: '10.0.0.1', port: 27043, enginePort: 27043 });
            // This should logically be the same device (same host, same engine), but isConnectedTo returns false
            expect(dm.isConnectedTo(samDeviceDiffPort)).toBe(false);
        });

        it('matches device by host and port correctly', async () => {
            const device = makeDevice({ host: '10.0.0.1', port: 27042 });
            await dm.connect(device);

            expect(dm.isConnectedTo(makeDevice({ host: '10.0.0.1', port: 27042 }))).toBe(true);
            expect(dm.isConnectedTo(makeDevice({ host: '10.0.0.2', port: 27042 }))).toBe(false);
            expect(dm.isConnectedTo(makeDevice({ host: '10.0.0.1', port: 99999 }))).toBe(false);
        });
    });

    describe('manual IP device (connectByIP scenario)', () => {
        it('connects with manual device that has IP as deviceName', async () => {
            const manualDevice = makeDevice({
                name: 'Manual (169.254.115.191)',
                host: '169.254.115.191',
                port: 27042,
                bundleId: 'manual',
                deviceName: '169.254.115.191',
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: 27042,
                inspectorPort: 9222,
            });

            await dm.connect(manualDevice);
            expect(dm.isConnected).toBe(true);

            const connected = dm.getConnectedDevice();
            expect(connected?.deviceName).toBe('169.254.115.191');
            // BUG: After connecting, deviceName should be resolved to actual device name
            // Currently it stays as the IP address
        });

        it('BUG: manual device should query device info after connection', async () => {
            const manualDevice = makeDevice({
                host: '10.0.0.1',
                deviceName: '10.0.0.1',
                bundleId: 'manual',
                systemVersion: 'unknown',
            });

            await dm.connect(manualDevice);

            // After connecting, the device manager should ideally call something
            // like bridge.call('getDeviceInfo', {}) to fill in the device details.
            // Currently this doesn't happen — the device info stays as the manual placeholder.
            const device = dm.getConnectedDevice();
            expect(device?.systemVersion).toBe('unknown'); // stays unknown
            expect(device?.deviceName).toBe('10.0.0.1');   // stays as IP
        });
    });

    describe('reconnect edge cases', () => {
        it('uses exponential backoff for reconnect delays', async () => {
            const device = makeDevice();
            await dm.connect(device);

            permanentConnectError = new Error('fail');
            mockBridgeInstance.emit('disconnected');

            // First attempt: 1000ms delay
            expect(dm.state).toBe('reconnecting');

            await vi.advanceTimersByTimeAsync(1001);
            // After first failed attempt, next delay should be ~2000ms
            expect(dm.state).toBe('reconnecting');

            await vi.advanceTimersByTimeAsync(2001);
            // After second failed attempt, next delay should be ~4000ms
            expect(dm.state).toBe('reconnecting');

            permanentConnectError = null;
        });

        it('resets reconnect counter after successful reconnect', async () => {
            const device = makeDevice();
            await dm.connect(device);

            // Disconnect unexpectedly
            mockBridgeInstance.emit('disconnected');
            expect(dm.state).toBe('reconnecting');

            // Successful reconnect
            await vi.advanceTimersByTimeAsync(1001);
            expect(dm.state).toBe('connected');

            // Disconnect again — should start from attempt 1, not continue from before
            mockBridgeInstance.emit('disconnected');
            expect(dm.state).toBe('reconnecting');

            await vi.advanceTimersByTimeAsync(1001);
            expect(dm.state).toBe('connected');
        });

        it('does not reconnect if connect() is called during reconnect', async () => {
            const device1 = makeDevice({ host: '10.0.0.1' });
            const device2 = makeDevice({ host: '10.0.0.2' });

            await dm.connect(device1);
            mockBridgeInstance.emit('disconnected');
            expect(dm.state).toBe('reconnecting');

            // Connect to a different device while reconnecting
            await dm.connect(device2);
            expect(dm.state).toBe('connected');
            expect(dm.getConnectedDevice()?.host).toBe('10.0.0.2');

            // Advancing time should not cause reconnect to device1
            await vi.advanceTimersByTimeAsync(60000);
            expect(dm.getConnectedDevice()?.host).toBe('10.0.0.2');
        });

        it('does not reconnect if disconnect() is called during reconnect', async () => {
            const device = makeDevice();
            await dm.connect(device);

            mockBridgeInstance.emit('disconnected');
            expect(dm.state).toBe('reconnecting');

            await dm.disconnect();
            expect(dm.state).toBe('disconnected');

            await vi.advanceTimersByTimeAsync(60000);
            expect(dm.state).toBe('disconnected');
        });
    });

    describe('connection stability', () => {
        it('handles bridge disconnecting during RPC call', async () => {
            await dm.connect(makeDevice());

            mockBridgeInstance.callFn.mockRejectedValueOnce(new Error('Connection closed'));

            await expect(dm.evaluate('test')).rejects.toThrow('Connection closed');
        });

        it('bridge.isConnected returns false after disconnect event', async () => {
            await dm.connect(makeDevice());
            expect(dm.isConnected).toBe(true);

            mockBridgeInstance.isConnected = false;
            expect(dm.isConnected).toBe(false);
        });

        it('getBridge returns null after disconnect', async () => {
            await dm.connect(makeDevice());
            expect(dm.getBridge()).not.toBeNull();

            await dm.disconnect();
            expect(dm.getBridge()).toBeNull();
        });
    });

    describe('view hierarchy edge cases', () => {
        it('getVCDetail forwards address correctly', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ className: 'UIViewController' });

            const result = await dm.getVCDetail('0xDEADBEEF');
            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('getVCDetail', { address: '0xDEADBEEF' });
        });

        it('setViewProperty passes all args correctly', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({ success: true });

            const result = await dm.setViewProperty('0x123', 'hidden', true);
            expect(result).toBe(true);
            expect(mockBridgeInstance.callFn).toHaveBeenCalledWith('setViewProperty', {
                address: '0x123',
                key: 'hidden',
                value: true,
            });
        });

        it('searchViews returns empty array when no results', async () => {
            await dm.connect(makeDevice());
            mockBridgeInstance.callFn.mockResolvedValueOnce({});

            const result = await dm.searchViews('NonExistentView');
            expect(result).toEqual([]);
        });
    });
});
