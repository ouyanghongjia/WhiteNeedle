import * as vscode from 'vscode';
import { DeviceDiscovery, WNDevice } from '../discovery/bonjourDiscovery';
import { DeviceManager } from '../device/deviceManager';

export class DeviceTreeProvider implements vscode.TreeDataProvider<DeviceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DeviceTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private discovery: DeviceDiscovery,
        private deviceManager: DeviceManager
    ) {
        discovery.on('deviceFound', () => this.refresh());
        discovery.on('deviceLost', () => this.refresh());
        discovery.on('deviceUpdated', () => this.refresh());
        // Fallback TCP / Connect-by-IP do not go through Bonjour — still show connected device in tree.
        deviceManager.on('stateChanged', () => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /** Bonjour list plus currently connected device if it was reached without discovery (e.g. last-host fallback). */
    private listRootDevices(): WNDevice[] {
        const fromDiscovery = this.discovery.getDevices();
        const connected = this.deviceManager.getConnectedDevice();
        if (!connected || !this.deviceManager.isConnected) {
            return fromDiscovery;
        }
        const isSame = (a: WNDevice, b: WNDevice): boolean => {
            if (a.bundleId && a.bundleId !== 'unknown' && a.deviceName &&
                b.bundleId && b.bundleId !== 'unknown' && b.deviceName) {
                return a.bundleId === b.bundleId && a.deviceName === b.deviceName;
            }
            return a.host === b.host && a.enginePort === b.enginePort;
        };
        if (fromDiscovery.some((d) => isSame(d, connected))) {
            return fromDiscovery;
        }
        return [connected, ...fromDiscovery];
    }

    getTreeItem(element: DeviceTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DeviceTreeItem): Thenable<DeviceTreeItem[]> {
        if (element) {
            return Promise.resolve(this.getDeviceDetails(element.device!));
        }

        const devices = this.listRootDevices();
        if (devices.length === 0) {
            return Promise.resolve([new DeviceTreeItem(
                'Scanning for devices...',
                vscode.TreeItemCollapsibleState.None,
            )]);
        }

        return Promise.resolve(
            devices.map(d => {
                const isConnected = this.deviceManager.isConnectedTo(d);
                const item = new DeviceTreeItem(
                    d.deviceName,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    d
                );
                item.description = d.bundleId;
                item.iconPath = new vscode.ThemeIcon(
                    isConnected ? 'debug-disconnect' : 'device-mobile'
                );
                item.contextValue = isConnected ? 'connectedDevice' : 'device';

                if (!isConnected) {
                    item.command = {
                        command: 'whiteneedle.connectDevice',
                        title: 'Connect',
                        arguments: [d],
                    };
                }

                return item;
            })
        );
    }

    private getDeviceDetails(device: WNDevice): DeviceTreeItem[] {
        return [
            this.detailItem('IP', `${device.host}:${device.port}`),
            this.detailItem('Bundle', device.bundleId),
            this.detailItem('iOS', device.systemVersion),
            this.detailItem('Model', device.model),
            this.detailItem('Engine Port', String(device.enginePort)),
            this.detailItem('Engine', device.engineType),
            this.detailItem('WN Version', device.wnVersion),
        ];
    }

    private detailItem(label: string, value: string): DeviceTreeItem {
        const item = new DeviceTreeItem(
            `${label}: ${value}`,
            vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
    }
}

class DeviceTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly device?: WNDevice
    ) {
        super(label, collapsibleState);
    }
}
