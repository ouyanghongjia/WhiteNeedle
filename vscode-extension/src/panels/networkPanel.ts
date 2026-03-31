import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

export class NetworkPanel {
    public static currentPanel: NetworkPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private disposables: vscode.Disposable[] = [];
    private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private capturing = true;

    public static createOrShow(extensionUri: vscode.Uri, deviceManager: DeviceManager): void {
        if (NetworkPanel.currentPanel) {
            NetworkPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'whiteneedleNetwork',
            'Network Monitor',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        NetworkPanel.currentPanel = new NetworkPanel(panel, deviceManager);
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager) {
        this.panel = panel;
        this.deviceManager = deviceManager;

        this.panel.webview.html = this.getHtmlContent();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'refresh':
                    await this.loadRequests();
                    break;
                case 'clear':
                    await this.clearRequests();
                    break;
                case 'getDetail':
                    await this.loadDetail(msg.id);
                    break;
                case 'toggleCapture':
                    await this.toggleCapture(msg.enabled);
                    break;
                case 'toggleAutoRefresh':
                    this.toggleAutoRefresh(msg.enabled);
                    break;
            }
        }, null, this.disposables);

        const bridge = this.deviceManager.getBridge();
        if (bridge) {
            const onNetReq = (data: any) => {
                this.panel.webview.postMessage({ command: 'networkEvent', type: 'request', data });
            };
            const onNetResp = (data: any) => {
                this.panel.webview.postMessage({ command: 'networkEvent', type: 'response', data });
            };
            bridge.on('networkRequest', onNetReq);
            bridge.on('networkResponse', onNetResp);
            this.disposables.push(new vscode.Disposable(() => {
                bridge.removeListener('networkRequest', onNetReq);
                bridge.removeListener('networkResponse', onNetResp);
            }));
        }

        this.loadRequests();
    }

    private async loadRequests(): Promise<void> {
        try {
            const requests = await this.deviceManager.listNetworkRequests();
            this.panel.webview.postMessage({ command: 'setRequests', requests });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async clearRequests(): Promise<void> {
        try {
            await this.deviceManager.clearNetworkRequests();
            this.panel.webview.postMessage({ command: 'setRequests', requests: [] });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async loadDetail(id: string): Promise<void> {
        try {
            const detail = await this.deviceManager.getNetworkRequest(id);
            this.panel.webview.postMessage({ command: 'showDetail', detail });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async toggleCapture(enabled: boolean): Promise<void> {
        try {
            this.capturing = await this.deviceManager.setNetworkCapture(enabled);
        } catch (_) { /* ignore */ }
    }

    private toggleAutoRefresh(enabled: boolean): void {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }
        if (enabled) {
            this.autoRefreshTimer = setInterval(() => this.loadRequests(), 2000);
        }
    }

    private dispose(): void {
        NetworkPanel.currentPanel = undefined;
        if (this.autoRefreshTimer) { clearInterval(this.autoRefreshTimer); }
        this.disposables.forEach(d => d.dispose());
        this.panel.dispose();
    }

    private getHtmlContent(): string {
        const nonce = getNonce();
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground); --border: var(--vscode-panel-border); --hover: var(--vscode-list-hoverBackground); --accent: var(--vscode-textLink-foreground); --badge-bg: var(--vscode-badge-background); --badge-fg: var(--vscode-badge-foreground); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); }
.toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.toolbar button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { opacity: 0.85; }
.toolbar label { font-size: 12px; display: flex; align-items: center; gap: 4px; }
.filter-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 8px; border-radius: 3px; font-size: 12px; flex: 1; min-width: 120px; }
.split { display: flex; height: calc(100vh - 42px); }
.list-pane { flex: 1; overflow-y: auto; border-right: 1px solid var(--border); min-width: 300px; }
.detail-pane { flex: 1; overflow-y: auto; padding: 12px; display: none; }
.detail-pane.open { display: block; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { position: sticky; top: 0; background: var(--vscode-editorGroupHeader-tabsBackground); text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); font-weight: 600; }
td { padding: 4px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 350px; }
tr { cursor: pointer; }
tr:hover { background: var(--hover); }
tr.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.status-2xx { color: #4caf50; }
.status-3xx { color: #ff9800; }
.status-4xx { color: #f44336; }
.status-5xx { color: #e91e63; }
.status-0 { color: #999; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
.badge-get { background: #2196f3; color: white; }
.badge-post { background: #4caf50; color: white; }
.badge-put { background: #ff9800; color: white; }
.badge-delete { background: #f44336; color: white; }
.badge-other { background: #9e9e9e; color: white; }
.detail-section { margin-bottom: 16px; }
.detail-section h3 { font-size: 13px; margin-bottom: 6px; color: var(--accent); }
.detail-section pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.detail-kv { display: grid; grid-template-columns: 140px 1fr; gap: 2px 12px; font-size: 12px; }
.detail-kv .k { font-weight: 600; opacity: 0.7; }
.empty { text-align: center; padding: 40px; opacity: 0.5; }
.count-badge { margin-left: auto; font-size: 11px; opacity: 0.7; }
</style>
</head>
<body>
<div class="toolbar">
  <button id="btnRefresh">↻ Refresh</button>
  <button id="btnClear">✕ Clear</button>
  <input id="filterInput" class="filter-input" placeholder="Filter by URL, method, status...">
  <label><input type="checkbox" id="chkCapture" checked> Capture</label>
  <label><input type="checkbox" id="chkAuto"> Auto-refresh</label>
  <span id="countBadge" class="count-badge">0 requests</span>
</div>
<div class="split">
  <div class="list-pane" id="listPane">
    <table><thead><tr><th style="width:60px">Method</th><th style="width:50px">Status</th><th>URL</th><th style="width:70px">Duration</th><th style="width:60px">Size</th></tr></thead><tbody id="tbody"></tbody></table>
    <div id="emptyMsg" class="empty">No requests captured yet. Network traffic will appear here in real-time.</div>
  </div>
  <div class="detail-pane" id="detailPane"></div>
</div>
<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    let allRequests = [];
    let selectedId = null;

    const tbody = document.getElementById('tbody');
    const emptyMsg = document.getElementById('emptyMsg');
    const detailPane = document.getElementById('detailPane');
    const filterInput = document.getElementById('filterInput');
    const countBadge = document.getElementById('countBadge');

    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({command:'refresh'}));
    document.getElementById('btnClear').addEventListener('click', () => { allRequests = []; renderList(); vscode.postMessage({command:'clear'}); });
    document.getElementById('chkCapture').addEventListener('change', (e) => vscode.postMessage({command:'toggleCapture', enabled:e.target.checked}));
    document.getElementById('chkAuto').addEventListener('change', (e) => vscode.postMessage({command:'toggleAutoRefresh', enabled:e.target.checked}));
    filterInput.addEventListener('input', () => renderList());

    window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.command === 'setRequests') {
            allRequests = msg.requests || [];
            renderList();
        } else if (msg.command === 'networkEvent') {
            if (msg.type === 'request') {
                allRequests.push(msg.data);
                renderList();
            } else if (msg.type === 'response') {
                const idx = allRequests.findIndex(r => r.id === msg.data.id);
                if (idx >= 0) allRequests[idx] = msg.data;
                renderList();
            }
        } else if (msg.command === 'showDetail') {
            renderDetail(msg.detail);
        }
    });

    function renderList() {
        const filter = filterInput.value.toLowerCase();
        const filtered = allRequests.filter(r => {
            if (!filter) return true;
            return (r.url||'').toLowerCase().includes(filter) ||
                   (r.method||'').toLowerCase().includes(filter) ||
                   String(r.status).includes(filter);
        });
        countBadge.textContent = filtered.length + ' requests';
        emptyMsg.style.display = filtered.length ? 'none' : 'block';
        tbody.innerHTML = '';
        for (let i = filtered.length - 1; i >= 0; i--) {
            const r = filtered[i];
            const tr = document.createElement('tr');
            if (r.id === selectedId) tr.classList.add('selected');
            const methodCls = 'badge badge-' + ((r.method||'GET').toLowerCase() === 'get' ? 'get' : (r.method||'').toLowerCase() === 'post' ? 'post' : (r.method||'').toLowerCase() === 'put' ? 'put' : (r.method||'').toLowerCase() === 'delete' ? 'delete' : 'other');
            const statusCls = r.status >= 200 && r.status < 300 ? 'status-2xx' : r.status >= 300 && r.status < 400 ? 'status-3xx' : r.status >= 400 && r.status < 500 ? 'status-4xx' : r.status >= 500 ? 'status-5xx' : 'status-0';
            const dur = r.duration != null ? Math.round(r.duration) + 'ms' : '...';
            const size = r.size > 0 ? formatBytes(r.size) : '-';
            const urlPath = (r.url||'').replace(/^https?:\\/\\/[^/]+/, '');
            tr.innerHTML = '<td><span class="' + methodCls + '">' + esc(r.method||'GET') + '</span></td><td class="' + statusCls + '">' + (r.status||'...') + '</td><td title="' + esc(r.url) + '">' + esc(urlPath || r.url) + '</td><td>' + dur + '</td><td>' + size + '</td>';
            tr.addEventListener('click', () => {
                selectedId = r.id;
                renderList();
                vscode.postMessage({command:'getDetail', id:r.id});
            });
            tbody.appendChild(tr);
        }
    }

    function renderDetail(d) {
        if (!d) { detailPane.classList.remove('open'); return; }
        detailPane.classList.add('open');
        let html = '<div class="detail-section"><h3>' + esc(d.method) + ' ' + esc(d.url) + '</h3><div class="detail-kv">';
        html += '<span class="k">Status</span><span>' + d.status + '</span>';
        html += '<span class="k">Duration</span><span>' + (d.duration != null ? Math.round(d.duration) + 'ms' : 'pending') + '</span>';
        html += '<span class="k">Size</span><span>' + formatBytes(d.size||0) + '</span>';
        html += '<span class="k">MIME</span><span>' + esc(d.mimeType||'') + '</span>';
        html += '<span class="k">Host</span><span>' + esc(d.host||'') + '</span>';
        if (d.error) html += '<span class="k">Error</span><span style="color:#f44336">' + esc(d.error) + '</span>';
        html += '</div></div>';
        if (d.requestHeaders && Object.keys(d.requestHeaders).length) {
            html += '<div class="detail-section"><h3>Request Headers</h3><pre>' + esc(JSON.stringify(d.requestHeaders, null, 2)) + '</pre></div>';
        }
        if (d.requestBody) {
            html += '<div class="detail-section"><h3>Request Body</h3><pre>' + esc(tryFormatJSON(d.requestBody)) + '</pre></div>';
        }
        if (d.responseHeaders && Object.keys(d.responseHeaders).length) {
            html += '<div class="detail-section"><h3>Response Headers</h3><pre>' + esc(JSON.stringify(d.responseHeaders, null, 2)) + '</pre></div>';
        }
        if (d.responseBody) {
            html += '<div class="detail-section"><h3>Response Body</h3><pre>' + esc(tryFormatJSON(d.responseBody)) + '</pre></div>';
        }
        detailPane.innerHTML = html;
    }

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function formatBytes(b) { if (b < 1024) return b + 'B'; if (b < 1048576) return (b/1024).toFixed(1) + 'KB'; return (b/1048576).toFixed(1) + 'MB'; }
    function tryFormatJSON(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch(_) { return s; } }
})();
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
