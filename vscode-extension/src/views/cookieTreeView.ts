import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

interface CookieInfo {
    name: string;
    value: string;
    domain: string;
    path: string;
    isSecure: boolean;
    isHTTPOnly: boolean;
    isSessionOnly: boolean;
    expires?: number;
    sameSite?: string;
}

type CookieTreeItem = DomainItem | CookieItem | CookiePropertyItem;

class DomainItem extends vscode.TreeItem {
    constructor(
        public readonly domain: string,
        public readonly cookies: CookieInfo[]
    ) {
        super(domain, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${cookies.length}`;
        this.contextValue = 'cookieDomain';
        this.iconPath = new vscode.ThemeIcon('globe');
    }
}

class CookieItem extends vscode.TreeItem {
    constructor(public readonly cookie: CookieInfo) {
        super(cookie.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = truncate(cookie.value, 40);
        this.contextValue = 'cookieItem';
        this.iconPath = new vscode.ThemeIcon('key');
        this.tooltip = `${cookie.name}=${cookie.value}`;
    }
}

class CookiePropertyItem extends vscode.TreeItem {
    constructor(label: string, value: string) {
        super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'cookieProperty';
        this.iconPath = new vscode.ThemeIcon('symbol-field');
    }
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.substring(0, max) + '…' : s;
}

export class CookieTreeProvider implements vscode.TreeDataProvider<CookieTreeItem> {
    private _onDidChange = new vscode.EventEmitter<CookieTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    private domains: DomainItem[] = [];

    constructor(private deviceManager: DeviceManager) {}

    refresh(): void {
        this._onDidChange.fire(undefined);
    }

    async loadCookies(domainFilter?: string): Promise<void> {
        if (!this.deviceManager.isConnected) {
            vscode.window.showWarningMessage('WhiteNeedle: Not connected to a device.');
            return;
        }

        try {
            const code = domainFilter
                ? `JSON.stringify(Cookies.getAll('${domainFilter.replace(/'/g, "\\'")}'))`
                : 'JSON.stringify(Cookies.getAll())';
            const result = await this.deviceManager.evaluate(code) as any;
            const raw = typeof result === 'string' ? result : result?.value ?? JSON.stringify(result);
            const cookies: CookieInfo[] = JSON.parse(raw);

            const grouped = new Map<string, CookieInfo[]>();
            for (const c of cookies) {
                const d = c.domain || '(unknown)';
                if (!grouped.has(d)) { grouped.set(d, []); }
                grouped.get(d)!.push(c);
            }

            this.domains = Array.from(grouped.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([domain, items]) => new DomainItem(domain, items));

            this.refresh();
            vscode.window.showInformationMessage(`Loaded ${cookies.length} cookies from ${this.domains.length} domains`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load cookies: ${err.message}`);
        }
    }

    async deleteCookie(item: CookieItem): Promise<void> {
        const c = item.cookie;
        try {
            const code = `Cookies.remove('${c.name.replace(/'/g, "\\'")}', '${c.domain.replace(/'/g, "\\'")}')`;
            await this.deviceManager.evaluate(code);
            await this.loadCookies();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to delete cookie: ${err.message}`);
        }
    }

    getTreeItem(element: CookieTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CookieTreeItem): Promise<CookieTreeItem[]> {
        if (!element) {
            return this.domains;
        }

        if (element instanceof DomainItem) {
            return element.cookies.map(c => new CookieItem(c));
        }

        if (element instanceof CookieItem) {
            const c = element.cookie;
            const props: CookiePropertyItem[] = [
                new CookiePropertyItem('value', c.value),
                new CookiePropertyItem('domain', c.domain),
                new CookiePropertyItem('path', c.path),
                new CookiePropertyItem('secure', String(c.isSecure)),
                new CookiePropertyItem('httpOnly', String(c.isHTTPOnly)),
                new CookiePropertyItem('session', String(c.isSessionOnly)),
            ];
            if (c.expires) {
                props.push(new CookiePropertyItem('expires', new Date(c.expires * 1000).toLocaleString()));
            }
            if (c.sameSite) {
                props.push(new CookiePropertyItem('sameSite', c.sameSite));
            }
            return props;
        }

        return [];
    }
}
