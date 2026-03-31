import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

export class CookiePanel {
    public static currentPanel: CookiePanel | undefined;
    private static readonly viewType = 'whiteneedle.cookiePanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        outputChannel?: vscode.OutputChannel
    ): CookiePanel {
        const column = vscode.ViewColumn.One;

        if (CookiePanel.currentPanel) {
            CookiePanel.currentPanel.panel.reveal(column);
            return CookiePanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            CookiePanel.viewType,
            'Cookies',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const ch = outputChannel ?? vscode.window.createOutputChannel('WhiteNeedle');
        CookiePanel.currentPanel = new CookiePanel(panel, deviceManager, ch);
        return CookiePanel.currentPanel;
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
                this.outputChannel.appendLine(`[CookiePanel] Received: ${msg.command}`);
                try {
                    switch (msg.command) {
                        case 'loadCookies':
                            await this.loadCookies(msg.domain);
                            break;
                        case 'deleteCookie':
                            await this.deleteCookie(msg.name, msg.domain);
                            break;
                    }
                } catch (err: any) {
                    this.outputChannel.appendLine(`[CookiePanel] Unhandled error: ${err.message}`);
                    this.postMessage({ command: 'error', text: err.message });
                }
            },
            null,
            this.disposables
        );

        this.panel.webview.html = this.getHtml();
    }

    private async loadCookies(domainFilter?: string): Promise<void> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        try {
            const code = domainFilter
                ? `JSON.stringify(Cookies.getAll('${domainFilter.replace(/'/g, "\\'")}'))`
                : 'JSON.stringify(Cookies.getAll())';
            const raw = await this.deviceManager.evaluate(code) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const cookies = JSON.parse(parsed);
            this.postMessage({ command: 'cookiesLoaded', cookies });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load cookies: ${err.message}` });
        }
    }

    private async deleteCookie(name: string, domain: string): Promise<void> {
        try {
            const code = `Cookies.remove('${name.replace(/'/g, "\\'")}', '${domain.replace(/'/g, "\\'")}')`;
            await this.deviceManager.evaluate(code);
            await this.loadCookies();
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to delete cookie: ${err.message}` });
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        CookiePanel.currentPanel = undefined;
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
<title>Cookies</title>
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
        --badge-bg: var(--vscode-badge-background);
        --badge-fg: var(--vscode-badge-foreground);
        --list-hover: var(--vscode-list-hoverBackground);
        --error-fg: var(--vscode-errorForeground, #f44);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); padding: 12px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; position: sticky; top: 0; z-index: 10; background: var(--bg); padding-bottom: 8px; }
    .toolbar input { flex: 1; min-width: 150px; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; outline: none; }
    .toolbar input:focus { border-color: var(--btn-bg); }
    button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
    button:hover { background: var(--btn-hover); }
    button:disabled { opacity: 0.5; cursor: default; }
    button.danger { background: var(--error-fg); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--border); font-weight: 600; position: sticky; top: 42px; background: var(--bg); z-index: 5; }
    td { padding: 5px 8px; border-bottom: 1px solid var(--border); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
    tr:hover td { background: var(--list-hover); }
    .detail-row td { padding: 8px 8px 8px 32px; white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg); z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .toast.error { background: var(--error-fg); }
    #status { margin-left: 8px; font-size: 12px; opacity: 0.7; }
</style>
</head>
<body>
<div class="toolbar">
    <input id="domainFilter" placeholder="Filter by domain..." />
    <button id="loadBtn">Load Cookies</button>
    <span id="status"></span>
</div>
<div id="content"><div class="empty">Click "Load Cookies" to fetch from device</div></div>
<div class="toast" id="toast"></div>

<script nonce="${nonce}">
(function() {
    var vscode = acquireVsCodeApi();
    var cookiesData = [];
    var expandedRows = {};
    var loadBtn = document.getElementById('loadBtn');
    var filterInput = document.getElementById('domainFilter');
    var statusEl = document.getElementById('status');
    var contentEl = document.getElementById('content');
    var toastEl = document.getElementById('toast');

    loadBtn.addEventListener('click', function() {
        loadBtn.disabled = true;
        statusEl.textContent = 'Loading...';
        var domain = filterInput.value.trim();
        vscode.postMessage({ command: 'loadCookies', domain: domain || undefined });
    });
    filterInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') loadBtn.click();
    });

    function renderCookies() {
        if (cookiesData.length === 0) {
            contentEl.innerHTML = '<div class="empty">No cookies found</div>';
            return;
        }
        var grouped = {};
        for (var i = 0; i < cookiesData.length; i++) {
            var c = cookiesData[i];
            var d = c.domain || '(unknown)';
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push(c);
        }
        var domains = Object.keys(grouped).sort();
        var html = '<table><tr><th>Domain</th><th>Name</th><th>Value</th><th>Secure</th><th>HTTPOnly</th><th style="width:50px"></th></tr>';
        for (var di = 0; di < domains.length; di++) {
            var domain = domains[di];
            var items = grouped[domain];
            for (var ci = 0; ci < items.length; ci++) {
                var ck = items[ci];
                var rid = domain + '::' + ck.name + '::' + ci;
                var expanded = !!expandedRows[rid];
                html += '<tr data-rid="' + esc(rid) + '" data-action="toggle-detail">';
                html += '<td>' + esc(domain) + '</td>';
                html += '<td style="cursor:pointer">' + esc(ck.name) + '</td>';
                html += '<td title="' + esc(ck.value) + '">' + esc(trunc(ck.value, 50)) + '</td>';
                html += '<td>' + (ck.isSecure ? '\\u2713' : '') + '</td>';
                html += '<td>' + (ck.isHTTPOnly ? '\\u2713' : '') + '</td>';
                html += '<td><button class="danger" data-action="delete-cookie" data-name="' + esc(ck.name) + '" data-domain="' + esc(ck.domain) + '">\\u2715</button></td>';
                html += '</tr>';
                if (expanded) {
                    html += '<tr class="detail-row"><td colspan="6"><pre>' + esc(JSON.stringify(ck, null, 2)) + '</pre></td></tr>';
                }
            }
        }
        html += '</table>';
        contentEl.innerHTML = html;
        bindClicks();
    }

    function bindClicks() {
        var rows = contentEl.querySelectorAll('[data-action="toggle-detail"]');
        for (var i = 0; i < rows.length; i++) {
            rows[i].addEventListener('click', function(e) {
                if (e.target.getAttribute('data-action') === 'delete-cookie') return;
                var rid = this.getAttribute('data-rid');
                expandedRows[rid] = !expandedRows[rid];
                renderCookies();
            });
        }
        var delBtns = contentEl.querySelectorAll('[data-action="delete-cookie"]');
        for (var j = 0; j < delBtns.length; j++) {
            delBtns[j].addEventListener('click', function(e) {
                e.stopPropagation();
                vscode.postMessage({
                    command: 'deleteCookie',
                    name: this.getAttribute('data-name'),
                    domain: this.getAttribute('data-domain')
                });
            });
        }
    }

    window.addEventListener('message', function(e) {
        var msg = e.data;
        switch (msg.command) {
            case 'cookiesLoaded':
                loadBtn.disabled = false;
                statusEl.textContent = '';
                cookiesData = msg.cookies || [];
                renderCookies();
                showToast(cookiesData.length + ' cookies loaded');
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
