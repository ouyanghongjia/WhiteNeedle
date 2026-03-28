import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

type ObjCTreeItem = ClassGroupItem | ClassItem | MethodItem;

class ClassGroupItem extends vscode.TreeItem {
    constructor(
        public readonly prefix: string,
        public readonly count: number
    ) {
        super(prefix, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${count} classes`;
        this.contextValue = 'classGroup';
    }
}

class ClassItem extends vscode.TreeItem {
    constructor(public readonly className: string) {
        super(className, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'objcClass';
        this.iconPath = new vscode.ThemeIcon('symbol-class');
        this.tooltip = `ObjC class: ${className}`;
    }
}

class MethodItem extends vscode.TreeItem {
    constructor(
        public readonly methodSignature: string,
        public readonly className: string
    ) {
        super(methodSignature, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'objcMethod';
        const isClassMethod = methodSignature.startsWith('+');
        this.iconPath = new vscode.ThemeIcon(
            isClassMethod ? 'symbol-method' : 'symbol-function'
        );
        this.tooltip = `${className} ${methodSignature}`;
    }
}

export class ObjCTreeProvider implements vscode.TreeDataProvider<ObjCTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ObjCTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private classes: string[] = [];
    private classMethods = new Map<string, string[]>();
    private filterText = '';

    constructor(private deviceManager: DeviceManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.refresh();
    }

    async loadClasses(): Promise<void> {
        if (!this.deviceManager.isConnected) {
            vscode.window.showWarningMessage('Not connected to a device.');
            return;
        }

        try {
            const classes = await this.deviceManager.getClassNames(this.filterText || undefined);
            if (Array.isArray(classes)) {
                this.classes = classes;
                this.refresh();
                vscode.window.showInformationMessage(`Loaded ${this.classes.length} ObjC classes`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load classes: ${err.message}`);
        }
    }

    async loadMethodsForClass(className: string): Promise<string[]> {
        if (this.classMethods.has(className)) {
            return this.classMethods.get(className)!;
        }

        try {
            const result = await this.deviceManager.getMethods(className);
            const allMethods = [
                ...result.classMethods.map(m => `+ ${m}`),
                ...result.instanceMethods.map(m => `- ${m}`),
            ];
            this.classMethods.set(className, allMethods);
            return allMethods;
        } catch { /* ignore */ }

        return [];
    }

    getTreeItem(element: ObjCTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ObjCTreeItem): Promise<ObjCTreeItem[]> {
        if (!element) {
            const filtered = this.filterText
                ? this.classes.filter(c => c.toLowerCase().includes(this.filterText))
                : this.classes;

            if (filtered.length === 0) {
                return [];
            }

            if (filtered.length <= 200) {
                return filtered.map(c => new ClassItem(c));
            }

            const groups = new Map<string, string[]>();
            for (const cls of filtered) {
                const prefix = cls.substring(0, 2).toUpperCase();
                if (!groups.has(prefix)) { groups.set(prefix, []); }
                groups.get(prefix)!.push(cls);
            }

            return Array.from(groups.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([prefix, items]) => new ClassGroupItem(prefix, items.length));
        }

        if (element instanceof ClassGroupItem) {
            const filtered = this.filterText
                ? this.classes.filter(c =>
                    c.substring(0, 2).toUpperCase() === element.prefix &&
                    c.toLowerCase().includes(this.filterText)
                )
                : this.classes.filter(c => c.substring(0, 2).toUpperCase() === element.prefix);

            return filtered.map(c => new ClassItem(c));
        }

        if (element instanceof ClassItem) {
            const methods = await this.loadMethodsForClass(element.className);
            return methods.map(m => new MethodItem(m, element.className));
        }

        return [];
    }
}
