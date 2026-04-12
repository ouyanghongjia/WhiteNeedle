import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

/** TODO: set false and remove dbg / debugLog / __WN_SQLITE_DEBUG paths after troubleshooting. */
const SQLITE_PANEL_DEBUG = true;

export class SQLitePanel {
    public static currentPanel: SQLitePanel | undefined;
    private static readonly viewType = 'whiteneedle.sqlitePanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        outputChannel?: vscode.OutputChannel
    ): SQLitePanel {
        const column = vscode.ViewColumn.One;

        if (SQLitePanel.currentPanel) {
            SQLitePanel.currentPanel.panel.reveal(column);
            // retainContextWhenHidden can leave a stale DOM if html was never reset; force latest script + handlers.
            SQLitePanel.currentPanel.applyWebviewHtml();
            return SQLitePanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            SQLitePanel.viewType,
            'SQLite Browser',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );

        const ch = outputChannel ?? vscode.window.createOutputChannel('WhiteNeedle');
        SQLitePanel.currentPanel = new SQLitePanel(panel, deviceManager, ch, extensionUri);
        return SQLitePanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        deviceManager: DeviceManager,
        outputChannel: vscode.OutputChannel,
        extensionUri: vscode.Uri
    ) {
        this.panel = panel;
        this.deviceManager = deviceManager;
        this.outputChannel = outputChannel;
        this.extensionUri = extensionUri;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg.command === 'debugLog') {
                    if (SQLITE_PANEL_DEBUG) {
                        const p = (msg as { payload?: unknown }).payload;
                        const line =
                            p !== undefined && p !== null && typeof p === 'object' && 'message' in (p as object)
                                ? String((p as { message?: string }).message)
                                : JSON.stringify(p ?? msg);
                        this.outputChannel.appendLine(`[SQLitePanel][DEBUG] webview: ${line}`);
                        this.outputChannel.show(true);
                    }
                    return;
                }
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

        this.applyWebviewHtml();
        bindConnectionState(this.panel, this.deviceManager, this.disposables);
    }

    /** Assign webview HTML and (in debug) ping the webview to verify the script runs. */
    public applyWebviewHtml(): void {
        this.panel.webview.html = this.getHtml();
        try {
            void this.panel.webview.postMessage({ command: 'connectionState', state: this.deviceManager.state });
        } catch {
            /* panel disposed */
        }
        if (SQLITE_PANEL_DEBUG) {
            this.outputChannel.appendLine(
                `[SQLitePanel][DEBUG] panel html set; isConnected=${this.deviceManager.isConnected} state=${this.deviceManager.state}`
            );
            this.outputChannel.show(true);
            setTimeout(() => {
                void this.panel.webview.postMessage({ command: 'hostPing', t: Date.now() });
                this.outputChannel.appendLine('[SQLitePanel][DEBUG] postMessage hostPing sent (expect webview: hostPing ok)');
                this.outputChannel.show(true);
            }, 80);
        }
    }

    private dbg(...parts: unknown[]): void {
        if (!SQLITE_PANEL_DEBUG) {
            return;
        }
        this.outputChannel.appendLine(`[SQLitePanel][DEBUG] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`);
    }

    private async discoverDatabases(): Promise<void> {
        this.dbg(
            'discoverDatabases: enter isConnected=',
            this.deviceManager.isConnected,
            'state=',
            this.deviceManager.state
        );
        if (!this.deviceManager.isConnected) {
            const msg =
                'WhiteNeedle 未连接设备：请求未发送到 App。请先在侧栏连接设备（状态为已连接）后再试。日志在「输出」面板选择渠道 WhiteNeedle，而非集成终端。';
            this.outputChannel.appendLine('[SQLitePanel] discoverDatabases: skipped (device not connected)');
            this.outputChannel.show(true);
            void vscode.window.showWarningMessage(msg);
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        try {
            this.outputChannel.appendLine('[SQLitePanel] Evaluating SQLite.databases()...');
            this.outputChannel.show(true);
            const evalCode =
                "(function(){try{" +
                "if(typeof SQLite==='undefined')return JSON.stringify({__wnError:'SQLite API not available on device (reload app with latest WhiteNeedle).'});" +
                "return JSON.stringify(SQLite.databases());" +
                "}catch(e){return JSON.stringify({__wnError:String(e&&e.message?e.message:e)});}" +
                "})()";
            const raw = await this.deviceManager.evaluate(evalCode) as any;
            this.dbg(
                'discoverDatabases: evaluate raw keys=',
                raw && typeof raw === 'object' ? Object.keys(raw as object).join(',') : typeof raw,
                'valueLen=',
                typeof (raw as any)?.value === 'string' ? (raw as any).value.length : 'n/a'
            );
            const databases = this.parseEvaluateJsonArray(raw, 'databases');
            this.outputChannel.appendLine(`[SQLitePanel] Found ${databases.length} databases`);
            this.postMessage({ command: 'databasesLoaded', databases });
        } catch (err: any) {
            this.outputChannel.appendLine(`[SQLitePanel] Error: ${err.message}`);
            this.postMessage({ command: 'error', text: `Failed to discover databases: ${err.message}` });
        }
    }

    /** Unwrap JSON-RPC evaluate result and parse JSON; surface device-side __wnError. */
    private parseEvaluateJson(raw: unknown): any {
        const payload = typeof raw === 'string' ? raw : (raw as any)?.value;
        if (payload === undefined || payload === null) {
            throw new Error('Empty result from device');
        }
        const str = typeof payload === 'string' ? payload : String(payload);
        let data: any;
        try {
            data = JSON.parse(str);
        } catch {
            throw new Error(`Device did not return JSON (got: ${str.slice(0, 180)}…)`);
        }
        if (data && typeof data === 'object' && data.__wnError) {
            throw new Error(String(data.__wnError));
        }
        return data;
    }

    private parseEvaluateJsonArray(raw: unknown, label: string): any[] {
        const data = this.parseEvaluateJson(raw);
        if (!Array.isArray(data)) {
            throw new Error(`Expected JSON array for ${label}`);
        }
        return data;
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
            const sql = `SELECT * FROM ${quoteSqlIdent(tableName)} LIMIT ${limit}`;
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
            const isSelect = isSqlReadQuery(sql);
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
        const mainScriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'sqlitePanelMain.js')
        );
        const csp = this.panel.webview.cspSource;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${csp}; script-src 'nonce-${nonce}' ${csp};">
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
    /* Above wn-offline-overlay (z-index 9999) so Discover still posts to extension when offline; user then gets a clear "not connected" message. */
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; position: relative; z-index: 10001; background: var(--bg); padding-bottom: 2px; }
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
    .query-area { margin-bottom: 8px; position: relative; }
    .query-area textarea { width: 100%; height: 80px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; padding: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; resize: vertical; }
    .query-hint { font-size: 11px; opacity: 0.45; margin: 2px 0 0; }
    .sql-suggest { display: none; position: absolute; left: 6px; right: 6px; max-height: 200px; overflow-y: auto; background: var(--vscode-editorSuggestWidget-background, var(--vscode-dropdown-background, var(--input-bg))); border: 1px solid var(--vscode-editorSuggestWidget-border, var(--input-border)); border-radius: 3px; z-index: 50; box-shadow: 0 4px 12px rgba(0,0,0,0.3); padding: 2px 0; }
    .sql-suggest.show { display: block; }
    .sg-opt { padding: 3px 8px; cursor: pointer; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 2px; margin: 0 2px; }
    .sg-opt:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); }
    .sg-opt.active { background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground, #094771)); color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground, #fff)); }
    .sg-opt b { font-weight: 700; }
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
    window.__WN_SQLITE_VSCODE = vscode;
    var __WN_SQLITE_DEBUG = ${SQLITE_PANEL_DEBUG ? 'true' : 'false'};
    function wnDbg(msg) {
        if (!__WN_SQLITE_DEBUG) return;
        try {
            vscode.postMessage({ command: 'debugLog', payload: { message: String(msg), t: Date.now() } });
        } catch (e) {}
    }
    window.__WN_SQLITE_WNDBG = wnDbg;
    wnDbg('webview: script boot (shell)');
    window.addEventListener('message', function(ev) {
        var d = ev.data;
        if (!d) return;
        if (d.command === 'hostPing') {
            wnDbg('webview: hostPing ok');
            return;
        }
        if (d.command === 'connectionState') {
            wnDbg('webview: connectionState=' + d.state);
            return;
        }
        if (typeof window.__WN_SQLITE_MAIN_MSG === 'function') {
            try {
                window.__WN_SQLITE_MAIN_MSG(ev);
            } catch (ex) {
                wnDbg('webview: main handler threw ' + (ex && ex.message ? ex.message : String(ex)));
                if (d.command === 'databasesLoaded' || d.command === 'error') {
                    var rb = document.getElementById('discoverBtn');
                    var rs = document.getElementById('status');
                    if (rb) rb.disabled = false;
                    if (rs) rs.textContent = '';
                }
            }
            return;
        }
        if (d.command === 'databasesLoaded' || d.command === 'error') {
            var rb2 = document.getElementById('discoverBtn');
            var rs2 = document.getElementById('status');
            if (rb2) rb2.disabled = false;
            if (rs2) rs2.textContent = '';
            wnDbg('webview: discover reset (fallback, main script not ready)');
        }
    });
    var discoverShell = document.getElementById('discoverBtn');
    var statusShell = document.getElementById('status');
    if (!discoverShell) {
        wnDbg('webview: discoverBtn missing (shell)');
    } else {
        wnDbg('webview: discoverBtn bound (shell)');
        discoverShell.addEventListener('click', function() {
            discoverShell.disabled = true;
            if (statusShell) statusShell.textContent = 'Scanning...';
            vscode.postMessage({ command: 'discoverDatabases' });
            wnDbg('webview: discoverDatabases postMessage (shell)');
        });
    }
})();
</script>
<script nonce="${nonce}" src="${mainScriptUri}"></script>
</body>
</html>`;
    }
}

/** SQLite identifier: quote only when needed (spaces, reserved words, special chars). */
function quoteSqlIdent(name: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return name;
    }
    return `"${name.replace(/"/g, '""')}"`;
}

/** Use query() for reads; execute() for DML/DDL and PRAGMA assignments. */
function isSqlReadQuery(sql: string): boolean {
    const u = sql.trim().toUpperCase();
    if (/^PRAGMA\s+\w+\s*=/.test(u)) {
        return false;
    }
    if (u.startsWith('PRAGMA')) {
        return true;
    }
    if (u.startsWith('SELECT') || u.startsWith('WITH')) {
        return true;
    }
    if (/^EXPLAIN(\s+QUERY\s+PLAN|\s+)/.test(u)) {
        return true;
    }
    return false;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
