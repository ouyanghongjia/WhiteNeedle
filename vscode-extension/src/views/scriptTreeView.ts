import * as path from 'path';
import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

type ScriptTreeItem = StatusItem | ScriptFileItem;

class StatusItem extends vscode.TreeItem {
    constructor(label: string, icon: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

class ScriptFileItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public readonly isActive: boolean
    ) {
        super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(filePath);
        this.tooltip = filePath;
        this.contextValue = 'scriptFile';
        this.iconPath = new vscode.ThemeIcon(isActive ? 'debug-start' : 'file-code');
        this.description = isActive ? '(running)' : '';
        this.command = {
            command: 'vscode.open',
            title: 'Open Script',
            arguments: [vscode.Uri.file(filePath)],
        };
    }
}

export class ScriptTreeProvider implements vscode.TreeDataProvider<ScriptTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ScriptTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private activeScriptPath: string | null = null;

    constructor(private deviceManager: DeviceManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setActiveScript(filePath: string | null): void {
        this.activeScriptPath = filePath;
        this.refresh();
    }

    getTreeItem(element: ScriptTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ScriptTreeItem): Promise<ScriptTreeItem[]> {
        if (element) { return []; }

        const items: ScriptTreeItem[] = [];

        if (!this.deviceManager.isConnected) {
            items.push(new StatusItem(
                'Not connected — use "Connect by IP" or click a device',
                'warning'
            ));
            return items;
        }

        const device = this.deviceManager.getConnectedDevice();
        items.push(new StatusItem(
            `Connected: ${device?.deviceName || 'Unknown'}`,
            'pass'
        ));

        const jsFiles = await vscode.workspace.findFiles(
            '**/*.js',
            '**/node_modules/**',
            50
        );

        if (jsFiles.length === 0) {
            items.push(new StatusItem(
                'No .js files in workspace — create one or use Cmd+Shift+P → "New Frida Script"',
                'info'
            ));
        } else {
            for (const uri of jsFiles.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
                const isActive = this.activeScriptPath === uri.fsPath;
                items.push(new ScriptFileItem(uri.fsPath, isActive));
            }
        }

        return items;
    }
}
