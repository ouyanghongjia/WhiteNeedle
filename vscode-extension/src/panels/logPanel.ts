import * as vscode from 'vscode';
import { LogStore, LogEntry, LogCategory, LogLevel, LogFilter, MarkerInfo } from '../logs/logStore';

export { LogCategory, LogLevel };

export class LogPanel {
    public static currentPanel: LogPanel | undefined;
    private static readonly viewType = 'whiteneedle.logPanel';

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private _onToggleNativeLog: ((enabled: boolean) => void) | undefined;
    private _rpcCall: ((method: string, params: any) => Promise<any>) | undefined;
    private _disposed = false;

    private currentFilter: LogFilter = {};
    private paused = false;
    private pausedNewCount = 0;

    public static createOrShow(extensionUri: vscode.Uri): LogPanel {
        const column = vscode.ViewColumn.One;
        if (LogPanel.currentPanel) {
            LogPanel.currentPanel.panel.reveal(column);
            return LogPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(
            LogPanel.viewType,
            'WhiteNeedle Logs',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        LogPanel.currentPanel = new LogPanel(panel, extensionUri);
        return LogPanel.currentPanel;
    }

    public static getInstance(): LogPanel | undefined {
        return LogPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getHtml();

        const store = LogStore.getInstance();

        this.panel.webview.onDidReceiveMessage(
            (msg) => this.handleWebviewMessage(msg),
            null,
            this.disposables
        );

        this.disposables.push(
            store.onDidAppend(({ entry }) => {
                if (this.paused) {
                    this.pausedNewCount++;
                    this.post({ command: 'pauseCount', count: this.pausedNewCount });
                    return;
                }
                if (entry.category === 'Marker' || store.matchesFilter(entry, this.currentFilter)) {
                    this.post({ command: 'appendEntry', entry, totalAll: store.totalCount });
                }
            }),
            store.onDidReset(() => {
                this.post({ command: 'setData', entries: [], totalAll: 0, markers: [], hiddenCount: 0 });
            }),
            store.onDidClearScreen(() => {
                this.sendFullData();
            })
        );
    }

    public set onToggleNativeLog(handler: (enabled: boolean) => void) {
        this._onToggleNativeLog = handler;
    }

    public set rpcCall(fn: (method: string, params: any) => Promise<any>) {
        this._rpcCall = fn;
    }

    public syncNativeLogState(enabled: boolean): void {
        this.post({ command: 'syncNativeLogState', enabled });
    }

    private async handleWebviewMessage(msg: any): Promise<void> {
        try { await this._handleMessage(msg); } catch (err: any) {
            console.error('[LogPanel] Message handler error:', err);
        }
    }

    private async _handleMessage(msg: any): Promise<void> {
        const store = LogStore.getInstance();

        switch (msg.command) {
            case 'ready':
                this.sendFullData();
                break;

            case 'updateFilter':
                this.currentFilter = {
                    categories: msg.categories ? new Set(msg.categories as string[]) : undefined,
                    levels: msg.levels ? new Set(msg.levels as string[]) : undefined,
                    search: msg.search || undefined,
                    showCleared: !!msg.showCleared,
                };
                this.sendFullData();
                break;

            case 'clearScreen':
                store.clearScreen();
                break;

            case 'deleteAll': {
                const answer = await vscode.window.showWarningMessage(
                    'Permanently delete all log entries? This cannot be undone.',
                    { modal: true },
                    'Delete All'
                );
                if (answer === 'Delete All') {
                    store.deleteAll();
                }
                break;
            }

            case 'insertMarker': {
                const label = await vscode.window.showInputBox({
                    prompt: 'Enter marker label',
                    placeHolder: 'e.g. Start of bug repro',
                });
                if (label) {
                    store.insertMarker(label);
                }
                break;
            }

            case 'export':
                await this.handleExport();
                break;

            case 'toggleNativeLog':
                this._onToggleNativeLog?.(!!msg.enabled);
                break;

            case 'browseHistory':
                await this.browseHistory();
                break;

            case 'togglePause':
                this.paused = !!msg.paused;
                if (!this.paused) {
                    this.pausedNewCount = 0;
                    this.sendFullData();
                }
                break;
        }
    }

    private sendFullData(): void {
        const store = LogStore.getInstance();
        const entries = store.queryFiltered(this.currentFilter);
        this.post({
            command: 'setData',
            entries,
            totalAll: store.totalCount,
            markers: store.markers,
            hiddenCount: this.currentFilter.showCleared ? 0 : store.hiddenCount(),
        });
    }

    private async handleExport(): Promise<void> {
        const store = LogStore.getInstance();
        const markers = store.markers;

        const modeItems: { label: string; id: string }[] = [
            { label: '$(filter) Export current filtered view', id: 'filtered' },
            { label: '$(list-flat) Export all logs (ignore filters)', id: 'all' },
        ];
        if (markers.length >= 2) {
            modeItems.push({ label: '$(bookmark) Export between markers\u2026', id: 'markers' });
        }

        const mode = await vscode.window.showQuickPick(modeItems, { placeHolder: 'Export scope' });
        if (!mode) { return; }

        let exportFilter: LogFilter = { ...this.currentFilter, showCleared: true };
        let indexRange: { start: number; end: number } | undefined;

        if (mode.id === 'all') {
            exportFilter = { showCleared: true };
        } else if (mode.id === 'markers') {
            const startPick = await vscode.window.showQuickPick(
                markers.map(m => ({ label: `\ud83d\udccc ${m.label}`, description: new Date(m.timestamp).toLocaleTimeString(), idx: m.index })),
                { placeHolder: 'Select start marker' }
            );
            if (!startPick) { return; }
            const endPick = await vscode.window.showQuickPick(
                markers.filter(m => m.index > (startPick as any).idx)
                    .map(m => ({ label: `\ud83d\udccc ${m.label}`, description: new Date(m.timestamp).toLocaleTimeString(), idx: m.index })),
                { placeHolder: 'Select end marker' }
            );
            if (!endPick) { return; }
            indexRange = { start: (startPick as any).idx, end: (endPick as any).idx };
        }

        const formatPick = await vscode.window.showQuickPick([
            { label: 'Text (.log)', id: 'text' as const },
            { label: 'JSON Lines (.jsonl)', id: 'jsonl' as const },
            { label: 'CSV (.csv)', id: 'csv' as const },
        ], { placeHolder: 'Export format' });
        if (!formatPick) { return; }

        const extMap = { text: 'log', jsonl: 'jsonl', csv: 'csv' } as const;
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`whiteneedle-logs.${extMap[formatPick.id]}`),
            filters: { 'Log Files': [extMap[formatPick.id]] },
        });
        if (!uri) { return; }

        const count = await store.exportToFile(uri, exportFilter, formatPick.id, indexRange);
        vscode.window.showInformationMessage(`Exported ${count} log entries.`);
    }

    private async browseHistory(): Promise<void> {
        if (!this._rpcCall) {
            vscode.window.showWarningMessage('Not connected to a device');
            return;
        }

        const result = await this._rpcCall('listNativeLogSessions', {});
        const sessions = result?.sessions as Array<{
            filename: string; size: number; created: number; modified: number; isActive: boolean;
        }>;

        if (!sessions || sessions.length === 0) {
            vscode.window.showInformationMessage('No log sessions found on device');
            return;
        }

        const fmtSize = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`;

        const items = sessions.map(s => ({
            label: (s.isActive ? '$(record) ' : '$(file) ') + s.filename,
            description: `${fmtSize(s.size)} · ${new Date(s.created).toLocaleString()}`,
            detail: s.isActive ? 'Active session (current)' : undefined,
            session: s,
        }));

        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a log session from device' });
        if (!pick) { return; }

        const actions: { label: string; id: string }[] = [
            { label: '$(open-preview) View in Editor', id: 'view' },
            { label: '$(cloud-download) Save to File', id: 'save' },
            { label: '$(arrow-down) Import to Current View', id: 'import' },
        ];
        if (!pick.session.isActive) {
            actions.push({ label: '$(trash) Delete from Device', id: 'delete' });
        }

        const action = await vscode.window.showQuickPick(actions, { placeHolder: 'Choose action' });
        if (!action) { return; }

        if (action.id === 'delete') {
            await this._rpcCall('deleteNativeLogSession', { filename: pick.session.filename });
            vscode.window.showInformationMessage(`Deleted ${pick.session.filename}`);
            return;
        }

        const allEntries: any[] = [];
        let offset = 0;
        const maxEntries = 50000;
        // eslint-disable-next-line no-constant-condition
        while (allEntries.length < maxEntries) {
            const chunk = await this._rpcCall!('readNativeLogSession', {
                filename: pick.session.filename, offset, limit: 500,
            });
            if (chunk.entries && chunk.entries.length > 0) {
                allEntries.push(...chunk.entries);
                offset = chunk.nextOffset;
            }
            if (!chunk.hasMore) { break; }
        }

        if (allEntries.length === 0) {
            vscode.window.showInformationMessage('Session is empty');
            return;
        }

        if (action.id === 'view') {
            const lines = allEntries.map(e => {
                const ts = new Date(e.ts).toISOString();
                return `[${ts}] [${(e.level || 'log').toUpperCase()}] ${e.message}`;
            });
            const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'log' });
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        } else if (action.id === 'save') {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(pick.session.filename),
                filters: { 'JSON Lines': ['jsonl'], 'Text Logs': ['log'] },
            });
            if (!uri) { return; }
            const isJsonl = uri.fsPath.endsWith('.jsonl');
            const content = isJsonl
                ? allEntries.map(e => JSON.stringify(e)).join('\n')
                : allEntries.map(e => `[${new Date(e.ts).toISOString()}] [${(e.level || 'log').toUpperCase()}] ${e.message}`).join('\n');
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            vscode.window.showInformationMessage(`Saved ${allEntries.length} entries to file`);
        } else if (action.id === 'import') {
            const store = LogStore.getInstance();
            store.insertMarker(`\u2500\u2500 Imported: ${pick.session.filename} \u2500\u2500`);
            for (const e of allEntries) {
                const lvl = (e.level === 'warn' || e.level === 'error' || e.level === 'debug') ? e.level as LogLevel : 'log';
                store.append({ timestamp: e.ts || Date.now(), category: 'Native', level: lvl, message: e.message || '', source: 'history' });
            }
            vscode.window.showInformationMessage(`Imported ${allEntries.length} entries`);
        }
    }

    private post(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        if (this._disposed) { return; }
        this._disposed = true;
        LogPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    /* ─────────────────────────── Webview HTML ─────────────────────────── */

    private getHtml(): string {
        const nonce = getNonce();
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>WhiteNeedle Logs</title>
<style>
:root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, var(--vscode-widget-border, #444));
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, var(--border));
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --list-hover: var(--vscode-list-hoverBackground);
    --error-fg: #f44;
    --warn-fg: #fa0;
    --debug-fg: #888;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; color: var(--fg); background: var(--bg); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.toolbar { display: flex; gap: 6px; padding: 6px 8px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.toolbar input { flex: 1; min-width: 120px; padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; outline: none; font-size: 12px; }
.toolbar input:focus { border-color: var(--btn-bg); }
button { padding: 3px 8px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 11px; white-space: nowrap; }
button:hover { background: var(--btn-hover); }
button.active { outline: 2px solid var(--btn-bg); outline-offset: 1px; }
button.danger { background: #a33; }
button.danger:hover { background: #c44; }

.filters { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.chip { padding: 2px 8px; border-radius: 10px; font-size: 11px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); opacity: 0.5; transition: opacity 0.15s; user-select: none; }
.chip.on { opacity: 1; border-color: var(--btn-bg); }
.chip[data-cat="Console"] { border-color: #4a4; } .chip[data-cat="Console"].on { background: #1a3a1a; }
.chip[data-cat="Hook"]    { border-color: #44a; } .chip[data-cat="Hook"].on    { background: #1a1a3a; }
.chip[data-cat="Network"] { border-color: #a84; } .chip[data-cat="Network"].on { background: #3a2a1a; }
.chip[data-cat="Error"]   { border-color: #a44; } .chip[data-cat="Error"].on   { background: #3a1a1a; }
.chip[data-cat="System"]  { border-color: #888; } .chip[data-cat="System"].on  { background: #2a2a2a; }
.chip[data-cat="Native"]  { border-color: #a4a; } .chip[data-cat="Native"].on  { background: #2a1a2a; }
.chip[data-lvl="error"] { color: var(--error-fg); }
.chip[data-lvl="warn"]  { color: var(--warn-fg); }
.chip[data-lvl="debug"] { color: var(--debug-fg); }

#logContainer { flex: 1; overflow-y: auto; position: relative; }
#scrollSpacer { width: 100%; }
#viewport { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }

.row { display: flex; gap: 8px; padding: 0 8px; height: 24px; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); font-family: var(--vscode-editor-font-family, monospace); }
.row:hover { background: var(--list-hover); }
.r-ts  { flex-shrink: 0; color: var(--debug-fg); width: 85px; font-size: 11px; }
.r-cat { flex-shrink: 0; width: 60px; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; padding: 1px 4px; border-radius: 3px; text-align: center; }
.r-cat-Console { color: #4a4; background: rgba(68,170,68,.1); }
.r-cat-Hook    { color: #88f; background: rgba(68,68,170,.1); }
.r-cat-Network { color: #fa0; background: rgba(170,136,68,.1); }
.r-cat-Error   { color: #f44; background: rgba(170,68,68,.1); }
.r-cat-System  { color: #888; background: rgba(136,136,136,.1); }
.r-cat-Native  { color: #c4a; background: rgba(170,68,170,.1); }
.r-lvl { flex-shrink: 0; width: 38px; font-size: 10px; }
.r-lvl-error { color: var(--error-fg); }
.r-lvl-warn  { color: var(--warn-fg); }
.r-lvl-debug { color: var(--debug-fg); }
.r-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.marker-row { height: 24px; display: flex; align-items: center; justify-content: center; color: #da0; font-size: 11px; border-top: 1px dashed rgba(221,170,0,.4); border-bottom: 1px dashed rgba(221,170,0,.4); background: rgba(221,170,0,.06); gap: 6px; }
.marker-row .marker-icon { font-size: 13px; }

.hidden-banner { padding: 4px 12px; font-size: 11px; background: rgba(255,255,255,.04); border-bottom: 1px solid var(--border); display: none; flex-shrink: 0; }
.hidden-banner a { color: var(--btn-bg); cursor: pointer; text-decoration: underline; }

.pause-banner { padding: 4px 12px; font-size: 11px; background: rgba(255,165,0,.08); border-bottom: 1px solid rgba(255,165,0,.2); display: none; flex-shrink: 0; color: #fa0; }

.empty { text-align: center; padding: 40px; opacity: .5; }
.badge { display: inline-block; padding: 0 6px; font-size: 10px; border-radius: 8px; background: var(--btn-bg); color: var(--btn-fg); margin-left: 2px; }
.sep { opacity: .3; font-size: 11px; margin: 0 2px; }
</style>
</head>
<body>
<div class="toolbar">
    <input id="searchInput" placeholder="Search logs (text or /regex/)..." />
    <button id="pauseBtn" title="Pause / Resume log stream">\u23f8</button>
    <button id="clearBtn" title="Clear screen (right-click to delete all)">Clear</button>
    <button id="markerBtn" title="Insert marker">\ud83d\udccc Mark</button>
    <button id="exportBtn" title="Export logs">Export</button>
    <button id="historyBtn" title="Browse native log sessions on device">\ud83d\uddc2 History</button>
    <button id="scrollBtn" title="Auto-scroll to bottom" class="active">\u2193 Auto</button>
    <button id="nativeLogBtn" title="Toggle native log capture (NSLog)">\u25cf Native OFF</button>
    <span id="countBadge" class="badge">0</span>
</div>
<div class="toolbar filters">
    <span class="sep">Cat:</span>
    <span class="chip on" data-cat="Console">Console</span>
    <span class="chip on" data-cat="Hook">Hook</span>
    <span class="chip on" data-cat="Network">Network</span>
    <span class="chip on" data-cat="Error">Error</span>
    <span class="chip on" data-cat="System">System</span>
    <span class="chip on" data-cat="Native">Native</span>
    <span class="sep" style="margin-left:6px">Lvl:</span>
    <span class="chip on" data-lvl="log">log</span>
    <span class="chip on" data-lvl="warn">warn</span>
    <span class="chip on" data-lvl="error">error</span>
    <span class="chip on" data-lvl="debug">debug</span>
</div>
<div id="hiddenBanner" class="hidden-banner">
    <span id="hiddenText"></span> <a id="showHiddenLink">Show all</a>
    <span style="margin-left:12px;opacity:.5">|</span>
    <a id="deleteAllLink" style="color:#f44;margin-left:8px;cursor:pointer">Delete all logs permanently</a>
</div>
<div id="pauseBanner" class="pause-banner">\u23f8 Paused \u2014 <span id="pauseCountText">0</span> new entries buffered. Click Resume to update.</div>
<div id="logContainer">
    <div id="scrollSpacer"></div>
    <div id="viewport"></div>
</div>

<script nonce="${nonce}">
(function() {
    var vscode = acquireVsCodeApi();
    var ROW_H = 24, BUF = 30;
    var entries = [];
    var autoScroll = true;
    var paused = false;
    var activeCats = { Console:1, Hook:1, Network:1, Error:1, System:1, Native:1 };
    var activeLvls = { log:1, warn:1, error:1, debug:1 };
    var searchText = '';
    var totalAll = 0;
    var hiddenCount = 0;
    var showCleared = false;

    var container = document.getElementById('logContainer');
    var spacer = document.getElementById('scrollSpacer');
    var viewport = document.getElementById('viewport');
    var searchInput = document.getElementById('searchInput');
    var pauseBtn = document.getElementById('pauseBtn');
    var clearBtn = document.getElementById('clearBtn');
    var markerBtn = document.getElementById('markerBtn');
    var exportBtn = document.getElementById('exportBtn');
    var scrollBtn = document.getElementById('scrollBtn');
    var nativeLogBtn = document.getElementById('nativeLogBtn');
    var countBadge = document.getElementById('countBadge');
    var hiddenBanner = document.getElementById('hiddenBanner');
    var hiddenText = document.getElementById('hiddenText');
    var showHiddenLink = document.getElementById('showHiddenLink');
    var deleteAllLink = document.getElementById('deleteAllLink');
    var pauseBanner = document.getElementById('pauseBanner');
    var pauseCountText = document.getElementById('pauseCountText');

    var renderedStart = -1, renderedEnd = -1;

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function fmtTime(ts) {
        var d = new Date(ts);
        return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' +
               String(d.getSeconds()).padStart(2,'0') + '.' + String(d.getMilliseconds()).padStart(3,'0');
    }
    function buildRow(e) {
        if (e.category === 'Marker') {
            return '<div class="marker-row"><span class="marker-icon">\\ud83d\\udccc</span>' + esc(e.message) + ' <span style="opacity:.5">' + fmtTime(e.timestamp) + '</span></div>';
        }
        return '<div class="row">' +
            '<span class="r-ts">' + fmtTime(e.timestamp) + '</span>' +
            '<span class="r-cat r-cat-' + e.category + '">' + e.category + '</span>' +
            '<span class="r-lvl r-lvl-' + e.level + '">' + e.level + '</span>' +
            '<span class="r-msg">' + esc(e.message) + '</span></div>';
    }
    function updateBadge() {
        var f = entries.length, t = totalAll;
        countBadge.textContent = f < t ? f + '/' + t : String(f);
    }
    function updateHiddenBanner() {
        if (hiddenCount > 0 && !showCleared) {
            hiddenBanner.style.display = 'block';
            hiddenText.textContent = hiddenCount + ' entries hidden (before clear screen).';
        } else {
            hiddenBanner.style.display = 'none';
        }
    }

    /* ── Virtual Scroll ────────────────────────── */
    var rafId = 0;
    function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(doRender); }
    function doRender() {
        rafId = 0;
        var total = entries.length;
        spacer.style.height = (total * ROW_H) + 'px';
        if (total === 0) {
            viewport.innerHTML = '<div class="empty">No logs matching filters</div>';
            viewport.style.transform = '';
            renderedStart = renderedEnd = -1;
            return;
        }
        var scrollTop = container.scrollTop;
        var viewH = container.clientHeight;
        var viewRows = Math.ceil(viewH / ROW_H) + 1;
        var first = Math.max(0, Math.floor(scrollTop / ROW_H) - BUF);
        var last = Math.min(total, Math.floor(scrollTop / ROW_H) + viewRows + BUF);
        if (first === renderedStart && last === renderedEnd) return;
        renderedStart = first;
        renderedEnd = last;
        viewport.style.transform = 'translateY(' + (first * ROW_H) + 'px)';
        var html = '';
        for (var i = first; i < last; i++) html += buildRow(entries[i]);
        viewport.innerHTML = html;
    }

    container.addEventListener('scroll', function() {
        scheduleRender();
        var atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - ROW_H * 2;
        if (!atBottom && autoScroll) {
            autoScroll = false;
            scrollBtn.className = '';
        }
    });
    new ResizeObserver(scheduleRender).observe(container);

    function scrollToBottom() {
        container.scrollTop = container.scrollHeight;
        scheduleRender();
    }

    /* ── Filter sync ──────────────────────────── */
    var filterTimeout = 0;
    function sendFilter() {
        var cats = [], lvls = [];
        for (var c in activeCats) { if (activeCats[c]) cats.push(c); }
        for (var l in activeLvls) { if (activeLvls[l]) lvls.push(l); }
        vscode.postMessage({ command: 'updateFilter', categories: cats, levels: lvls, search: searchText, showCleared: showCleared });
    }
    function debouncedFilter() {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(sendFilter, 150);
    }

    /* ── Event listeners ──────────────────────── */
    searchInput.addEventListener('input', function() { searchText = this.value; debouncedFilter(); });

    document.querySelectorAll('.chip[data-cat]').forEach(function(el) {
        el.addEventListener('click', function() {
            var cat = this.getAttribute('data-cat');
            activeCats[cat] = activeCats[cat] ? 0 : 1;
            this.className = 'chip' + (activeCats[cat] ? ' on' : '');
            sendFilter();
        });
    });
    document.querySelectorAll('.chip[data-lvl]').forEach(function(el) {
        el.addEventListener('click', function() {
            var lvl = this.getAttribute('data-lvl');
            activeLvls[lvl] = activeLvls[lvl] ? 0 : 1;
            this.className = 'chip' + (activeLvls[lvl] ? ' on' : '');
            sendFilter();
        });
    });

    pauseBtn.addEventListener('click', function() {
        paused = !paused;
        pauseBtn.textContent = paused ? '\\u25b6' : '\\u23f8';
        pauseBtn.className = paused ? 'active' : '';
        pauseBanner.style.display = paused ? 'block' : 'none';
        vscode.postMessage({ command: 'togglePause', paused: paused });
    });

    clearBtn.addEventListener('click', function() {
        showCleared = false;
        vscode.postMessage({ command: 'clearScreen' });
    });
    clearBtn.addEventListener('contextmenu', function(ev) {
        ev.preventDefault();
        vscode.postMessage({ command: 'deleteAll' });
    });
    deleteAllLink.addEventListener('click', function(ev) {
        ev.preventDefault();
        vscode.postMessage({ command: 'deleteAll' });
    });

    showHiddenLink.addEventListener('click', function(ev) {
        ev.preventDefault();
        showCleared = true;
        sendFilter();
    });

    var historyBtn = document.getElementById('historyBtn');
    markerBtn.addEventListener('click', function() { vscode.postMessage({ command: 'insertMarker' }); });
    exportBtn.addEventListener('click', function() { vscode.postMessage({ command: 'export' }); });
    historyBtn.addEventListener('click', function() { vscode.postMessage({ command: 'browseHistory' }); });

    scrollBtn.addEventListener('click', function() {
        autoScroll = !autoScroll;
        scrollBtn.className = autoScroll ? 'active' : '';
        if (autoScroll) scrollToBottom();
    });

    var nativeLogOn = false;
    nativeLogBtn.addEventListener('click', function() {
        nativeLogOn = !nativeLogOn;
        nativeLogBtn.className = nativeLogOn ? 'active' : '';
        nativeLogBtn.textContent = nativeLogOn ? '\\u25cf Native ON' : '\\u25cf Native OFF';
        vscode.postMessage({ command: 'toggleNativeLog', enabled: nativeLogOn });
    });

    /* ── Messages from host ────────────────────── */
    window.addEventListener('message', function(ev) {
        var msg = ev.data;
        switch (msg.command) {
            case 'setData':
                entries = msg.entries || [];
                totalAll = msg.totalAll || 0;
                hiddenCount = msg.hiddenCount || 0;
                updateHiddenBanner();
                updateBadge();
                renderedStart = renderedEnd = -1;
                spacer.style.height = (entries.length * ROW_H) + 'px';
                if (autoScroll) {
                    container.scrollTop = container.scrollHeight;
                } else {
                    var maxScroll = Math.max(0, entries.length * ROW_H - container.clientHeight);
                    if (container.scrollTop > maxScroll) container.scrollTop = maxScroll;
                }
                scheduleRender();
                break;

            case 'appendEntry':
                entries.push(msg.entry);
                totalAll = msg.totalAll || totalAll;
                updateBadge();
                spacer.style.height = (entries.length * ROW_H) + 'px';
                if (autoScroll) {
                    container.scrollTop = container.scrollHeight;
                }
                scheduleRender();
                break;

            case 'pauseCount':
                pauseCountText.textContent = String(msg.count || 0);
                break;

            case 'syncNativeLogState':
                nativeLogOn = !!msg.enabled;
                nativeLogBtn.className = nativeLogOn ? 'active' : '';
                nativeLogBtn.textContent = nativeLogOn ? '\\u25cf Native ON' : '\\u25cf Native OFF';
                break;
        }
    });

    vscode.postMessage({ command: 'ready' });
})();
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
