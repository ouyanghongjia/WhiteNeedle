import * as vscode from 'vscode';
import { WNDevice } from '../discovery/bonjourDiscovery';
import { TcpBridge } from '../bridge/tcpBridge';

export class DeviceManager {
    private bridge: TcpBridge | null = null;
    private connectedDevice: WNDevice | null = null;

    constructor(private outputChannel: vscode.OutputChannel) {}

    get isConnected(): boolean {
        return this.connectedDevice !== null && this.bridge?.isConnected === true;
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

        this.outputChannel.appendLine(
            `[DeviceManager] Connecting to ${device.host}:${device.enginePort}...`
        );

        this.bridge = new TcpBridge(this.outputChannel);

        this.bridge.on('disconnected', () => {
            this.connectedDevice = null;
        });

        await this.bridge.connect(device.host, device.enginePort);
        this.connectedDevice = device;
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
        if (this.bridge) {
            this.bridge.disconnect();
            this.bridge = null;
        }
        this.connectedDevice = null;
    }

    async loadScript(code: string, name: string): Promise<void> {
        if (!this.bridge?.isConnected) {
            throw new Error('Not connected to any device');
        }
        await this.bridge.call('loadScript', { code, name });
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

    getConnectedDevice(): WNDevice | null {
        return this.connectedDevice;
    }

    getBridge(): TcpBridge | null {
        return this.bridge;
    }
}
