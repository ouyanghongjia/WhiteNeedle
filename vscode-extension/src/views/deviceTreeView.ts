import * as vscode from 'vscode';
import { DeviceDiscovery, WNDevice } from '../discovery/bonjourDiscovery';
import { DeviceManager } from '../device/deviceManager';

/**
 * Dedup key: deviceId + bundleId.
 * Falls back to deviceName + bundleId when deviceId is absent.
 */
function dedupKey(d: WNDevice): string {
    const id = d.deviceId || d.deviceName || d.host;
    const bundle = d.bundleId || 'unknown';
    return `${id}::${bundle}`;
}

export class DeviceTreeProvider implements vscode.TreeDataProvider<DeviceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DeviceTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private usbDevices: WNDevice[] = [];

    constructor(
        private discovery: DeviceDiscovery,
        private deviceManager: DeviceManager
    ) {
        discovery.on('deviceFound', () => this.refresh());
        discovery.on('deviceLost', () => this.refresh());
        discovery.on('deviceUpdated', () => this.refresh());
        deviceManager.on('stateChanged', () => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    addUsbDevice(device: WNDevice): void {
        const key = dedupKey(device);
        const idx = this.usbDevices.findIndex(d => dedupKey(d) === key);
        if (idx >= 0) {
            this.usbDevices[idx] = device;
        } else {
            this.usbDevices.push(device);
        }
        this.refresh();
    }

    removeUsbDevice(device: WNDevice): void {
        const key = dedupKey(device);
        const idx = this.usbDevices.findIndex(d => dedupKey(d) === key);
        if (idx >= 0) {
            this.usbDevices.splice(idx, 1);
            this.refresh();
        }
    }

    /**
     * Merged device list:
     *  - Both USB and WiFi pools feed in
     *  - Dedup by deviceId+bundleId; USB wins when both exist
     *  - When USB entry is removed, the WiFi entry reappears automatically
     */
    private listRootDevices(): WNDevice[] {
        const wifiDevices = this.discovery.getDevices();
        const usbKeys = new Set(this.usbDevices.map(dedupKey));

        const merged = new Map<string, WNDevice>();

        // USB entries first (take priority)
        for (const ud of this.usbDevices) {
            merged.set(dedupKey(ud), ud);
        }

        // WiFi entries that are NOT shadowed by USB
        for (const wd of wifiDevices) {
            const key = dedupKey(wd);
            if (!usbKeys.has(key)) {
                merged.set(key, wd);
            }
        }

        const list = Array.from(merged.values());

        // Ensure the currently connected device is always shown
        const connected = this.deviceManager.getConnectedDevice();
        if (connected && this.deviceManager.isConnected) {
            const connKey = dedupKey(connected);
            if (!merged.has(connKey)) {
                list.unshift(connected);
            }
        }

        return list;
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
                const isBlocked = this.isBlockedDevice(d);
                const isUsb = d.transport === 'usb';
                const transportTag = isUsb ? ' [USB]' : '';

                const item = new DeviceTreeItem(
                    d.deviceName + transportTag,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    d
                );
                item.description = d.bundleId;
                item.iconPath = new vscode.ThemeIcon(
                    isBlocked ? 'circle-slash' :
                    isConnected ? 'debug-disconnect' :
                    isUsb ? 'plug' : 'device-mobile'
                );
                item.contextValue = isBlocked ? 'blockedDevice' : isConnected ? 'connectedDevice' : 'device';
                if (isBlocked) {
                    item.tooltip = 'Blocked target';
                } else if (isUsb) {
                    item.tooltip = `USB device (serial: ${d.serialNumber || 'unknown'})`;
                }

                if (!isConnected && !isBlocked) {
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

    private isBlockedDevice(device: WNDevice): boolean {
        const cfg = vscode.workspace.getConfiguration('whiteneedle');
        const blockedHosts = new Set((cfg.get<string[]>('blockedHosts', []) || []).map((x) => String(x || '').trim()).filter(Boolean));
        const blockedDeviceIds = new Set((cfg.get<string[]>('blockedDeviceIds', []) || []).map((x) => String(x || '').trim()).filter(Boolean));
        if (device.deviceId && blockedDeviceIds.has(device.deviceId)) {
            return true;
        }
        if (device.host && blockedHosts.has(device.host)) {
            return true;
        }
        if (device.aliasIPs && device.aliasIPs.some((ip) => blockedHosts.has(ip))) {
            return true;
        }
        return false;
    }

    private getDeviceDetails(device: WNDevice): DeviceTreeItem[] {
        const details = [
            this.detailItem('Transport', device.transport === 'usb' ? 'USB' : 'Wi-Fi'),
            this.detailItem('IP', `${device.host}:${device.port}`),
            this.detailItem('Bundle', device.bundleId),
            this.detailItem('iOS', device.systemVersion),
            this.detailItem('Model', device.model),
            this.detailItem('Engine Port', String(device.enginePort)),
            this.detailItem('Engine', device.engineType),
            this.detailItem('WN Version', device.wnVersion),
        ];
        if (device.aliasIPs && device.aliasIPs.length > 0) {
            details.push(this.detailItem('Alias IPs', device.aliasIPs.join(', ')));
        }
        if (device.deviceId) {
            details.push(this.detailItem('Device ID', device.deviceId));
        }
        if (device.serialNumber) {
            details.push(this.detailItem('Serial', device.serialNumber));
        }
        return details;
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
