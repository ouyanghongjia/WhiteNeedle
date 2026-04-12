import * as vscode from 'vscode';

interface PanelEntry {
    commandId: string;
    label: string;
    icon: string;
    category: string;
}

const PANEL_ENTRIES: PanelEntry[] = [
    // ── 存储 ──
    { commandId: 'whiteneedle.openCookies',        label: 'Cookies',                  icon: '$(database)',                    category: '存储' },
    { commandId: 'whiteneedle.openUserDefaults',    label: 'UserDefaults',             icon: '$(settings-gear)',               category: '存储' },
    { commandId: 'whiteneedle.openSandbox',         label: 'Sandbox Files',            icon: '$(folder-opened)',               category: '存储' },
    { commandId: 'whiteneedle.openSQLite',          label: 'SQLite Browser',           icon: '$(database)',                    category: '存储' },
    // ── 运行时 ──
    { commandId: 'whiteneedle.openObjC',            label: 'ObjC Runtime',             icon: '$(symbol-class)',                category: '运行时' },
    { commandId: 'whiteneedle.openHooks',           label: 'Hook Manager',             icon: '$(debug-breakpoint-function)',   category: '运行时' },
    // ── 网络与检查 ──
    { commandId: 'whiteneedle.openNetwork',         label: 'Network Monitor',          icon: '$(globe)',                       category: '网络与检查' },
    { commandId: 'whiteneedle.openViewHierarchy',   label: 'View Hierarchy Inspector', icon: '$(layers)',                      category: '网络与检查' },
    { commandId: 'whiteneedle.openHostMapping',     label: 'Host Mapping (SwitchHosts)', icon: '$(arrow-swap)',               category: '网络与检查' },
    { commandId: 'whiteneedle.openMockRules',       label: 'HTTP Mock Rules',          icon: '$(replace)',                     category: '网络与检查' },
    // ── 诊断 ──
    { commandId: 'whiteneedle.openLogs',            label: 'Structured Logs',          icon: '$(output)',                      category: '诊断' },
    { commandId: 'whiteneedle.openLeakDetector',    label: 'Leak Detector',            icon: '$(search-fuzzy)',                category: '诊断' },
    { commandId: 'whiteneedle.openRetainGraph',     label: 'Retain Graph',             icon: '$(type-hierarchy)',              category: '诊断' },
    // ── 代理 ──
    { commandId: 'whiteneedle.startProxy',          label: 'Start Proxy Server',       icon: '$(radio-tower)',                 category: '代理' },
    { commandId: 'whiteneedle.stopProxy',           label: 'Stop Proxy Server',        icon: '$(circle-slash)',                category: '代理' },
    // ── 脚本 ──
    { commandId: 'whiteneedle.openSnippets',        label: 'Script Snippets',          icon: '$(library)',                     category: '脚本' },
    // ── 文档 ──
    { commandId: 'whiteneedle.openApiDocs',         label: 'API Documentation',        icon: '$(book)',                        category: '文档' },
];

const CATEGORY_ORDER = ['存储', '运行时', '网络与检查', '诊断', '代理', '脚本', '文档'];

const CONFIG_KEY = 'whiteneedle.favoritePanels';

function readFavorites(): string[] {
    return vscode.workspace.getConfiguration().get<string[]>(CONFIG_KEY, []);
}

async function writeFavorites(ids: string[]): Promise<void> {
    await vscode.workspace.getConfiguration().update(CONFIG_KEY, ids, vscode.ConfigurationTarget.Global);
}

interface PanelQuickPickItem extends vscode.QuickPickItem {
    panelCommandId?: string;
    action?: 'manage';
}

export async function showPanelsMenu(): Promise<void> {
    const favorites = readFavorites();
    const items: PanelQuickPickItem[] = [];

    if (favorites.length > 0) {
        items.push({ label: '★ 常用', kind: vscode.QuickPickItemKind.Separator });
        for (const fav of favorites) {
            const entry = PANEL_ENTRIES.find(e => e.commandId === fav);
            if (!entry) { continue; }
            items.push({
                label: `${entry.icon}  ${entry.label}`,
                description: '★',
                panelCommandId: entry.commandId,
            });
        }
    }

    const favSet = new Set(favorites);
    for (const cat of CATEGORY_ORDER) {
        const entries = PANEL_ENTRIES.filter(e => e.category === cat && !favSet.has(e.commandId));
        if (entries.length === 0) { continue; }

        items.push({ label: cat, kind: vscode.QuickPickItemKind.Separator });
        for (const entry of entries) {
            items.push({
                label: `${entry.icon}  ${entry.label}`,
                panelCommandId: entry.commandId,
            });
        }
    }

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
        label: '$(gear)  管理常用面板…',
        action: 'manage',
    });

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'WhiteNeedle Panels',
    });
    if (!picked) { return; }

    if (picked.action === 'manage') {
        await manageFavorites();
        return;
    }
    if (picked.panelCommandId) {
        await vscode.commands.executeCommand(picked.panelCommandId);
    }
}

async function manageFavorites(): Promise<void> {
    const currentFavorites = new Set(readFavorites());

    interface FavPickItem extends vscode.QuickPickItem {
        entryId: string;
    }

    const items: FavPickItem[] = PANEL_ENTRIES.map(e => ({
        label: `${e.icon}  ${e.label}`,
        description: e.category,
        picked: currentFavorites.has(e.commandId),
        entryId: e.commandId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '勾选要添加到常用区的面板（最后勾选的排在最前）',
        canPickMany: true,
    });
    if (!selected) { return; }

    const oldFavs = readFavorites();
    const newSet = new Set(selected.map(s => s.entryId));

    const kept = oldFavs.filter(id => newSet.has(id));
    const added = selected.filter(s => !kept.includes(s.entryId)).map(s => s.entryId);
    const merged = [...added, ...kept];

    await writeFavorites(merged);
    vscode.window.showInformationMessage(`已设置 ${merged.length} 个常用面板`);
}
