import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

interface SuiteInfo {
    suiteName: string;
    name: string;
    isDefault: boolean;
    keyCount: number;
}

type UDTreeItem = SuiteItem | KeyValueItem | ValueDetailItem;

class SuiteItem extends vscode.TreeItem {
    constructor(public readonly suite: SuiteInfo) {
        super(
            suite.isDefault ? 'StandardUserDefaults' : suite.suiteName,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        this.description = `${suite.keyCount} keys`;
        this.contextValue = 'udSuite';
        this.iconPath = new vscode.ThemeIcon(suite.isDefault ? 'database' : 'file-code');
    }
}

class KeyValueItem extends vscode.TreeItem {
    constructor(
        public readonly key: string,
        public readonly value: any,
        public readonly suiteName?: string
    ) {
        const isExpandable = typeof value === 'object' && value !== null;
        super(key, isExpandable
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.description = formatValuePreview(value);
        this.contextValue = 'udKeyValue';
        this.iconPath = new vscode.ThemeIcon(getTypeIcon(value));
        this.tooltip = `${key} = ${JSON.stringify(value, null, 2)}`;
    }
}

class ValueDetailItem extends vscode.TreeItem {
    constructor(label: string, value: string) {
        super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'udValueDetail';
        this.iconPath = new vscode.ThemeIcon('symbol-field');
    }
}

function formatValuePreview(v: any): string {
    if (v === null || v === undefined) { return 'null'; }
    if (typeof v === 'string') { return v.length > 50 ? v.substring(0, 50) + '…' : v; }
    if (typeof v === 'number' || typeof v === 'boolean') { return String(v); }
    if (Array.isArray(v)) { return `Array[${v.length}]`; }
    if (typeof v === 'object') { return `{${Object.keys(v).length} keys}`; }
    return String(v);
}

function getTypeIcon(v: any): string {
    if (v === null || v === undefined) { return 'circle-slash'; }
    if (typeof v === 'string') { return 'symbol-string'; }
    if (typeof v === 'number') { return 'symbol-number'; }
    if (typeof v === 'boolean') { return 'symbol-boolean'; }
    if (Array.isArray(v)) { return 'symbol-array'; }
    if (typeof v === 'object') { return 'symbol-object'; }
    return 'symbol-misc';
}

export class UserDefaultsTreeProvider implements vscode.TreeDataProvider<UDTreeItem> {
    private _onDidChange = new vscode.EventEmitter<UDTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    private suites: SuiteItem[] = [];
    private suiteData = new Map<string, Record<string, any>>();

    constructor(private deviceManager: DeviceManager) {}

    refresh(): void {
        this._onDidChange.fire(undefined);
    }

    async loadSuites(): Promise<void> {
        if (!this.deviceManager.isConnected) {
            vscode.window.showWarningMessage('WhiteNeedle: Not connected to a device.');
            return;
        }

        try {
            const raw = await this.deviceManager.evaluate('JSON.stringify(UserDefaults.suites())') as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const suites: SuiteInfo[] = JSON.parse(parsed);

            this.suites = suites
                .sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.suiteName.localeCompare(b.suiteName)))
                .map(s => new SuiteItem(s));
            this.suiteData.clear();

            this.refresh();
            vscode.window.showInformationMessage(`Found ${suites.length} UserDefaults suites`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load suites: ${err.message}`);
        }
    }

    private async loadSuiteData(suiteName: string, isDefault: boolean): Promise<Record<string, any>> {
        if (this.suiteData.has(suiteName)) {
            return this.suiteData.get(suiteName)!;
        }

        try {
            const arg = isDefault ? '' : `'${suiteName.replace(/'/g, "\\'")}'`;
            const raw = await this.deviceManager.evaluate(`JSON.stringify(UserDefaults.getAll(${arg}))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const data = JSON.parse(parsed);
            this.suiteData.set(suiteName, data);
            return data;
        } catch {
            return {};
        }
    }

    async editValue(item: KeyValueItem): Promise<void> {
        const current = JSON.stringify(item.value);
        const input = await vscode.window.showInputBox({
            prompt: `Edit value for "${item.key}"`,
            value: current,
            placeHolder: 'Enter new value (JSON format)',
        });
        if (input === undefined) { return; }

        try {
            let jsValue: string;
            try {
                JSON.parse(input);
                jsValue = input;
            } catch {
                jsValue = JSON.stringify(input);
            }

            const suiteArg = item.suiteName ? `, '${item.suiteName.replace(/'/g, "\\'")}'` : '';
            const code = `UserDefaults.set('${item.key.replace(/'/g, "\\'")}', ${jsValue}${suiteArg})`;
            await this.deviceManager.evaluate(code);

            this.suiteData.clear();
            this.refresh();
            vscode.window.showInformationMessage(`Updated: ${item.key}`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to update: ${err.message}`);
        }
    }

    async deleteKey(item: KeyValueItem): Promise<void> {
        const suiteArg = item.suiteName ? `, '${item.suiteName.replace(/'/g, "\\'")}'` : '';
        const code = `UserDefaults.remove('${item.key.replace(/'/g, "\\'")}' ${suiteArg})`;
        try {
            await this.deviceManager.evaluate(code);
            this.suiteData.clear();
            this.refresh();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to delete: ${err.message}`);
        }
    }

    getTreeItem(element: UDTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: UDTreeItem): Promise<UDTreeItem[]> {
        if (!element) {
            return this.suites;
        }

        if (element instanceof SuiteItem) {
            const data = await this.loadSuiteData(element.suite.suiteName, element.suite.isDefault);
            return Object.entries(data)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => new KeyValueItem(
                    k, v,
                    element.suite.isDefault ? undefined : element.suite.suiteName
                ));
        }

        if (element instanceof KeyValueItem && typeof element.value === 'object' && element.value !== null) {
            if (Array.isArray(element.value)) {
                return element.value.map((v, i) => {
                    if (typeof v === 'object' && v !== null) {
                        return new KeyValueItem(`[${i}]`, v, element.suiteName);
                    }
                    return new ValueDetailItem(`[${i}]`, formatValuePreview(v));
                });
            }
            return Object.entries(element.value).map(([k, v]) => {
                if (typeof v === 'object' && v !== null) {
                    return new KeyValueItem(k, v, element.suiteName);
                }
                return new ValueDetailItem(k, formatValuePreview(v));
            });
        }

        return [];
    }
}
