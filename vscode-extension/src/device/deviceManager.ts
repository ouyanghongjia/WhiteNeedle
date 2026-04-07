import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { WNDevice } from '../discovery/bonjourDiscovery';
import { TcpBridge } from '../bridge/tcpBridge';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

export class DeviceManager extends EventEmitter {
    private bridge: TcpBridge | null = null;
    private connectedDevice: WNDevice | null = null;
    private _state: ConnectionState = 'disconnected';
    private manualDisconnect = false;
    private reconnectAttempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private lastActiveScripts: string[] = [];
    private lastLoadedScript: { code: string; name: string } | null = null;

    constructor(private outputChannel: vscode.OutputChannel) {
        super();
    }

    get state(): ConnectionState {
        return this._state;
    }

    get isConnected(): boolean {
        return this._state === 'connected' && this.bridge?.isConnected === true;
    }

    isConnectedTo(device: WNDevice): boolean {
        if (!this.connectedDevice) { return false; }
        return (
            this.connectedDevice.host === device.host &&
            this.connectedDevice.port === device.port
        );
    }

    async connect(device: WNDevice): Promise<void> {
        if (this.isConnected) {
            await this.disconnect();
        }
        this.cancelReconnect();
        this.manualDisconnect = false;

        this.setState('connecting');
        this.outputChannel.appendLine(
            `[DeviceManager] Connecting to ${device.host}:${device.enginePort}...`
        );

        this.bridge = new TcpBridge(this.outputChannel);

        this.bridge.on('disconnected', () => {
            this.connectedDevice = null;
            if (!this.manualDisconnect) {
                this.onUnexpectedDisconnect(device);
            } else {
                this.setState('disconnected');
            }
        });

        await this.bridge.connect(device.host, device.enginePort);
        this.connectedDevice = device;
        this.reconnectAttempt = 0;
        this.setState('connected');

        const cfg = vscode.workspace.getConfiguration('whiteneedle');
        await cfg.update('deviceHost', device.host, vscode.ConfigurationTarget.Global);
        if (device.inspectorPort > 0) {
            await cfg.update('inspectorPort', device.inspectorPort, vscode.ConfigurationTarget.Global);
        }
        this.outputChannel.appendLine(
            `[DeviceManager] Connected (engine=${device.enginePort}, inspector=${device.inspectorPort})`
        );
    }

    async disconnect(): Promise<void> {
        this.manualDisconnect = true;
        this.cancelReconnect();
        if (this.bridge) {
            this.bridge.disconnect();
            this.bridge = null;
        }
        this.connectedDevice = null;
        this.setState('disconnected');
    }

    setActiveScripts(scripts: string[]): void {
        this.lastActiveScripts = [...scripts];
    }

    getActiveScripts(): string[] {
        return this.lastActiveScripts;
    }

    async loadScript(code: string, name: string): Promise<void> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        await this.bridge.call('loadScript', { code, name });
        this.lastLoadedScript = { code, name };
    }

    async unloadScript(name?: string): Promise<void> {
        if (!this.bridge?.isConnected) { return; }
        await this.bridge.call('unloadScript', { name: name || '' });
    }

    async evaluate(code: string): Promise<any> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        return await this.bridge.call('evaluate', { code });
    }

    async rpcCall(method: string, args: any[]): Promise<any> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        return await this.bridge.call('rpcCall', { method, args });
    }

    async getClassNames(filter?: string): Promise<string[]> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        const result = await this.bridge.call('getClassNames', { filter }) as any;
        return result?.classes || [];
    }

    async getMethods(className: string): Promise<{ instanceMethods: string[]; classMethods: string[] }> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        const result = await this.bridge.call('getMethods', { className }) as any;
        return {
            instanceMethods: result?.instanceMethods || [],
            classMethods: result?.classMethods || [],
        };
    }

    async listHooks(): Promise<string[]> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        const result = await this.bridge.call('listHooks', {}) as any;
        return result?.hooks || [];
    }

    async listHooksDetailed(): Promise<any[]> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        const result = await this.bridge.call('listHooksDetailed', {}) as any;
        return result?.hooks || [];
    }

    async pauseHook(selector: string): Promise<boolean> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        const result = await this.bridge.call('pauseHook', { selector }) as any;
        return result?.success === true;
    }

    async resumeHook(selector: string): Promise<boolean> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        const result = await this.bridge.call('resumeHook', { selector }) as any;
        return result?.success === true;
    }

    async detachHook(selector: string): Promise<void> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        await this.evaluate(`Interceptor.detach(${JSON.stringify(selector)})`);
    }

    // --- Network Monitor ---

    async listNetworkRequests(): Promise<any[]> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('listNetworkRequests', {}) as any;
        return result?.requests || [];
    }

    async getNetworkRequest(id: string): Promise<any> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        return await this.bridge.call('getNetworkRequest', { id });
    }

    async clearNetworkRequests(): Promise<void> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        await this.bridge.call('clearNetworkRequests', {});
    }

    async setNetworkCapture(enabled: boolean): Promise<boolean> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('setNetworkCapture', { enabled }) as any;
        return result?.capturing ?? enabled;
    }

    // --- View Hierarchy Inspector ---

    async getViewHierarchy(): Promise<any> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('getViewHierarchy', {}) as any;
        return result?.tree || {};
    }

    async getViewControllers(): Promise<any> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('getViewControllers', {}) as any;
        return result?.tree || {};
    }

    async getVCDetail(address: string): Promise<any> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        return await this.bridge.call('getVCDetail', { address });
    }

    async getViewDetail(address: string): Promise<any> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        return await this.bridge.call('getViewDetail', { address });
    }

    async setViewProperty(address: string, key: string, value: any): Promise<boolean> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('setViewProperty', { address, key, value }) as any;
        return result?.success === true;
    }

    async highlightView(address: string): Promise<boolean> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('highlightView', { address }) as any;
        return result?.success === true;
    }

    async clearHighlight(): Promise<void> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        await this.bridge.call('clearHighlight', {});
    }

    async searchViews(className: string): Promise<any[]> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('searchViews', { className }) as any;
        return result?.views || [];
    }

    async getScreenshot(): Promise<string | null> {
        if (!this.bridge?.isConnected) { throw new Error('Not connected to any device'); }
        const result = await this.bridge.call('getScreenshot', {}) as any;
        return result?.base64 || null;
    }

    getConnectedDevice(): WNDevice | null {
        return this.connectedDevice;
    }

    getBridge(): TcpBridge | null {
        return this.bridge;
    }

    private async restoreSessionState(): Promise<void> {
        if (!this.lastLoadedScript || !this.bridge?.isConnected) {
            return;
        }
        try {
            const { code, name } = this.lastLoadedScript;
            this.outputChannel.appendLine(
                `[DeviceManager] Restoring script "${name}" after reconnect...`
            );
            await this.bridge.call('loadScript', { code, name });
            this.outputChannel.appendLine(
                `[DeviceManager] Script "${name}" restored`
            );
        } catch (err: any) {
            this.outputChannel.appendLine(
                `[DeviceManager] Failed to restore script: ${err.message}`
            );
        }
    }

    private setState(state: ConnectionState): void {
        if (this._state === state) { return; }
        this._state = state;
        this.emit('stateChanged', state);
    }

    private cancelReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempt = 0;
    }

    private onUnexpectedDisconnect(device: WNDevice): void {
        this.outputChannel.appendLine(
            `[DeviceManager] Unexpected disconnect from ${device.deviceName || device.host}`
        );

        if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            this.outputChannel.appendLine(
                `[DeviceManager] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`
            );
            this.setState('disconnected');
            this.emit('reconnectFailed', device);
            return;
        }

        this.setState('reconnecting');
        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempt++;

        this.outputChannel.appendLine(
            `[DeviceManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`
        );

        this.reconnectTimer = setTimeout(async () => {
            try {
                this.bridge = new TcpBridge(this.outputChannel);
                this.bridge.on('disconnected', () => {
                    this.connectedDevice = null;
                    if (!this.manualDisconnect) {
                        this.onUnexpectedDisconnect(device);
                    } else {
                        this.setState('disconnected');
                    }
                });

                await this.bridge.connect(device.host, device.enginePort);
                this.connectedDevice = device;
                this.reconnectAttempt = 0;
                this.setState('connected');

                this.outputChannel.appendLine(
                    `[DeviceManager] Reconnected to ${device.deviceName || device.host}`
                );

                await this.restoreSessionState();
                this.emit('reconnected', device);
            } catch (err: any) {
                this.outputChannel.appendLine(
                    `[DeviceManager] Reconnect attempt ${this.reconnectAttempt} failed: ${err.message}`
                );
                this.onUnexpectedDisconnect(device);
            }
        }, delay);
    }
}
