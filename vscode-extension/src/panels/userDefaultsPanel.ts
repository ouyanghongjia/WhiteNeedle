import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

export class UserDefaultsPanel {
    public static currentPanel: UserDefaultsPanel | undefined;
    private static readonly viewType = 'whiteneedle.userDefaultsPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        outputChannel?: vscode.OutputChannel
    ): UserDefaultsPanel {
        const column = vscode.ViewColumn.One;

        if (UserDefaultsPanel.currentPanel) {
            UserDefaultsPanel.currentPanel.panel.reveal(column);
            return UserDefaultsPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            UserDefaultsPanel.viewType,
            'UserDefaults',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const ch = outputChannel ?? vscode.window.createOutputChannel('WhiteNeedle');
        UserDefaultsPanel.currentPanel = new UserDefaultsPanel(panel, deviceManager, ch);
        return UserDefaultsPanel.currentPanel;
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

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                this.outputChannel.appendLine(`[UserDefaultsPanel] Received: ${msg.command}`);
                try {
                    switch (msg.command) {
                        case 'loadUserDefaults':
                            await this.loadUserDefaults();
                            break;
                        case 'loadSuiteData':
                            await this.loadSuiteData(msg.suiteName, msg.isDefault);
                            break;
                        case 'requestEdit':
                            await this.handleEditRequest(msg.key, msg.currentValue, msg.suiteName);
                            break;
                        case 'requestDelete':
                            await this.handleDeleteRequest(msg.key, msg.suiteName);
                            break;
                    }
                } catch (err: any) {
                    this.outputChannel.appendLine(`[UserDefaultsPanel] Unhandled error: ${err.message}`);
                    this.postMessage({ command: 'error', text: err.message });
                }
            },
            null,
            this.disposables
        );

        this.panel.webview.html = this.getHtml();
    }

    private async handleEditRequest(key: string, currentValue: string, suiteName?: string): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: `Edit value for "${key}"`,
            value: currentValue,
            placeHolder: 'Enter new value (JSON format for objects/arrays)',
        });
        if (input === undefined) { return; }
        await this.editUserDefault(key, input, suiteName);
    }

    private async handleDeleteRequest(key: string, suiteName?: string): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            `Delete "${key}" from UserDefaults?`,
            { modal: true },
            'Delete'
        );
        if (answer !== 'Delete') { return; }
        await this.deleteUserDefault(key, suiteName);
    }

    private async loadUserDefaults(): Promise<void> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        try {
            this.outputChannel.appendLine('[UserDefaultsPanel] Evaluating UserDefaults.suites()...');
            const raw = await this.deviceManager.evaluate('JSON.stringify(UserDefaults.suites())') as any;
            this.outputChannel.appendLine(`[UserDefaultsPanel] Raw result type: ${typeof raw}`);
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const suites = JSON.parse(parsed);
            this.outputChannel.appendLine(`[UserDefaultsPanel] Found ${suites.length} suites`);
            this.postMessage({ command: 'suitesLoaded', suites });
        } catch (err: any) {
            this.outputChannel.appendLine(`[UserDefaultsPanel] Error: ${err.message}`);
            this.postMessage({ command: 'error', text: `Failed to load suites: ${err.message}` });
        }
    }

    private async loadSuiteData(suiteName: string, isDefault: boolean): Promise<void> {
        try {
            const arg = isDefault ? '' : `'${suiteName.replace(/'/g, "\\'")}'`;
            const raw = await this.deviceManager.evaluate(`JSON.stringify(UserDefaults.getAll(${arg}))`) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const data = JSON.parse(parsed);
            this.postMessage({ command: 'suiteDataLoaded', suiteName, data });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load suite data: ${err.message}` });
        }
    }

    private async editUserDefault(key: string, value: string, suiteName?: string): Promise<void> {
        try {
            let jsValue: string;
            try {
                JSON.parse(value);
                jsValue = value;
            } catch {
                jsValue = JSON.stringify(value);
            }
            const suiteArg = suiteName ? `, '${suiteName.replace(/'/g, "\\'")}'` : '';
            const code = `UserDefaults.set('${key.replace(/'/g, "\\'")}', ${jsValue}${suiteArg})`;
            await this.deviceManager.evaluate(code);
            this.postMessage({ command: 'userDefaultUpdated', key });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to update: ${err.message}` });
        }
    }

    private async deleteUserDefault(key: string, suiteName?: string): Promise<void> {
        try {
            const suiteArg = suiteName ? `, '${suiteName.replace(/'/g, "\\'")}'` : '';
            const code = `UserDefaults.remove('${key.replace(/'/g, "\\'")}' ${suiteArg})`;
            await this.deviceManager.evaluate(code);
            this.postMessage({ command: 'userDefaultDeleted', key });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to delete: ${err.message}` });
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        UserDefaultsPanel.currentPanel = undefined;
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
<title>UserDefaults</title>
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
        --error-fg: var(--vscode-errorForeground, #f44);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); padding: 12px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
    button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
    button:hover { background: var(--btn-hover); }
    button:disabled { opacity: 0.5; cursor: default; }
    button.danger { background: var(--error-fg); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--border); font-weight: 600; }
    td { padding: 5px 8px; border-bottom: 1px solid var(--border); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
    tr:hover td { background: var(--list-hover); }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 11px; background: var(--badge-bg); color: var(--badge-fg); }
    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .suite-section { margin-bottom: 4px; }
    .suite-header { display: flex; align-items: center; gap: 8px; padding: 8px 4px; cursor: pointer; border-bottom: 1px solid var(--border); user-select: none; }
    .suite-header:hover { background: var(--list-hover); }
    .arrow { transition: transform 0.15s; display: inline-block; }
    .arrow.open { transform: rotate(90deg); }
    .kv-actions { display: inline-flex; gap: 4px; opacity: 0; }
    tr:hover .kv-actions { opacity: 1; }
    .kv-actions button { padding: 2px 6px; font-size: 11px; }
    .toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg); z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .toast.error { background: var(--error-fg); }
    #status { margin-left: 8px; font-size: 12px; opacity: 0.7; }
</style>
</head>
<body>
<div class="toolbar">
    <button id="loadBtn">Load Suites</button>
    <span id="status"></span>
</div>
<div id="content"><div class="empty">Click "Load Suites" to fetch from device</div></div>
<div class="toast" id="toast"></div>

<script nonce="${nonce}">
(function() {
    var vscode = acquireVsCodeApi();
    var suitesData = [];
    var suiteCache = {};
    var openSuites = {};
    var loadBtn = document.getElementById('loadBtn');
    var statusEl = document.getElementById('status');
    var contentEl = document.getElementById('content');
    var toastEl = document.getElementById('toast');

    loadBtn.addEventListener('click', function() {
        loadBtn.disabled = true;
        statusEl.textContent = 'Loading...';
        vscode.postMessage({ command: 'loadUserDefaults' });
    });

    function renderSuites() {
        if (suitesData.length === 0) {
            contentEl.innerHTML = '<div class="empty">No suites found</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < suitesData.length; i++) {
            var s = suitesData[i];
            var label = s.isDefault ? 'StandardUserDefaults' : s.suiteName;
            var isOpen = !!openSuites[s.suiteName];
            html += '<div class="suite-section" data-suite-idx="' + i + '">';
            html += '<div class="suite-header" data-idx="' + i + '">';
            html += '<span class="arrow ' + (isOpen ? 'open' : '') + '">&#9654;</span>';
            html += '<strong>' + esc(label) + '</strong> <span class="badge">' + s.keyCount + ' keys</span>';
            html += '</div>';
            if (isOpen) {
                var data = suiteCache[s.suiteName];
                if (!data) {
                    html += '<div style="padding:12px;opacity:0.5">Loading...</div>';
                } else {
                    html += buildTable(s.suiteName, s.isDefault, data);
                }
            }
            html += '</div>';
        }
        contentEl.innerHTML = html;
        bindSuiteClicks();
    }

    function bindSuiteClicks() {
        var headers = contentEl.querySelectorAll('.suite-header');
        for (var i = 0; i < headers.length; i++) {
            headers[i].addEventListener('click', handleSuiteClick);
        }
        var editBtns = contentEl.querySelectorAll('[data-action="edit"]');
        for (var j = 0; j < editBtns.length; j++) {
            editBtns[j].addEventListener('click', handleEdit);
        }
        var delBtns = contentEl.querySelectorAll('[data-action="delete"]');
        for (var k = 0; k < delBtns.length; k++) {
            delBtns[k].addEventListener('click', handleDelete);
        }
    }

    function handleSuiteClick() {
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        var s = suitesData[idx];
        if (!s) return;
        openSuites[s.suiteName] = !openSuites[s.suiteName];
        if (openSuites[s.suiteName] && !suiteCache[s.suiteName]) {
            vscode.postMessage({ command: 'loadSuiteData', suiteName: s.suiteName, isDefault: s.isDefault });
        }
        renderSuites();
    }

    function handleEdit() {
        var key = this.getAttribute('data-key');
        var val = this.getAttribute('data-val');
        var suite = this.getAttribute('data-suite') || '';
        vscode.postMessage({ command: 'requestEdit', key: key, currentValue: val, suiteName: suite || undefined });
    }

    function handleDelete() {
        var key = this.getAttribute('data-key');
        var suite = this.getAttribute('data-suite') || '';
        vscode.postMessage({ command: 'requestDelete', key: key, suiteName: suite || undefined });
    }

    function buildTable(suiteName, isDefault, data) {
        var keys = Object.keys(data).sort();
        if (keys.length === 0) return '<div style="padding:12px;opacity:0.5">Empty</div>';
        var suiteArg = isDefault ? '' : suiteName;
        var html = '<table><tr><th>Key</th><th>Value</th><th style="width:90px"></th></tr>';
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = data[k];
            var vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            html += '<tr>';
            html += '<td>' + esc(k) + '</td>';
            html += '<td title="' + esc(vStr) + '">' + esc(trunc(vStr, 80)) + '</td>';
            html += '<td><span class="kv-actions">';
            html += '<button data-action="edit" data-key="' + esc(k) + '" data-val="' + esc(vStr) + '" data-suite="' + esc(suiteArg) + '">Edit</button>';
            html += '<button class="danger" data-action="delete" data-key="' + esc(k) + '" data-suite="' + esc(suiteArg) + '">&#10005;</button>';
            html += '</span></td>';
            html += '</tr>';
        }
        html += '</table>';
        return html;
    }

    window.addEventListener('message', function(e) {
        var msg = e.data;
        switch (msg.command) {
            case 'suitesLoaded':
                loadBtn.disabled = false;
                statusEl.textContent = '';
                suitesData = msg.suites || [];
                suiteCache = {};
                openSuites = {};
                renderSuites();
                showToast(suitesData.length + ' suites loaded');
                break;
            case 'suiteDataLoaded':
                suiteCache[msg.suiteName] = msg.data;
                renderSuites();
                break;
            case 'userDefaultUpdated':
            case 'userDefaultDeleted':
                suiteCache = {};
                vscode.postMessage({ command: 'loadUserDefaults' });
                break;
            case 'error':
                loadBtn.disabled = false;
                statusEl.textContent = '';
                showToast(msg.text, true);
                break;
        }
    });

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
