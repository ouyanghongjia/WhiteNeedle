import * as vscode from 'vscode';
import {
    BUILTIN_SNIPPETS,
    CATEGORY_LABELS,
    ScriptSnippet,
    ScriptHistoryEntry,
    SnippetCategory,
    resolveSnippet,
    searchSnippets,
    exportSnippets,
    importSnippets,
    HISTORY_MAX_ENTRIES,
    FAVORITES_KEY,
    HISTORY_KEY,
} from '../snippets/snippetLibrary';
import { DeviceManager } from '../device/deviceManager';
import { ScriptRunner } from '../scripting/scriptRunner';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

const CUSTOM_SNIPPETS_KEY = 'whiteneedle.customSnippets';

export class SnippetPanel {
    public static currentPanel: SnippetPanel | undefined;
    private static readonly viewType = 'whiteneedle.snippetPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly deviceManager: DeviceManager;
    private readonly scriptRunner: ScriptRunner;
    private readonly globalState: vscode.Memento;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        scriptRunner: ScriptRunner,
        globalState?: vscode.Memento,
    ): SnippetPanel {
        const column = vscode.ViewColumn.One;
        if (SnippetPanel.currentPanel) {
            SnippetPanel.currentPanel.panel.reveal(column);
            return SnippetPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(
            SnippetPanel.viewType,
            'Script Snippets',
            column,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        SnippetPanel.currentPanel = new SnippetPanel(panel, extensionUri, deviceManager, scriptRunner, globalState);
        return SnippetPanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        scriptRunner: ScriptRunner,
        globalState?: vscode.Memento,
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.deviceManager = deviceManager;
        this.scriptRunner = scriptRunner;
        this.globalState = globalState!;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        bindConnectionState(this.panel, this.deviceManager, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg) => this.handleMessage(msg),
            null,
            this.disposables,
        );
    }

    private getAllSnippets(): ScriptSnippet[] {
        const custom = this.getCustomSnippets();
        return [...BUILTIN_SNIPPETS, ...custom];
    }

    private getCustomSnippets(): ScriptSnippet[] {
        if (!this.globalState) { return []; }
        return this.globalState.get<ScriptSnippet[]>(CUSTOM_SNIPPETS_KEY, []);
    }

    private async saveCustomSnippets(snippets: ScriptSnippet[]): Promise<void> {
        if (!this.globalState) { return; }
        await this.globalState.update(CUSTOM_SNIPPETS_KEY, snippets);
    }

    private findSnippet(id: string): ScriptSnippet | undefined {
        return this.getAllSnippets().find(s => s.id === id);
    }

    // --- Favorites ---

    private getFavorites(): Set<string> {
        if (!this.globalState) { return new Set(); }
        const raw = this.globalState.get<unknown>(FAVORITES_KEY, []);
        if (!Array.isArray(raw)) { return new Set(); }
        return new Set(raw.filter((v): v is string => typeof v === 'string'));
    }

    private async toggleFavorite(snippetId: string): Promise<void> {
        if (!this.globalState) { return; }
        const favs = this.getFavorites();
        if (favs.has(snippetId)) {
            favs.delete(snippetId);
        } else {
            favs.add(snippetId);
        }
        await this.globalState.update(FAVORITES_KEY, [...favs]);
    }

    // --- History ---

    private getHistory(): ScriptHistoryEntry[] {
        if (!this.globalState) { return []; }
        const raw = this.globalState.get<unknown>(HISTORY_KEY, []);
        if (!Array.isArray(raw)) { return []; }
        return raw.filter((e: any): e is ScriptHistoryEntry =>
            e && typeof e.snippetId === 'string' &&
            typeof e.snippetName === 'string' &&
            typeof e.timestamp === 'number'
        );
    }

    private async addHistoryEntry(snippet: ScriptSnippet, params?: Record<string, string>): Promise<void> {
        if (!this.globalState) { return; }
        const history = this.getHistory();
        const entry: ScriptHistoryEntry = {
            snippetId: snippet.id,
            snippetName: snippet.name,
            timestamp: Date.now(),
            params,
        };
        history.unshift(entry);
        if (history.length > HISTORY_MAX_ENTRIES) {
            history.length = HISTORY_MAX_ENTRIES;
        }
        await this.globalState.update(HISTORY_KEY, history);
    }

    private async clearHistory(): Promise<void> {
        if (!this.globalState) { return; }
        await this.globalState.update(HISTORY_KEY, []);
    }

    private async handleMessage(msg: any): Promise<void> {
        switch (msg.command) {
            case 'search': {
                const all = this.getAllSnippets();
                const results = msg.query ? searchSnippets(msg.query, all) : all;
                this.panel.webview.postMessage({ command: 'searchResults', snippets: results });
                break;
            }
            case 'insertToEditor': {
                const snippet = this.findSnippet(msg.id);
                if (!snippet) { return; }
                const code = snippet.params ? resolveSnippet(snippet, msg.params || {}) : snippet.code;
                const doc = await vscode.workspace.openTextDocument({
                    language: 'javascript',
                    content: `// WhiteNeedle Snippet: ${snippet.name}\n// ${snippet.description}\n\n${code}\n`,
                });
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                break;
            }
            case 'runOnDevice': {
                const snippet = this.findSnippet(msg.id);
                if (!snippet) { return; }
                if (!this.deviceManager.isConnected) {
                    vscode.window.showWarningMessage('WhiteNeedle: Not connected to any device.');
                    return;
                }
                const code = snippet.params ? resolveSnippet(snippet, msg.params || {}) : snippet.code;
                try {
                    await this.scriptRunner.pushAndRun(code, `snippet:${snippet.id}`);
                    await this.addHistoryEntry(snippet, msg.params);
                    vscode.window.showInformationMessage(`Snippet "${snippet.name}" pushed to device.`);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Snippet error: ${err.message}`);
                }
                break;
            }
            case 'copyCode': {
                const snippet = this.findSnippet(msg.id);
                if (!snippet) { return; }
                const code = snippet.params ? resolveSnippet(snippet, msg.params || {}) : snippet.code;
                await vscode.env.clipboard.writeText(code);
                vscode.window.showInformationMessage('Snippet copied to clipboard.');
                break;
            }
            case 'importSnippets': {
                await this.handleImport();
                break;
            }
            case 'exportSnippets': {
                await this.handleExport(msg.scope);
                break;
            }
            case 'deleteCustomSnippet': {
                const custom = this.getCustomSnippets().filter(s => s.id !== msg.id);
                await this.saveCustomSnippets(custom);
                this.refreshWebview();
                break;
            }
            case 'toggleFavorite': {
                await this.toggleFavorite(msg.id);
                this.panel.webview.postMessage({
                    command: 'favoritesUpdated',
                    favorites: [...this.getFavorites()],
                });
                break;
            }
            case 'getHistory': {
                this.panel.webview.postMessage({
                    command: 'historyData',
                    history: this.getHistory(),
                });
                break;
            }
            case 'clearHistory': {
                await this.clearHistory();
                this.panel.webview.postMessage({ command: 'historyData', history: [] });
                break;
            }
            case 'rerunFromHistory': {
                const histSnippet = this.findSnippet(msg.snippetId);
                if (!histSnippet) {
                    vscode.window.showWarningMessage('Snippet no longer exists.');
                    return;
                }
                if (!this.deviceManager.isConnected) {
                    vscode.window.showWarningMessage('WhiteNeedle: Not connected to any device.');
                    return;
                }
                const histCode = histSnippet.params ? resolveSnippet(histSnippet, msg.params || {}) : histSnippet.code;
                try {
                    await this.scriptRunner.pushAndRun(histCode, `snippet:${histSnippet.id}`);
                    await this.addHistoryEntry(histSnippet, msg.params);
                    vscode.window.showInformationMessage(`Snippet "${histSnippet.name}" re-run.`);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Snippet error: ${err.message}`);
                }
                break;
            }
        }
    }

    private async handleImport(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { 'Snippet Files': ['json'] },
            openLabel: 'Import Snippets',
        });
        if (!uris || uris.length === 0) { return; }

        let totalImported = 0;
        const existingCustom = this.getCustomSnippets();
        const existingIds = new Set([
            ...BUILTIN_SNIPPETS.map(s => s.id),
            ...existingCustom.map(s => s.id),
        ]);

        for (const uri of uris) {
            try {
                const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                const parsed = importSnippets(raw);
                for (const snippet of parsed) {
                    if (existingIds.has(snippet.id)) {
                        snippet.id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    }
                    existingIds.add(snippet.id);
                    existingCustom.push(snippet);
                    totalImported++;
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Import error (${vscode.workspace.asRelativePath(uri)}): ${err.message}`);
            }
        }

        if (totalImported > 0) {
            await this.saveCustomSnippets(existingCustom);
            this.refreshWebview();
            vscode.window.showInformationMessage(`Imported ${totalImported} snippet(s).`);
        }
    }

    private async handleExport(scope: 'all' | 'custom' | 'builtin'): Promise<void> {
        let snippets: ScriptSnippet[];
        switch (scope) {
            case 'custom':
                snippets = this.getCustomSnippets();
                break;
            case 'builtin':
                snippets = BUILTIN_SNIPPETS;
                break;
            default:
                snippets = this.getAllSnippets();
        }

        if (snippets.length === 0) {
            vscode.window.showWarningMessage('No snippets to export.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`whiteneedle-snippets-${scope}.json`),
            filters: { 'JSON': ['json'] },
            title: 'Export Snippets',
        });
        if (!uri) { return; }

        const content = exportSnippets(snippets);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(`Exported ${snippets.length} snippet(s).`);
    }

    private refreshWebview(): void {
        const all = this.getAllSnippets();
        this.panel.webview.postMessage({
            command: 'refreshAll',
            snippets: all,
            favorites: [...this.getFavorites()],
            history: this.getHistory(),
        });
    }

    private dispose(): void {
        SnippetPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }

    private getHtml(): string {
        const snippetsJson = JSON.stringify(this.getAllSnippets());
        const builtinIds = JSON.stringify(BUILTIN_SNIPPETS.map(s => s.id));
        const categoriesJson = JSON.stringify(CATEGORY_LABELS);
        const favoritesJson = JSON.stringify([...this.getFavorites()]);
        const historyJson = JSON.stringify(this.getHistory());
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
    :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --border: var(--vscode-panel-border, #444);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, #555);
        --btn-bg: var(--vscode-button-background);
        --btn-fg: var(--vscode-button-foreground);
        --btn-hover: var(--vscode-button-hoverBackground);
        --badge-bg: var(--vscode-badge-background);
        --badge-fg: var(--vscode-badge-foreground);
        --highlight: var(--vscode-textLink-foreground);
        --code-bg: var(--vscode-textCodeBlock-background, #1e1e1e);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--fg); background: var(--bg); padding: 12px; }

    .tab-bar {
        display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 12px;
    }
    .tab-btn {
        padding: 8px 16px; border: none; background: transparent; color: var(--fg);
        cursor: pointer; font-size: 13px; border-bottom: 2px solid transparent; opacity: 0.7;
    }
    .tab-btn.active { border-bottom-color: var(--highlight); opacity: 1; font-weight: 600; }
    .tab-btn:hover { opacity: 1; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .toolbar {
        display: flex; gap: 8px; align-items: center; margin-bottom: 12px;
        position: sticky; top: 0; z-index: 10; background: var(--bg); padding: 4px 0;
    }
    .search-input {
        flex: 1; padding: 6px 10px; border: 1px solid var(--input-border);
        background: var(--input-bg); color: var(--input-fg); border-radius: 4px; font-size: 13px;
    }
    .search-input:focus { outline: 1px solid var(--highlight); }

    .filter-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
    .filter-btn {
        padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px;
        background: transparent; color: var(--fg); cursor: pointer; font-size: 11px;
    }
    .filter-btn.active { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
    .filter-btn:hover { opacity: 0.85; }

    .snippet-list { display: flex; flex-direction: column; gap: 8px; }
    .snippet-card {
        border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    }
    .snippet-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; cursor: pointer; gap: 8px;
    }
    .snippet-header:hover { background: rgba(255,255,255,0.04); }
    .snippet-title-block { flex: 1; min-width: 0; }
    .snippet-name { font-weight: 600; font-size: 13px; }
    .snippet-desc { color: var(--fg); opacity: 0.7; font-size: 11px; margin-top: 2px; }
    .snippet-badge {
        font-size: 10px; padding: 1px 6px; border-radius: 8px;
        background: var(--badge-bg); color: var(--badge-fg); white-space: nowrap;
    }

    .snippet-body { display: none; border-top: 1px solid var(--border); padding: 12px; }
    .snippet-card.open .snippet-body { display: block; }

    .param-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .param-label { font-size: 11px; min-width: 100px; font-weight: 500; }
    .param-input {
        flex: 1; padding: 4px 8px; border: 1px solid var(--input-border);
        background: var(--input-bg); color: var(--input-fg); border-radius: 3px; font-size: 12px;
    }

    pre.code-preview {
        background: var(--code-bg); padding: 10px; border-radius: 4px;
        overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 12px;
        line-height: 1.5; margin: 8px 0; white-space: pre-wrap; word-break: break-all;
    }

    .action-bar { display: flex; gap: 6px; margin-top: 8px; }
    .action-btn {
        padding: 4px 12px; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;
        background: var(--btn-bg); color: var(--btn-fg);
    }
    .action-btn:hover { background: var(--btn-hover); }
    .action-btn.secondary {
        background: transparent; border: 1px solid var(--border); color: var(--fg);
    }
    .action-btn.secondary:hover { background: rgba(255,255,255,0.06); }

    .io-btn {
        padding: 4px 10px; border: 1px solid var(--border); border-radius: 3px;
        background: transparent; color: var(--fg); cursor: pointer; font-size: 11px; white-space: nowrap;
    }
    .io-btn:hover { background: rgba(255,255,255,0.06); }
    .custom-badge {
        font-size: 9px; padding: 1px 5px; border-radius: 6px; margin-left: 6px;
        background: var(--highlight); color: var(--bg); font-weight: 600;
    }
    .delete-btn {
        background: transparent; border: 1px solid var(--border); color: var(--fg);
        padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;
    }
    .delete-btn:hover { background: rgba(255,80,80,0.15); color: #f66; border-color: #f66; }
    .empty-state { text-align: center; padding: 40px; opacity: 0.6; }
    .count-label { font-size: 11px; opacity: 0.6; margin-left: auto; }

    .fav-btn {
        background: transparent; border: none; cursor: pointer; font-size: 16px;
        padding: 2px 6px; line-height: 1; opacity: 0.5; flex-shrink: 0;
    }
    .fav-btn.favorited { opacity: 1; }
    .fav-btn:hover { opacity: 1; }

    .history-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
    }
    .history-item + .history-item { margin-top: 6px; }
    .history-info { flex: 1; min-width: 0; }
    .history-name { font-weight: 600; font-size: 13px; }
    .history-time { font-size: 11px; opacity: 0.6; margin-top: 2px; }
    .history-toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}
<div class="tab-bar">
    <button class="tab-btn active" data-tab="snippets">Snippets</button>
    <button class="tab-btn" data-tab="favorites">Favorites</button>
    <button class="tab-btn" data-tab="history">History</button>
</div>

<div class="tab-content active" id="tab-snippets">
    <div class="toolbar">
        <input class="search-input" id="searchInput" placeholder="Search snippets... (e.g. hook, network, viewcontroller)" />
        <button class="io-btn" id="btnImport" title="Import snippets from JSON file">Import</button>
        <button class="io-btn" id="btnExport" title="Export snippets to JSON file">Export</button>
        <span class="count-label" id="countLabel"></span>
    </div>
    <div class="filter-bar" id="filterBar"></div>
    <div class="snippet-list" id="snippetList"></div>
</div>

<div class="tab-content" id="tab-favorites">
    <div class="snippet-list" id="favList"></div>
</div>

<div class="tab-content" id="tab-history">
    <div class="history-toolbar">
        <button class="io-btn" id="btnClearHistory">Clear History</button>
    </div>
    <div id="historyList"></div>
</div>

<script nonce="${nonce}">
${OVERLAY_JS}
    const vscode = acquireVsCodeApi();
    let ALL_SNIPPETS = ${snippetsJson};
    const BUILTIN_IDS = new Set(${builtinIds});
    const CATEGORIES = ${categoriesJson};
    let favoriteIds = new Set(${favoritesJson});
    let historyEntries = ${historyJson};

    let currentFilter = null;
    let expandedId = null;
    let currentTab = 'snippets';

    function init() {
        renderFilters();
        renderSnippets(ALL_SNIPPETS);
        renderFavorites();
        renderHistory();

        document.getElementById('searchInput').addEventListener('input', onSearch);
        document.getElementById('btnImport').addEventListener('click', () => {
            vscode.postMessage({ command: 'importSnippets' });
        });
        document.getElementById('btnExport').addEventListener('click', () => {
            vscode.postMessage({ command: 'exportSnippets', scope: 'all' });
        });
        document.getElementById('btnClearHistory').addEventListener('click', () => {
            vscode.postMessage({ command: 'clearHistory' });
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById('tab-' + currentTab).classList.add('active');
                if (currentTab === 'favorites') renderFavorites();
                if (currentTab === 'history') renderHistory();
            });
        });
    }

    function renderFilters() {
        const bar = document.getElementById('filterBar');
        let html = '<button class="filter-btn active" data-cat="all">All</button>';
        for (const [key, label] of Object.entries(CATEGORIES)) {
            const count = ALL_SNIPPETS.filter(s => s.category === key).length;
            html += '<button class="filter-btn" data-cat="' + key + '">' + label + ' (' + count + ')</button>';
        }
        bar.innerHTML = html;
        bar.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.dataset.cat;
                currentFilter = cat === 'all' ? null : cat;
                bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                applyFilters();
            });
        });
    }

    function onSearch() { applyFilters(); }

    function applyFilters() {
        const query = document.getElementById('searchInput').value.toLowerCase();
        let list = ALL_SNIPPETS;
        if (currentFilter) { list = list.filter(s => s.category === currentFilter); }
        if (query) {
            list = list.filter(s =>
                s.name.toLowerCase().includes(query) ||
                s.description.toLowerCase().includes(query) ||
                s.tags.some(t => t.includes(query))
            );
        }
        renderSnippets(list);
    }

    function renderSnippets(snippets) {
        const container = document.getElementById('snippetList');
        document.getElementById('countLabel').textContent = snippets.length + ' snippets';

        if (snippets.length === 0) {
            container.innerHTML = '<div class="empty-state">No snippets match your search.</div>';
            return;
        }

        container.innerHTML = snippets.map(s => buildSnippetCard(s)).join('');
        bindSnippetCardEvents(container);
    }

    function buildSnippetCard(s) {
        const eid = escapeHtml(s.id);
        const isOpen = expandedId === s.id;
        const paramHtml = (s.params || []).map(p =>
            '<div class="param-row">' +
            '  <span class="param-label">' + escapeHtml(p.name) + '</span>' +
            '  <input class="param-input" data-snippet="' + eid + '" data-param="' + escapeHtml(p.name) + '" ' +
            '         placeholder="' + escapeHtml(p.placeholder) + '" value="' + escapeHtml(p.placeholder) + '" title="' + escapeHtml(p.description) + '" />' +
            '</div>'
        ).join('');

        const isCustom = !BUILTIN_IDS.has(s.id);
        const customTag = isCustom ? '<span class="custom-badge">custom</span>' : '';
        const deleteBtn = isCustom ? '  <button class="delete-btn" data-action="delete" data-id="' + eid + '">Delete</button>' : '';
        const favClass = favoriteIds.has(s.id) ? ' favorited' : '';
        const favIcon = favoriteIds.has(s.id) ? '★' : '☆';

        return '<div class="snippet-card' + (isOpen ? ' open' : '') + '" data-id="' + eid + '">' +
            '<div class="snippet-header" data-toggle="' + eid + '">' +
            '  <button class="fav-btn' + favClass + '" data-action="fav" data-id="' + eid + '" title="Toggle favorite">' + favIcon + '</button>' +
            '  <div class="snippet-title-block">' +
            '    <div class="snippet-name">' + escapeHtml(s.name) + customTag + '</div>' +
            '    <div class="snippet-desc">' + escapeHtml(s.description) + '</div>' +
            '  </div>' +
            '  <span class="snippet-badge">' + escapeHtml(CATEGORIES[s.category] || s.category) + '</span>' +
            '</div>' +
            '<div class="snippet-body">' +
            paramHtml +
            '<pre class="code-preview">' + escapeHtml(renderCode(s)) + '</pre>' +
            '<div class="action-bar">' +
            '  <button class="action-btn" data-action="run" data-id="' + eid + '">Run on Device</button>' +
            '  <button class="action-btn secondary" data-action="insert" data-id="' + eid + '">Open in Editor</button>' +
            '  <button class="action-btn secondary" data-action="copy" data-id="' + eid + '">Copy</button>' +
            deleteBtn +
            '</div>' +
            '</div>' +
            '</div>';
    }

    function bindSnippetCardEvents(container) {
        container.querySelectorAll('.snippet-header').forEach(hdr => {
            hdr.addEventListener('click', (e) => {
                if (e.target.closest('.fav-btn')) return;
                const id = hdr.dataset.toggle;
                expandedId = expandedId === id ? null : id;
                applyFilters();
                if (currentTab === 'favorites') renderFavorites();
            });
        });

        container.querySelectorAll('.fav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'toggleFavorite', id: btn.dataset.id });
            });
        });

        container.querySelectorAll('.param-input').forEach(input => {
            input.addEventListener('input', () => {
                const card = input.closest('.snippet-card');
                const sid = card.dataset.id;
                const s = ALL_SNIPPETS.find(x => x.id === sid);
                if (s) {
                    const pre = card.querySelector('.code-preview');
                    pre.textContent = renderCode(s, card);
                }
            });
        });

        container.querySelectorAll('.action-btn, .delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                if (action === 'delete') {
                    vscode.postMessage({ command: 'deleteCustomSnippet', id });
                    return;
                }
                const card = btn.closest('.snippet-card');
                const params = getParams(card);
                vscode.postMessage({ command: action === 'run' ? 'runOnDevice' : action === 'insert' ? 'insertToEditor' : 'copyCode', id, params });
            });
        });
    }

    function renderFavorites() {
        const container = document.getElementById('favList');
        const favSnippets = ALL_SNIPPETS.filter(s => favoriteIds.has(s.id));
        if (favSnippets.length === 0) {
            container.innerHTML = '<div class="empty-state">No favorites yet. Star a snippet to add it here.</div>';
            return;
        }
        container.innerHTML = favSnippets.map(s => buildSnippetCard(s)).join('');
        bindSnippetCardEvents(container);
    }

    function renderHistory() {
        const container = document.getElementById('historyList');
        if (historyEntries.length === 0) {
            container.innerHTML = '<div class="empty-state">No execution history yet.</div>';
            return;
        }
        container.innerHTML = historyEntries.map((entry, i) => {
            const timeStr = new Date(entry.timestamp).toLocaleString();
            return '<div class="history-item">' +
                '<div class="history-info">' +
                '  <div class="history-name">' + escapeHtml(entry.snippetName) + '</div>' +
                '  <div class="history-time">' + escapeHtml(timeStr) + '</div>' +
                '</div>' +
                '<button class="action-btn" data-action="rerun" data-snippet-id="' + escapeHtml(entry.snippetId) + '" data-index="' + i + '">Re-run</button>' +
                '</div>';
        }).join('');

        container.querySelectorAll('[data-action="rerun"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                const entry = historyEntries[idx];
                if (entry) {
                    vscode.postMessage({ command: 'rerunFromHistory', snippetId: entry.snippetId, params: entry.params });
                }
            });
        });
    }

    function getParams(card) {
        const params = {};
        card.querySelectorAll('.param-input').forEach(input => {
            params[input.dataset.param] = input.value;
        });
        return params;
    }

    function renderCode(snippet, card) {
        let code = snippet.code;
        if (snippet.params && card) {
            card.querySelectorAll('.param-input').forEach(input => {
                code = code.split('{{' + input.dataset.param + '}}').join(input.value || input.placeholder);
            });
        } else if (snippet.params) {
            snippet.params.forEach(p => {
                code = code.split('{{' + p.name + '}}').join(p.placeholder);
            });
        }
        return code;
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.command === 'refreshAll') {
            ALL_SNIPPETS = msg.snippets;
            if (msg.favorites) favoriteIds = new Set(msg.favorites);
            if (msg.history) historyEntries = msg.history;
            applyFilters();
            renderFavorites();
            renderHistory();
        }
        if (msg.command === 'favoritesUpdated') {
            favoriteIds = new Set(msg.favorites);
            applyFilters();
            if (currentTab === 'favorites') renderFavorites();
        }
        if (msg.command === 'historyData') {
            historyEntries = msg.history;
            renderHistory();
        }
    });

    init();
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
