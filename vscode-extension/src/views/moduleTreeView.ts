import * as vscode from 'vscode';
import { ModuleManager } from '../modules/moduleManager';

export class ModuleItem extends vscode.TreeItem {
    constructor(
        public readonly moduleName: string,
        public readonly moduleSize: number,
    ) {
        super(moduleName, vscode.TreeItemCollapsibleState.None);
        const sizeStr = moduleSize >= 1024
            ? `${(moduleSize / 1024).toFixed(1)} KB`
            : `${moduleSize} B`;
        this.description = sizeStr;
        this.tooltip = `${moduleName} (${sizeStr})`;
        this.contextValue = 'installedModule';
        this.iconPath = new vscode.ThemeIcon('file-code');
    }
}

export class ModuleTreeProvider implements vscode.TreeDataProvider<ModuleItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ModuleItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private moduleManager: ModuleManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ModuleItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ModuleItem[]> {
        try {
            const modules = await this.moduleManager.listInstalled();
            return modules.map(m => new ModuleItem(m.name, m.size));
        } catch {
            return [];
        }
    }
}
