import * as vscode from 'vscode';

export type LogCategory = 'Console' | 'Hook' | 'Network' | 'Error' | 'System';
export type LogLevel = 'log' | 'warn' | 'error' | 'debug';

export interface LogEntry {
    timestamp: number;
    category: LogCategory;
    level: LogLevel;
    message: string;
    source?: string;
}

const MAX_LOG_ENTRIES = 5000;

export class LogPanel {
    public static currentPanel: LogPanel | undefined;
    private static readonly viewType = 'whiteneedle.logPanel';

    private readonly panel: vscode.WebviewPanel;
    private logs: LogEntry[] = [];
    private disposables: vscode.Disposable[] = [];

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

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg) => {
                switch (msg.command) {
                    case 'clearLogs':
                        this.logs = [];
                        this.postMessage({ command: 'logsCleared' });
                        break;
                    case 'exportLogs':
                        this.exportLogs(msg.filteredLogs);
                        break;
                    case 'requestAllLogs':
                        this.postMessage({ command: 'allLogs', logs: this.logs });
                        break;
                }
            },
            null,
            this.disposables
        );
        this.panel.webview.html = this.getHtml();
    }

    public appendLog(category: LogCategory, level: LogLevel, message: string, source?: string): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            category,
            level,
            message,
            source,
        };
        this.logs.push(entry);
        if (this.logs.length > MAX_LOG_ENTRIES) {
            this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
        }
        this.postMessage({ command: 'newLog', entry });
    }

    private async exportLogs(filteredLogs?: LogEntry[]): Promise<void> {
        const entries = filteredLogs || this.logs;
        const lines = entries.map(e => {
            const ts = new Date(e.timestamp).toISOString();
            return `[${ts}] [${e.category}] [${e.level.toUpperCase()}] ${e.message}`;
        });
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('whiteneedle-logs.txt'),
            filters: { 'Log Files': ['txt', 'log'] },
        });
        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(lines.join('\n'), 'utf-8'));
            vscode.window.showInformationMessage(`Exported ${entries.length} log entries.`);
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        LogPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    private getHtml(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
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
        --console-bg: #1a3a1a;
        --hook-bg: #1a1a3a;
        --network-bg: #3a2a1a;
        --error-bg: #3a1a1a;
        --system-bg: #2a2a2a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; color: var(--fg); background: var(--bg); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    .toolbar { display: flex; gap: 6px; padding: 8px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; }
    .toolbar input { flex: 1; min-width: 120px; padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; outline: none; font-size: 12px; }
    .toolbar input:focus { border-color: var(--btn-bg); }
    button { padding: 4px 10px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 11px; white-space: nowrap; }
    button:hover { background: var(--btn-hover); }
    button.active { outline: 2px solid var(--btn-bg); outline-offset: 1px; }

    .filters { display: flex; gap: 4px; align-items: center; }
    .filter-chip { padding: 2px 8px; border-radius: 10px; font-size: 11px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); opacity: 0.5; transition: opacity 0.15s; }
    .filter-chip.active { opacity: 1; border-color: var(--btn-bg); }
    .filter-chip[data-cat="Console"] { border-color: #4a4; }
    .filter-chip[data-cat="Console"].active { background: #1a3a1a; }
    .filter-chip[data-cat="Hook"] { border-color: #44a; }
    .filter-chip[data-cat="Hook"].active { background: #1a1a3a; }
    .filter-chip[data-cat="Network"] { border-color: #a84; }
    .filter-chip[data-cat="Network"].active { background: #3a2a1a; }
    .filter-chip[data-cat="Error"] { border-color: #a44; }
    .filter-chip[data-cat="Error"].active { background: #3a1a1a; }
    .filter-chip[data-cat="System"] { border-color: #888; }
    .filter-chip[data-cat="System"].active { background: #2a2a2a; }

    .filter-chip[data-lvl="error"] { color: var(--error-fg); }
    .filter-chip[data-lvl="warn"] { color: var(--warn-fg); }
    .filter-chip[data-lvl="debug"] { color: var(--debug-fg); }

    #logContainer { flex: 1; overflow-y: auto; padding: 0; }
    .log-entry { display: flex; gap: 8px; padding: 3px 8px; border-bottom: 1px solid rgba(255,255,255,0.03); font-family: var(--vscode-editor-font-family, monospace); line-height: 1.5; }
    .log-entry:hover { background: var(--list-hover); }
    .log-ts { flex-shrink: 0; color: var(--debug-fg); min-width: 85px; }
    .log-cat { flex-shrink: 0; min-width: 65px; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; padding: 1px 5px; border-radius: 3px; text-align: center; line-height: 1.6; }
    .log-cat-Console { color: #4a4; background: rgba(68,170,68,0.1); }
    .log-cat-Hook { color: #88f; background: rgba(68,68,170,0.1); }
    .log-cat-Network { color: #fa0; background: rgba(170,136,68,0.1); }
    .log-cat-Error { color: #f44; background: rgba(170,68,68,0.1); }
    .log-cat-System { color: #888; background: rgba(136,136,136,0.1); }
    .log-lvl { flex-shrink: 0; min-width: 40px; font-size: 10px; }
    .log-lvl-error { color: var(--error-fg); }
    .log-lvl-warn { color: var(--warn-fg); }
    .log-lvl-debug { color: var(--debug-fg); }
    .log-msg { flex: 1; word-break: break-all; white-space: pre-wrap; }

    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .badge { display: inline-block; padding: 0 6px; font-size: 10px; border-radius: 8px; background: var(--btn-bg); color: var(--btn-fg); margin-left: 4px; }
</style>
</head>
<body>
<div class="toolbar">
    <input id="searchInput" placeholder="Search logs (text or /regex/)..." />
    <button id="clearBtn" title="Clear all logs">Clear</button>
    <button id="exportBtn" title="Export logs to file">Export</button>
    <button id="scrollBtn" title="Auto-scroll to bottom" class="active">&#8595; Auto</button>
    <span id="countBadge" class="badge">0</span>
</div>
<div class="toolbar filters">
    <span style="opacity:0.5;font-size:11px">Category:</span>
    <span class="filter-chip active" data-cat="Console">Console</span>
    <span class="filter-chip active" data-cat="Hook">Hook</span>
    <span class="filter-chip active" data-cat="Network">Network</span>
    <span class="filter-chip active" data-cat="Error">Error</span>
    <span class="filter-chip active" data-cat="System">System</span>
    <span style="margin-left:8px;opacity:0.5;font-size:11px">Level:</span>
    <span class="filter-chip active" data-lvl="log">log</span>
    <span class="filter-chip active" data-lvl="warn">warn</span>
    <span class="filter-chip active" data-lvl="error">error</span>
    <span class="filter-chip active" data-lvl="debug">debug</span>
</div>
<div id="logContainer"></div>

<script nonce="${nonce}">
(function() {
    var vscode = acquireVsCodeApi();
    var allLogs = [];
    var autoScroll = true;
    var activeCategories = { Console: true, Hook: true, Network: true, Error: true, System: true };
    var activeLevels = { log: true, warn: true, error: true, debug: true };
    var searchText = '';

    var container = document.getElementById('logContainer');
    var searchInput = document.getElementById('searchInput');
    var clearBtn = document.getElementById('clearBtn');
    var exportBtn = document.getElementById('exportBtn');
    var scrollBtn = document.getElementById('scrollBtn');
    var countBadge = document.getElementById('countBadge');

    clearBtn.addEventListener('click', function() {
        allLogs = [];
        vscode.postMessage({ command: 'clearLogs' });
        render();
    });

    exportBtn.addEventListener('click', function() {
        var filtered = getFilteredLogs();
        vscode.postMessage({ command: 'exportLogs', filteredLogs: filtered });
    });

    scrollBtn.addEventListener('click', function() {
        autoScroll = !autoScroll;
        scrollBtn.className = autoScroll ? 'active' : '';
        if (autoScroll) container.scrollTop = container.scrollHeight;
    });

    searchInput.addEventListener('input', function() {
        searchText = this.value;
        render();
    });

    var catChips = document.querySelectorAll('.filter-chip[data-cat]');
    for (var i = 0; i < catChips.length; i++) {
        catChips[i].addEventListener('click', function() {
            var cat = this.getAttribute('data-cat');
            activeCategories[cat] = !activeCategories[cat];
            this.className = 'filter-chip' + (activeCategories[cat] ? ' active' : '');
            render();
        });
    }
    var lvlChips = document.querySelectorAll('.filter-chip[data-lvl]');
    for (var j = 0; j < lvlChips.length; j++) {
        lvlChips[j].addEventListener('click', function() {
            var lvl = this.getAttribute('data-lvl');
            activeLevels[lvl] = !activeLevels[lvl];
            this.className = 'filter-chip' + (activeLevels[lvl] ? ' active' : '');
            render();
        });
    }

    function matchSearch(msg) {
        if (!searchText) return true;
        var text = String(msg || '');
        if (searchText.startsWith('/') && searchText.endsWith('/') && searchText.length > 2) {
            try { return new RegExp(searchText.slice(1, -1), 'i').test(text); } catch(e) { return false; }
        }
        return text.toLowerCase().indexOf(searchText.toLowerCase()) !== -1;
    }

    function getFilteredLogs() {
        var out = [];
        for (var i = 0; i < allLogs.length; i++) {
            var e = allLogs[i];
            if (!activeCategories[e.category]) continue;
            if (!activeLevels[e.level]) continue;
            var searchable = String(e.message || '') + ' ' + String(e.category || '') + ' ' + String(e.level || '') + ' ' + String(e.source || '');
            if (!matchSearch(searchable)) continue;
            out.push(e);
        }
        return out;
    }

    function formatTime(ts) {
        var d = new Date(ts);
        var h = String(d.getHours()).padStart(2, '0');
        var m = String(d.getMinutes()).padStart(2, '0');
        var s = String(d.getSeconds()).padStart(2, '0');
        var ms = String(d.getMilliseconds()).padStart(3, '0');
        return h + ':' + m + ':' + s + '.' + ms;
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    function buildLogRow(e) {
        return '<div class="log-entry">'
            + '<span class="log-ts">' + formatTime(e.timestamp) + '</span>'
            + '<span class="log-cat log-cat-' + e.category + '">' + e.category + '</span>'
            + '<span class="log-lvl log-lvl-' + e.level + '">' + e.level + '</span>'
            + '<span class="log-msg">' + esc(e.message) + '</span>'
            + '</div>';
    }

    function render() {
        var filtered = getFilteredLogs();
        countBadge.textContent = filtered.length + (filtered.length < allLogs.length ? '/' + allLogs.length : '');
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty">No logs matching filters</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            html += buildLogRow(filtered[i]);
        }
        container.innerHTML = html;
        if (autoScroll) container.scrollTop = container.scrollHeight;
    }

    function appendSingle(e) {
        if (!activeCategories[e.category]) return;
        if (!activeLevels[e.level]) return;
        var searchable = String(e.message || '') + ' ' + String(e.category || '') + ' ' + String(e.level || '') + ' ' + String(e.source || '');
        if (!matchSearch(searchable)) return;
        var div = document.createElement('div');
        div.innerHTML = buildLogRow(e);
        container.appendChild(div.firstChild);
        var filtered = getFilteredLogs();
        countBadge.textContent = filtered.length + (filtered.length < allLogs.length ? '/' + allLogs.length : '');
        if (autoScroll) container.scrollTop = container.scrollHeight;
    }

    window.addEventListener('message', function(ev) {
        var msg = ev.data;
        switch (msg.command) {
            case 'newLog':
                allLogs.push(msg.entry);
                if (allLogs.length > 5000) allLogs = allLogs.slice(-5000);
                appendSingle(msg.entry);
                break;
            case 'allLogs':
                allLogs = msg.logs || [];
                render();
                break;
            case 'logsCleared':
                allLogs = [];
                render();
                break;
        }
    });

    vscode.postMessage({ command: 'requestAllLogs' });
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
