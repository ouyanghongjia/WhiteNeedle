import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

export class SQLitePanel {
    public static currentPanel: SQLitePanel | undefined;
    private static readonly viewType = 'whiteneedle.sqlitePanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        outputChannel?: vscode.OutputChannel
    ): SQLitePanel {
        const column = vscode.ViewColumn.One;

        if (SQLitePanel.currentPanel) {
            SQLitePanel.currentPanel.panel.reveal(column);
            return SQLitePanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            SQLitePanel.viewType,
            'SQLite Browser',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const ch = outputChannel ?? vscode.window.createOutputChannel('WhiteNeedle');
        SQLitePanel.currentPanel = new SQLitePanel(panel, deviceManager, ch);
        return SQLitePanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        deviceManager: DeviceManager,
        outputChannel: vscode.OutputChannel
    ) {
        this.panel = panel;
        this.deviceManager = deviceManager;
        this.outputChannel = outputChannel;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        bindConnectionState(this.panel, this.deviceManager, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                this.outputChannel.appendLine(`[SQLitePanel] Received: ${msg.command}`);
                try {
                    switch (msg.command) {
                        case 'discoverDatabases':
                            await this.discoverDatabases();
                            break;
                        case 'loadTables':
                            await this.loadTables(msg.dbPath);
                            break;
                        case 'loadSchema':
                            await this.loadSchema(msg.dbPath, msg.tableName);
                            break;
                        case 'loadTableData':
                            await this.loadTableData(msg.dbPath, msg.tableName, msg.limit);
                            break;
                        case 'executeQuery':
                            await this.executeQuery(msg.dbPath, msg.sql, msg.limit);
                            break;
                        case 'takeSnapshot':
                            await this.takeSnapshot(msg.dbPath, msg.tableName, msg.tag);
                            break;
                        case 'diffSnapshot':
                            await this.diffSnapshot(msg.dbPath, msg.tableName, msg.tag);
                            break;
                    }
                } catch (err: any) {
                    this.outputChannel.appendLine(`[SQLitePanel] Unhandled error: ${err.message}`);
                    this.postMessage({ command: 'error', text: err.message });
                }
            },
            null,
            this.disposables
        );

        this.panel.webview.html = this.getHtml();
    }

    private async discoverDatabases(): Promise<void> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        try {
            this.outputChannel.appendLine('[SQLitePanel] Evaluating SQLite.databases()...');
            const raw = await this.deviceManager.evaluate('JSON.stringify(SQLite.databases())') as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const databases = JSON.parse(parsed);
            this.outputChannel.appendLine(`[SQLitePanel] Found ${databases.length} databases`);
            this.postMessage({ command: 'databasesLoaded', databases });
        } catch (err: any) {
            this.outputChannel.appendLine(`[SQLitePanel] Error: ${err.message}`);
            this.postMessage({ command: 'error', text: `Failed to discover databases: ${err.message}` });
        }
    }

    private async loadTables(dbPath: string): Promise<void> {
        try {
            const escapedPath = dbPath.replace(/'/g, "\\'");
            const raw = await this.deviceManager.evaluate(`JSON.stringify(SQLite.tables('${escapedPath}'))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const tables = JSON.parse(parsed);
            this.postMessage({ command: 'tablesLoaded', dbPath, tables });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load tables: ${err.message}` });
        }
    }

    private async loadSchema(dbPath: string, tableName: string): Promise<void> {
        try {
            const ep = dbPath.replace(/'/g, "\\'");
            const et = tableName.replace(/'/g, "\\'");
            const raw = await this.deviceManager.evaluate(`JSON.stringify(SQLite.schema('${ep}', '${et}'))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const schema = JSON.parse(parsed);
            this.postMessage({ command: 'schemaLoaded', dbPath, tableName, schema });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load schema: ${err.message}` });
        }
    }

    private async loadTableData(dbPath: string, tableName: string, limit: number = 100): Promise<void> {
        try {
            const ep = dbPath.replace(/'/g, "\\'");
            const et = tableName.replace(/"/g, '""');
            const sql = `SELECT * FROM "${et}" LIMIT ${limit}`;
            const raw = await this.deviceManager.evaluate(`JSON.stringify(SQLite.query('${ep}', '${sql.replace(/'/g, "\\'")}', ${limit}))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const result = JSON.parse(parsed);
            this.postMessage({ command: 'tableDataLoaded', dbPath, tableName, result });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load data: ${err.message}` });
        }
    }

    private async executeQuery(dbPath: string, sql: string, limit: number = 500): Promise<void> {
        try {
            const ep = dbPath.replace(/'/g, "\\'");
            const es = sql.replace(/'/g, "\\'");
            const isSelect = sql.trim().toUpperCase().startsWith('SELECT') ||
                             sql.trim().toUpperCase().startsWith('PRAGMA');
            const apiCall = isSelect
                ? `SQLite.query('${ep}', '${es}', ${limit})`
                : `SQLite.execute('${ep}', '${es}')`;
            const raw = await this.deviceManager.evaluate(`JSON.stringify(${apiCall})`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const result = JSON.parse(parsed);
            this.postMessage({ command: 'queryResult', dbPath, sql, result, isSelect });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Query failed: ${err.message}` });
        }
    }

    private async takeSnapshot(dbPath: string, tableName: string, tag: string): Promise<void> {
        try {
            const ep = dbPath.replace(/'/g, "\\'");
            const et = tableName.replace(/'/g, "\\'");
            const eTag = tag.replace(/'/g, "\\'");
            const raw = await this.deviceManager.evaluate(`JSON.stringify(SQLite.snapshot('${ep}', '${et}', '${eTag}'))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const result = JSON.parse(parsed);
            this.postMessage({ command: 'snapshotTaken', dbPath, tableName, tag, result });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Snapshot failed: ${err.message}` });
        }
    }

    private async diffSnapshot(dbPath: string, tableName: string, tag: string): Promise<void> {
        try {
            const ep = dbPath.replace(/'/g, "\\'");
            const et = tableName.replace(/'/g, "\\'");
            const eTag = tag.replace(/'/g, "\\'");
            const raw = await this.deviceManager.evaluate(`JSON.stringify(SQLite.diff('${ep}', '${et}', '${eTag}'))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const result = JSON.parse(parsed);
            this.postMessage({ command: 'diffResult', dbPath, tableName, tag, result });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Diff failed: ${err.message}` });
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        SQLitePanel.currentPanel = undefined;
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
<title>SQLite Browser</title>
<style>
    :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --border: var(--vscode-panel-border, var(--vscode-widget-border, #444));
        --btn-bg: var(--vscode-button-background);
        --btn-fg: var(--vscode-button-foreground);
        --btn-hover: var(--vscode-button-hoverBackground);
        --badge-bg: var(--vscode-badge-background);
        --badge-fg: var(--vscode-badge-foreground);
        --list-hover: var(--vscode-list-hoverBackground);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, var(--border));
        --error-fg: var(--vscode-errorForeground, #f44);
        --success: #4caf50;
        --warning: #ff9800;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); padding: 12px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
    button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
    button:hover { background: var(--btn-hover); }
    button:disabled { opacity: 0.5; cursor: default; }
    button.small { padding: 2px 8px; font-size: 11px; }
    button.success { background: var(--success); }
    button.warning { background: var(--warning); color: #000; }
    button.danger { background: var(--error-fg); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--border); font-weight: 600; position: sticky; top: 0; background: var(--bg); }
    td { padding: 4px 8px; border-bottom: 1px solid var(--border); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
    td.null-val { opacity: 0.4; font-style: italic; }
    tr:hover td { background: var(--list-hover); }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 11px; background: var(--badge-bg); color: var(--badge-fg); }
    .badge.green { background: var(--success); color: #fff; }
    .badge.orange { background: var(--warning); color: #000; }
    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .db-section { margin-bottom: 4px; }
    .db-header { display: flex; align-items: center; gap: 8px; padding: 8px 4px; cursor: pointer; border-bottom: 1px solid var(--border); user-select: none; }
    .db-header:hover { background: var(--list-hover); }
    .table-item { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 24px; cursor: pointer; border-bottom: 1px solid var(--border); user-select: none; }
    .table-item:hover { background: var(--list-hover); }
    .table-item.active { background: var(--list-hover); font-weight: 600; }
    .arrow { transition: transform 0.15s; display: inline-block; }
    .arrow.open { transform: rotate(90deg); }
    .detail-area { margin-top: 12px; }
    .tab-bar { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 8px; }
    .tab { padding: 6px 14px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; font-size: 12px; }
    .tab:hover { background: var(--list-hover); }
    .tab.active { border-bottom-color: var(--btn-bg); font-weight: 600; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .query-area { margin-bottom: 8px; }
    .query-area textarea { width: 100%; height: 60px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; padding: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; resize: vertical; }
    .query-toolbar { display: flex; gap: 8px; margin-top: 4px; align-items: center; }
    .data-scroll { max-height: 400px; overflow: auto; border: 1px solid var(--border); border-radius: 3px; }
    .diff-section { margin-top: 8px; }
    .diff-added { background: rgba(76, 175, 80, 0.15); }
    .diff-removed { background: rgba(244, 67, 54, 0.15); text-decoration: line-through; }
    .snapshot-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .snapshot-bar input { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; padding: 4px 8px; font-size: 12px; width: 150px; }
    #status { margin-left: 8px; font-size: 12px; opacity: 0.7; }
    .toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg); z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .toast.error { background: var(--error-fg); }
    .size-label { font-size: 11px; opacity: 0.6; }
${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}
<div class="toolbar">
    <button id="discoverBtn">Discover Databases</button>
    <span id="status"></span>
</div>
<div id="sidebar"></div>
<div id="detail" class="detail-area"></div>
<div class="toast" id="toast"></div>

<script nonce="${nonce}">
${OVERLAY_JS}
(function() {
    var vscode = acquireVsCodeApi();
    var databases = [];
    var openDbs = {};
    var tableCache = {};
    var selectedDb = null;
    var selectedTable = null;
    var schemaCache = {};
    var dataCache = {};
    var queryResults = {};
    var snapshots = {};

    var discoverBtn = document.getElementById('discoverBtn');
    var statusEl = document.getElementById('status');
    var sidebarEl = document.getElementById('sidebar');
    var detailEl = document.getElementById('detail');
    var toastEl = document.getElementById('toast');

    discoverBtn.addEventListener('click', function() {
        discoverBtn.disabled = true;
        statusEl.textContent = 'Scanning...';
        vscode.postMessage({ command: 'discoverDatabases' });
    });

    function renderSidebar() {
        if (databases.length === 0) {
            sidebarEl.innerHTML = '<div class="empty">Click "Discover Databases" to scan sandbox</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < databases.length; i++) {
            var db = databases[i];
            var isOpen = !!openDbs[db.path];
            html += '<div class="db-section">';
            html += '<div class="db-header" data-db-idx="' + i + '">';
            html += '<span class="arrow ' + (isOpen ? 'open' : '') + '">&#9654;</span>';
            html += '<strong>' + esc(db.name) + '</strong>';
            html += ' <span class="badge">' + db.tableCount + ' tables</span>';
            html += ' <span class="size-label">' + formatSize(db.size) + '</span>';
            html += '</div>';
            if (isOpen) {
                var tables = tableCache[db.path];
                if (!tables) {
                    html += '<div style="padding:12px 24px;opacity:0.5">Loading tables...</div>';
                } else {
                    for (var j = 0; j < tables.length; j++) {
                        var t = tables[j];
                        var isActive = selectedDb === db.path && selectedTable === t.name;
                        html += '<div class="table-item' + (isActive ? ' active' : '') + '" data-db="' + esc(db.path) + '" data-table="' + esc(t.name) + '">';
                        html += '&#128202; ' + esc(t.name);
                        html += ' <span class="badge">' + t.rowCount + ' rows</span>';
                        html += '</div>';
                    }
                }
            }
            html += '</div>';
        }
        sidebarEl.innerHTML = html;
        bindSidebarClicks();
    }

    function bindSidebarClicks() {
        var headers = sidebarEl.querySelectorAll('.db-header');
        for (var i = 0; i < headers.length; i++) {
            headers[i].addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-db-idx'), 10);
                var db = databases[idx];
                if (!db) return;
                openDbs[db.path] = !openDbs[db.path];
                if (openDbs[db.path] && !tableCache[db.path]) {
                    vscode.postMessage({ command: 'loadTables', dbPath: db.path });
                }
                renderSidebar();
            });
        }
        var items = sidebarEl.querySelectorAll('.table-item');
        for (var j = 0; j < items.length; j++) {
            items[j].addEventListener('click', function() {
                var dbPath = this.getAttribute('data-db');
                var tableName = this.getAttribute('data-table');
                selectTable(dbPath, tableName);
            });
        }
    }

    function selectTable(dbPath, tableName) {
        selectedDb = dbPath;
        selectedTable = tableName;
        renderSidebar();
        renderDetail();
        var key = dbPath + '::' + tableName;
        if (!schemaCache[key]) {
            vscode.postMessage({ command: 'loadSchema', dbPath: dbPath, tableName: tableName });
        }
        if (!dataCache[key]) {
            vscode.postMessage({ command: 'loadTableData', dbPath: dbPath, tableName: tableName, limit: 100 });
        }
    }

    function renderDetail() {
        if (!selectedDb || !selectedTable) {
            detailEl.innerHTML = '<div class="empty">Select a table from the sidebar</div>';
            return;
        }

        var key = selectedDb + '::' + selectedTable;
        var activeTab = (detailEl._activeTab && detailEl._activeTab[key]) || 'data';

        var html = '<h3 style="margin-bottom:8px">' + esc(selectedTable) + ' <span class="size-label">in ' + esc(selectedDb) + '</span></h3>';
        html += '<div class="tab-bar">';
        html += '<div class="tab' + (activeTab === 'data' ? ' active' : '') + '" data-tab="data">Data</div>';
        html += '<div class="tab' + (activeTab === 'schema' ? ' active' : '') + '" data-tab="schema">Schema</div>';
        html += '<div class="tab' + (activeTab === 'query' ? ' active' : '') + '" data-tab="query">Query</div>';
        html += '<div class="tab' + (activeTab === 'monitor' ? ' active' : '') + '" data-tab="monitor">Monitor</div>';
        html += '</div>';

        // Data tab
        html += '<div class="tab-content' + (activeTab === 'data' ? ' active' : '') + '" data-tab-content="data">';
        var data = dataCache[key];
        if (!data) {
            html += '<div style="padding:12px;opacity:0.5">Loading...</div>';
        } else if (data.error) {
            html += '<div style="padding:12px;color:var(--error-fg)">' + esc(data.error) + '</div>';
        } else {
            html += '<div style="margin-bottom:4px;font-size:11px;opacity:0.6">' + data.rowCount + ' rows' + (data.truncated ? ' (truncated)' : '') + '</div>';
            html += '<div class="data-scroll">' + buildDataTable(data.rows) + '</div>';
        }
        html += '</div>';

        // Schema tab
        html += '<div class="tab-content' + (activeTab === 'schema' ? ' active' : '') + '" data-tab-content="schema">';
        var schema = schemaCache[key];
        if (!schema) {
            html += '<div style="padding:12px;opacity:0.5">Loading...</div>';
        } else {
            html += '<table><tr><th>#</th><th>Name</th><th>Type</th><th>NotNull</th><th>Default</th><th>PK</th></tr>';
            for (var s = 0; s < schema.length; s++) {
                var col = schema[s];
                html += '<tr>';
                html += '<td>' + col.cid + '</td>';
                html += '<td><strong>' + esc(col.name) + '</strong></td>';
                html += '<td>' + esc(col.type || 'ANY') + '</td>';
                html += '<td>' + (col.notnull ? '&#10003;' : '') + '</td>';
                html += '<td>' + (col.dflt_value != null ? esc(String(col.dflt_value)) : '<span style="opacity:0.4">NULL</span>') + '</td>';
                html += '<td>' + (col.pk ? '&#128273;' : '') + '</td>';
                html += '</tr>';
            }
            html += '</table>';
        }
        html += '</div>';

        // Query tab
        html += '<div class="tab-content' + (activeTab === 'query' ? ' active' : '') + '" data-tab-content="query">';
        html += '<div class="query-area">';
        html += '<textarea id="sqlInput" placeholder="SELECT * FROM ' + esc(selectedTable) + ' WHERE ...">' + (queryResults[key + '::lastSql'] || 'SELECT * FROM "' + selectedTable.replace(/"/g, '""') + '" LIMIT 50') + '</textarea>';
        html += '<div class="query-toolbar">';
        html += '<button id="runQueryBtn">Run Query</button>';
        html += '<span id="queryStatus" style="font-size:11px;opacity:0.6"></span>';
        html += '</div></div>';
        var qr = queryResults[key];
        if (qr) {
            if (qr.error) {
                html += '<div style="padding:8px;color:var(--error-fg)">' + esc(qr.error) + '</div>';
            } else if (qr.rows) {
                html += '<div style="margin-bottom:4px;font-size:11px;opacity:0.6">' + qr.rowCount + ' rows' + (qr.truncated ? ' (truncated)' : '') + '</div>';
                html += '<div class="data-scroll">' + buildDataTable(qr.rows) + '</div>';
            } else if (qr.ok !== undefined) {
                html += '<div style="padding:8px;color:var(--success)">' + qr.changes + ' rows affected</div>';
            }
        }
        html += '</div>';

        // Monitor tab
        html += '<div class="tab-content' + (activeTab === 'monitor' ? ' active' : '') + '" data-tab-content="monitor">';
        html += '<div class="snapshot-bar">';
        html += '<input id="snapTag" placeholder="snapshot tag" value="' + (snapshots[key + '::lastTag'] || 'before') + '" />';
        html += '<button id="snapBtn" class="success small">Take Snapshot</button>';
        html += '<button id="diffBtn" class="warning small">Diff vs Snapshot</button>';
        html += '</div>';
        var snap = snapshots[key + '::snap'];
        if (snap) {
            html += '<div style="font-size:11px;opacity:0.6;margin-bottom:4px">Snapshot "' + esc(snap.tag) + '": ' + snap.result.rowCount + ' rows at ' + new Date(snap.result.timestamp || Date.now()).toLocaleTimeString() + '</div>';
        }
        var diff = snapshots[key + '::diff'];
        if (diff) {
            if (diff.error) {
                html += '<div style="color:var(--error-fg)">' + esc(diff.error) + '</div>';
            } else {
                html += '<div style="margin-bottom:6px">';
                html += '<span class="badge">' + diff.oldRowCount + ' → ' + diff.newRowCount + '</span> ';
                if (diff.hasChanges) {
                    html += '<span class="badge green">+' + diff.addedCount + '</span> ';
                    html += '<span class="badge orange">-' + diff.removedCount + '</span>';
                } else {
                    html += '<span style="opacity:0.6">No changes</span>';
                }
                html += '</div>';
                if (diff.added && diff.added.length > 0) {
                    html += '<div style="margin-bottom:4px;font-size:11px;font-weight:600;color:var(--success)">Added rows:</div>';
                    html += '<div class="data-scroll">' + buildDataTable(diff.added, 'diff-added') + '</div>';
                }
                if (diff.removed && diff.removed.length > 0) {
                    html += '<div style="margin:8px 0 4px;font-size:11px;font-weight:600;color:var(--error-fg)">Removed rows:</div>';
                    html += '<div class="data-scroll">' + buildDataTable(diff.removed, 'diff-removed') + '</div>';
                }
            }
        }
        html += '</div>';

        detailEl.innerHTML = html;
        bindDetailEvents(key);
    }

    function bindDetailEvents(key) {
        var tabs = detailEl.querySelectorAll('.tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function() {
                var tab = this.getAttribute('data-tab');
                if (!detailEl._activeTab) detailEl._activeTab = {};
                detailEl._activeTab[key] = tab;
                renderDetail();
            });
        }

        var runBtn = document.getElementById('runQueryBtn');
        var sqlInput = document.getElementById('sqlInput');
        if (runBtn && sqlInput) {
            runBtn.addEventListener('click', function() {
                var sql = sqlInput.value.trim();
                if (!sql) return;
                queryResults[key + '::lastSql'] = sql;
                var qs = document.getElementById('queryStatus');
                if (qs) qs.textContent = 'Executing...';
                vscode.postMessage({ command: 'executeQuery', dbPath: selectedDb, sql: sql, limit: 500 });
            });
        }

        var snapBtn = document.getElementById('snapBtn');
        var diffBtn = document.getElementById('diffBtn');
        var snapTag = document.getElementById('snapTag');
        if (snapBtn && snapTag) {
            snapBtn.addEventListener('click', function() {
                var tag = snapTag.value.trim() || 'default';
                snapshots[key + '::lastTag'] = tag;
                vscode.postMessage({ command: 'takeSnapshot', dbPath: selectedDb, tableName: selectedTable, tag: tag });
            });
        }
        if (diffBtn && snapTag) {
            diffBtn.addEventListener('click', function() {
                var tag = snapTag.value.trim() || 'default';
                snapshots[key + '::lastTag'] = tag;
                vscode.postMessage({ command: 'diffSnapshot', dbPath: selectedDb, tableName: selectedTable, tag: tag });
            });
        }
    }

    function buildDataTable(rows, rowClass) {
        if (!rows || rows.length === 0) return '<div style="padding:8px;opacity:0.5">No data</div>';
        var cols = Object.keys(rows[0]);
        var html = '<table><tr>';
        for (var c = 0; c < cols.length; c++) {
            html += '<th>' + esc(cols[c]) + '</th>';
        }
        html += '</tr>';
        for (var r = 0; r < rows.length; r++) {
            html += '<tr' + (rowClass ? ' class="' + rowClass + '"' : '') + '>';
            for (var ci = 0; ci < cols.length; ci++) {
                var val = rows[r][cols[ci]];
                if (val === null || val === undefined) {
                    html += '<td class="null-val">NULL</td>';
                } else {
                    var s = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    html += '<td title="' + esc(s) + '">' + esc(trunc(s, 60)) + '</td>';
                }
            }
            html += '</tr>';
        }
        html += '</table>';
        return html;
    }

    window.addEventListener('message', function(e) {
        var msg = e.data;
        switch (msg.command) {
            case 'databasesLoaded':
                discoverBtn.disabled = false;
                statusEl.textContent = '';
                databases = msg.databases || [];
                openDbs = {};
                tableCache = {};
                renderSidebar();
                showToast(databases.length + ' databases found');
                break;
            case 'tablesLoaded':
                tableCache[msg.dbPath] = msg.tables || [];
                renderSidebar();
                break;
            case 'schemaLoaded':
                schemaCache[msg.dbPath + '::' + msg.tableName] = msg.schema;
                if (msg.dbPath === selectedDb && msg.tableName === selectedTable) renderDetail();
                break;
            case 'tableDataLoaded':
                dataCache[msg.dbPath + '::' + msg.tableName] = msg.result;
                if (msg.dbPath === selectedDb && msg.tableName === selectedTable) renderDetail();
                break;
            case 'queryResult':
                var qKey = msg.dbPath + '::' + (selectedTable || '');
                queryResults[qKey] = msg.result;
                renderDetail();
                break;
            case 'snapshotTaken':
                var sKey = msg.dbPath + '::' + msg.tableName;
                snapshots[sKey + '::snap'] = { tag: msg.tag, result: msg.result };
                showToast('Snapshot "' + msg.tag + '" saved (' + msg.result.rowCount + ' rows)');
                renderDetail();
                break;
            case 'diffResult':
                var dKey = msg.dbPath + '::' + msg.tableName;
                snapshots[dKey + '::diff'] = msg.result;
                if (msg.result.hasChanges) {
                    showToast('Changes detected: +' + msg.result.addedCount + ' / -' + msg.result.removedCount);
                } else {
                    showToast('No changes detected');
                }
                renderDetail();
                break;
            case 'error':
                discoverBtn.disabled = false;
                statusEl.textContent = '';
                showToast(msg.text, true);
                break;
        }
    });

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function trunc(s, n) { return s && s.length > n ? s.substring(0, n) + '\\u2026' : (s || ''); }
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function showToast(text, isError) {
        toastEl.textContent = text;
        toastEl.className = 'toast show' + (isError ? ' error' : '');
        setTimeout(function() { toastEl.className = 'toast'; }, 3000);
    }
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
