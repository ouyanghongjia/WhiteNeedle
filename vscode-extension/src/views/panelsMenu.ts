import * as vscode from 'vscode';

interface PanelEntry {
    commandId: string;
    label: string;
    icon: string;
    category: string;
}

const PANEL_ENTRIES: PanelEntry[] = [
    // ── 网络 ──
    { commandId: 'whiteneedle.openNetwork',         label: 'Network Monitor',          icon: '$(globe)',                       category: '网络' },
    { commandId: 'whiteneedle.openMockRules',       label: 'HTTP Mock Rules',          icon: '$(replace)',                     category: '网络' },
    { commandId: 'whiteneedle.openHostMapping',     label: 'Host Mapping (SwitchHosts)', icon: '$(arrow-swap)',               category: '网络' },
    { commandId: 'whiteneedle.startProxy',          label: 'Start Proxy Server',       icon: '$(radio-tower)',                 category: '网络' },
    { commandId: 'whiteneedle.stopProxy',           label: 'Stop Proxy Server',        icon: '$(circle-slash)',                category: '网络' },
    // ── 运行时 ──
    { commandId: 'whiteneedle.openViewHierarchy',   label: 'View Hierarchy Inspector', icon: '$(layers)',                      category: '运行时' },
    { commandId: 'whiteneedle.openObjC',            label: 'ObjC Runtime',             icon: '$(symbol-class)',                category: '运行时' },
    { commandId: 'whiteneedle.openHooks',           label: 'Hook Manager',             icon: '$(debug-breakpoint-function)',   category: '运行时' },
    // ── 存储 ──
    { commandId: 'whiteneedle.openCookies',        label: 'Cookies',                  icon: '$(database)',                    category: '存储' },
    { commandId: 'whiteneedle.openUserDefaults',    label: 'UserDefaults',             icon: '$(settings-gear)',               category: '存储' },
    { commandId: 'whiteneedle.openSandbox',         label: 'Sandbox Files',            icon: '$(folder-opened)',               category: '存储' },
    { commandId: 'whiteneedle.openSQLite',          label: 'SQLite Browser',           icon: '$(database)',                    category: '存储' },
    // ── 诊断 ──
    { commandId: 'whiteneedle.openLogs',            label: 'Structured Logs',          icon: '$(output)',                      category: '诊断' },
    { commandId: 'whiteneedle.openLeakDetector',    label: 'Leak Detector',            icon: '$(search-fuzzy)',                category: '诊断' },
    { commandId: 'whiteneedle.openRetainGraph',     label: 'Retain Graph',             icon: '$(type-hierarchy)',              category: '诊断' },
    // ── 脚本 ──
    { commandId: 'whiteneedle.openSnippets',        label: 'Script Snippets',          icon: '$(library)',                     category: '脚本' },
    // ── 文档 ──
    { commandId: 'whiteneedle.openApiDocs',         label: 'API Documentation',        icon: '$(book)',                        category: '文档' },
];

const CATEGORY_ORDER = ['网络', '运行时', '存储', '诊断', '脚本', '文档'];

const FAV_KEY = 'whiteneedle.favoritePanels';
const HIDDEN_KEY = 'whiteneedle.hiddenPanels';

function readFavorites(): string[] {
    return vscode.workspace.getConfiguration().get<string[]>(FAV_KEY, []);
}

async function writeFavorites(ids: string[]): Promise<void> {
    await vscode.workspace.getConfiguration().update(FAV_KEY, ids, vscode.ConfigurationTarget.Global);
}

function readHidden(): string[] {
    return vscode.workspace.getConfiguration().get<string[]>(HIDDEN_KEY, []);
}

async function writeHidden(ids: string[]): Promise<void> {
    await vscode.workspace.getConfiguration().update(HIDDEN_KEY, ids, vscode.ConfigurationTarget.Global);
}

interface PanelQuickPickItem extends vscode.QuickPickItem {
    panelCommandId?: string;
    action?: 'manage';
}

const starBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('star-full'), tooltip: '取消常用' };
const unstarBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('star-empty'), tooltip: '设为常用' };

export async function showPanelsMenu(): Promise<void> {
    const qp = vscode.window.createQuickPick<PanelQuickPickItem>();
    qp.placeholder = 'WhiteNeedle Panels';
    qp.matchOnDescription = true;

    const refresh = () => {
        const favorites = readFavorites();
        const favSet = new Set(favorites);
        const hiddenSet = new Set(readHidden());
        const items: PanelQuickPickItem[] = [];

        const visibleFavs = favorites.filter(id => !hiddenSet.has(id));
        if (visibleFavs.length > 0) {
            items.push({ label: '★ 常用', kind: vscode.QuickPickItemKind.Separator });
            for (const fav of visibleFavs) {
                const entry = PANEL_ENTRIES.find(e => e.commandId === fav);
                if (!entry) { continue; }
                items.push({
                    label: `${entry.icon}  ${entry.label}`,
                    description: '★',
                    panelCommandId: entry.commandId,
                    buttons: [starBtn],
                });
            }
        }

        for (const cat of CATEGORY_ORDER) {
            const entries = PANEL_ENTRIES.filter(e => e.category === cat && !favSet.has(e.commandId) && !hiddenSet.has(e.commandId));
            if (entries.length === 0) { continue; }
            items.push({ label: cat, kind: vscode.QuickPickItemKind.Separator });
            for (const entry of entries) {
                items.push({
                    label: `${entry.icon}  ${entry.label}`,
                    panelCommandId: entry.commandId,
                    buttons: [unstarBtn],
                });
            }
        }

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(eye)  管理面板可见性…', action: 'manage' });

        qp.items = items;
    };

    refresh();

    qp.onDidTriggerItemButton(async (e) => {
        const item = e.item as PanelQuickPickItem;
        if (!item.panelCommandId) { return; }
        const favs = readFavorites();
        const idx = favs.indexOf(item.panelCommandId);
        if (idx >= 0) {
            favs.splice(idx, 1);
        } else {
            favs.unshift(item.panelCommandId);
        }
        await writeFavorites(favs);
        refresh();
    });

    qp.onDidAccept(async () => {
        const picked = qp.selectedItems[0] as PanelQuickPickItem | undefined;
        if (!picked) { return; }
        if (picked.action === 'manage') {
            qp.hide();
            await manageVisibility();
            return;
        }
        if (picked.panelCommandId) {
            qp.hide();
            await vscode.commands.executeCommand(picked.panelCommandId);
        }
    });

    qp.onDidHide(() => qp.dispose());
    qp.show();
}

async function manageVisibility(): Promise<void> {
    const hidden = new Set(readHidden());

    interface VisPickItem extends vscode.QuickPickItem {
        entryId: string;
    }

    const items: VisPickItem[] = PANEL_ENTRIES.map(e => ({
        label: `${e.icon}  ${e.label}`,
        description: e.category,
        picked: !hidden.has(e.commandId),
        entryId: e.commandId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '勾选 = 在面板菜单中显示，取消勾选 = 隐藏',
        canPickMany: true,
    });
    if (!selected) { return; }

    const visibleSet = new Set(selected.map(s => s.entryId));
    const newHidden = PANEL_ENTRIES.filter(e => !visibleSet.has(e.commandId)).map(e => e.commandId);
    await writeHidden(newHidden);

    const count = PANEL_ENTRIES.length - newHidden.length;
    vscode.window.showInformationMessage(`已显示 ${count} 个面板，隐藏 ${newHidden.length} 个`);
}
