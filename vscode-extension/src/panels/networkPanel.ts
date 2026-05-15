import * as vscode from 'vscode';
import { DeviceManager, ConnectionState } from '../device/deviceManager';
import { TcpBridge } from '../bridge/tcpBridge';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';
import { MockPanel } from './mockPanel';

export class NetworkPanel {
    public static currentPanel: NetworkPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private capturing = true;
    private lastDeviceKey: string | null = null;
    private wasDisconnected = false;
    private webviewReady = false;
    private pendingStateOnReady: ConnectionState | null = null;
    /** Avoid duplicate bridge.on; rebind after reconnect (new TcpBridge instance). */
    private boundBridge: TcpBridge | null = null;
    private bridgeNetCleanup: (() => void) | null = null;

    public static createOrShow(extensionUri: vscode.Uri, deviceManager: DeviceManager, outputChannel?: vscode.OutputChannel): void {
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
        NetworkPanel.currentPanel = new NetworkPanel(panel, deviceManager, outputChannel);
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager, outputChannel?: vscode.OutputChannel) {
        this.panel = panel;
        this.deviceManager = deviceManager;
        this.outputChannel = outputChannel ?? { appendLine() {} } as any;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'ready':
                    this.onWebviewReady();
                    break;
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
                case 'mockRequest':
                    this.openMockWithPrefill(msg.detail);
                    break;
            }
        }, null, this.disposables);

        const onStateChanged = (s: ConnectionState) => {
            if (s === 'connected' || s === 'disconnected' || s === 'reconnecting') {
                this.syncBridgeNetworkListeners();
                this.handleConnectionStateChange(s);
            }
        };
        const onReconnected = () => {
            this.syncBridgeNetworkListeners();
        };
        this.deviceManager.on('stateChanged', onStateChanged);
        this.deviceManager.on('reconnected', onReconnected);
        this.disposables.push(new vscode.Disposable(() => {
            this.deviceManager.removeListener('stateChanged', onStateChanged);
            this.deviceManager.removeListener('reconnected', onReconnected);
        }));

        bindConnectionState(this.panel, this.deviceManager, this.disposables);
        this.syncBridgeNetworkListeners();
        this.lastDeviceKey = this.getCurrentDeviceKey();

        this.panel.webview.html = this.getHtmlContent();

        const initTimer = setTimeout(() => {
            if (!this.webviewReady) {
                this.outputChannel.appendLine('[NetworkPanel] Webview ready (timeout fallback)');
                this.webviewReady = true;
            }
            if (this.pendingStateOnReady) {
                this.handleConnectionStateChange(this.pendingStateOnReady);
                this.pendingStateOnReady = null;
            } else if (this.deviceManager.state === 'connected') {
                this.loadRequestsWithRetry();
            }
        }, 800);
        this.disposables.push(new vscode.Disposable(() => clearTimeout(initTimer)));
    }

    private onWebviewReady(): void {
        if (this.webviewReady) { return; }
        this.webviewReady = true;
        this.outputChannel.appendLine('[NetworkPanel] Webview ready');
        if (this.pendingStateOnReady) {
            this.handleConnectionStateChange(this.pendingStateOnReady);
            this.pendingStateOnReady = null;
        } else if (this.deviceManager.state === 'connected') {
            this.loadRequestsWithRetry();
        }
    }

    /** Attach network stream listeners to current bridge; detach from previous when TcpBridge is replaced. */
    private syncBridgeNetworkListeners(): void {
        const bridge = this.deviceManager.getBridge();
        if (bridge === this.boundBridge) {
            return;
        }
        if (this.bridgeNetCleanup) {
            this.outputChannel.appendLine('[NetworkPanel] Detaching listeners from old bridge');
            this.bridgeNetCleanup();
            this.bridgeNetCleanup = null;
        }
        this.boundBridge = null;

        if (!bridge) {
            return;
        }

        this.outputChannel.appendLine('[NetworkPanel] Attaching listeners to new bridge');
        const onNetReq = (data: any) => {
            this.panel.webview.postMessage({ command: 'networkEvent', type: 'request', data });
        };
        const onNetResp = (data: any) => {
            this.panel.webview.postMessage({ command: 'networkEvent', type: 'response', data });
        };
        bridge.on('networkRequest', onNetReq);
        bridge.on('networkResponse', onNetResp);
        this.boundBridge = bridge;
        this.bridgeNetCleanup = () => {
            bridge.removeListener('networkRequest', onNetReq);
            bridge.removeListener('networkResponse', onNetResp);
        };
    }

    private async loadRequests(): Promise<void> {
        try {
            const requests = await this.deviceManager.listNetworkRequests();
            this.outputChannel.appendLine(`[NetworkPanel] loadRequests -> ${requests.length} requests, posting setRequests`);
            this.panel.webview.postMessage({ command: 'setRequests', requests });
        } catch (err: any) {
            this.outputChannel.appendLine(`[NetworkPanel] loadRequests error: ${err.message}`);
        }
    }

    private getCurrentDeviceKey(): string | null {
        const device = this.deviceManager.getConnectedDevice();
        if (!device) { return null; }
        if (device.deviceId) { return `id:${device.deviceId}`; }
        return `${device.host}:${device.enginePort}`;
    }

    private handleConnectionStateChange(state: ConnectionState): void {
        this.outputChannel.appendLine(`[NetworkPanel] handleConnectionStateChange: ${state}, webviewReady=${this.webviewReady}`);
        if (!this.webviewReady) {
            this.pendingStateOnReady = state;
            return;
        }
        if (state === 'disconnected') {
            this.lastDeviceKey = null;
            this.wasDisconnected = true;
            this.panel.webview.postMessage({ command: 'resetConnection' });
            return;
        }
        if (state !== 'connected') { return; }
        const currentKey = this.getCurrentDeviceKey();
        if (this.wasDisconnected || currentKey !== this.lastDeviceKey) {
            this.panel.webview.postMessage({ command: 'resetConnection' });
            this.lastDeviceKey = currentKey;
            this.wasDisconnected = false;
        }
        this.loadRequestsWithRetry();
    }

    private async loadRequestsWithRetry(attempts = 3): Promise<void> {
        for (let i = 0; i < attempts; i++) {
            try {
                const requests = await this.deviceManager.listNetworkRequests();
                this.panel.webview.postMessage({ command: 'setRequests', requests });
                this.outputChannel.appendLine(`[NetworkPanel] Loaded ${requests.length} stored requests`);
                return;
            } catch (err: any) {
                this.outputChannel.appendLine(
                    `[NetworkPanel] loadRequests attempt ${i + 1}/${attempts} failed: ${err.message}`
                );
                if (i < attempts - 1) {
                    await new Promise(r => setTimeout(r, 500 * (i + 1)));
                }
            }
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

    private openMockWithPrefill(detail: any): void {
        if (!detail) { return; }
        const url = detail.url || '';
        let urlPattern = '';
        try {
            const u = new URL(url);
            urlPattern = u.pathname + u.search;
        } catch (_) {
            urlPattern = url.replace(/^https?:\/\/[^/]+/, '');
        }
        // Strip query string for a cleaner pattern
        const qIdx = urlPattern.indexOf('?');
        if (qIdx > 0) { urlPattern = urlPattern.substring(0, qIdx); }

        const prefill: Record<string, any> = {
            urlPattern,
            method: detail.method || '*',
            mode: 'pureMock',
            statusCode: detail.status || 200,
            delay: 0,
        };
        if (detail.responseHeaders) {
            const h: Record<string, string> = {};
            for (const [k, v] of Object.entries(detail.responseHeaders)) {
                const lk = k.toLowerCase();
                if (lk === 'content-type' || lk === 'access-control-allow-origin') {
                    h[k] = Array.isArray(v) ? v[0] : String(v);
                }
            }
            if (Object.keys(h).length) { prefill.responseHeaders = h; }
        }
        if (detail.responseBody) {
            prefill.responseBody = detail.responseBody;
        }
        MockPanel.createOrShowWithPrefill(this.deviceManager, prefill);
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
        if (this.bridgeNetCleanup) {
            this.bridgeNetCleanup();
            this.bridgeNetCleanup = null;
        }
        this.boundBridge = null;
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
html, body { height: 100%; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); display: flex; flex-direction: column; }
.toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.toolbar button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { opacity: 0.85; }
.toolbar label { font-size: 12px; display: flex; align-items: center; gap: 4px; }
.filter-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 8px; border-radius: 3px; font-size: 12px; flex: 1; min-width: 120px; }
.split { display: flex; flex: 1; overflow: hidden; }
.list-pane { flex: 1; overflow-y: auto; border-right: 1px solid var(--border); min-width: 300px; }
.detail-pane { flex: 1; overflow-y: auto; padding: 12px; display: none; }
.detail-pane.open { display: block; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { position: sticky; top: 0; background: var(--vscode-editorGroupHeader-tabsBackground); text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); font-weight: 600; }
td { padding: 4px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 350px; }
tr { cursor: pointer; }
tr:hover { background: var(--hover); }
tr.selected { background: rgba(33, 150, 243, 0.25); color: var(--vscode-list-activeSelectionForeground); }
tr.selected td { border-bottom-color: rgba(33, 150, 243, 0.35); }
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
.badge-dns { background: #9c27b0; color: white; font-size: 10px; padding: 1px 4px; margin-left: 4px; vertical-align: middle; }
.detail-section { margin-bottom: 16px; }
.detail-header { display: flex; align-items: center; justify-content: space-between; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.detail-header h3 { font-size: 13px; color: var(--accent); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-close { background: none; border: none; color: var(--fg); font-size: 18px; cursor: pointer; padding: 2px 6px; border-radius: 3px; opacity: 0.7; flex-shrink: 0; }
.detail-close:hover { opacity: 1; background: var(--hover); }
.detail-section h3 { font-size: 13px; margin-bottom: 6px; color: var(--accent); }
.detail-section pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.cookie-list { list-style: none; padding: 8px; margin: 0; background: var(--vscode-textCodeBlock-background); border-radius: 4px; font-size: 12px; }
.cookie-list li { padding: 4px 0; border-bottom: 1px solid var(--border); white-space: pre-wrap; word-break: break-all; }
.cookie-list li:last-child { border-bottom: none; }
.detail-kv { display: grid; grid-template-columns: 140px 1fr; gap: 2px 12px; font-size: 12px; }
.detail-kv .k { font-weight: 600; opacity: 0.7; }
.empty { text-align: center; padding: 40px; opacity: 0.5; }
.count-badge { margin-left: auto; font-size: 11px; opacity: 0.7; }
.filter-bar { border-bottom: 1px solid var(--border); font-size: 12px; }
.filter-bar-header { display: flex; gap: 6px; padding: 4px 8px; align-items: center; }
.filter-bar-header button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
.filter-bar-header button:hover { opacity: 0.85; }
.filter-bar-header label { font-size: 12px; display: flex; align-items: center; gap: 4px; margin-left: 8px; }
.filter-bar-header select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 1px 4px; border-radius: 3px; font-size: 11px; margin-left: 4px; }
.filter-logic-sep { padding: 0 8px 2px 32px; font-size: 11px; opacity: 0.5; font-style: italic; }
.filter-row { display: flex; gap: 4px; padding: 3px 8px; align-items: center; }
.filter-row select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 4px; border-radius: 3px; font-size: 12px; }
.filter-row .filter-val { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 8px; border-radius: 3px; font-size: 12px; flex: 1; min-width: 80px; }
.filter-row .filter-remove { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.5; font-size: 14px; padding: 0 4px; }
.filter-row .filter-remove:hover { opacity: 1; }
.group-header { background: var(--vscode-editorGroupHeader-tabsBackground); padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--accent); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; }
.group-header .group-count { font-weight: normal; opacity: 0.6; }

.detail-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; cursor: pointer; user-select: none; }
.detail-section-header h3 { margin: 0; font-size: 13px; color: var(--accent); }
.detail-section-header .chevron { display: inline-block; width: 16px; font-size: 11px; transition: transform 0.15s; margin-right: 4px; opacity: 0.6; }
.detail-section.collapsed .detail-section-header .chevron { transform: rotate(-90deg); }
.detail-section.collapsed .section-body { display: none; }
.section-actions { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.btn-sm { background: none; border: 1px solid var(--border); border-radius: 3px; color: var(--fg); cursor: pointer; font-size: 11px; padding: 2px 6px; opacity: 0.7; white-space: nowrap; }
.btn-sm:hover { opacity: 1; background: var(--hover); }

.header-grid { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; }
.header-key { color: #4fc1ff; font-weight: 600; white-space: nowrap; }
.header-val { color: var(--vscode-editor-foreground); word-break: break-all; font-family: var(--vscode-editor-font-family); opacity: 0.85; }

.json-tree { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; overflow-x: auto; }
.json-tree .json-tree { background: none; padding: 0; border-radius: 0; }
.json-tree details { margin-left: 0; }
.json-tree summary { cursor: pointer; user-select: none; color: var(--vscode-editor-foreground); opacity: 0.6; }
.json-tree summary:hover { opacity: 1; }
.json-content { border-left: 1px solid var(--vscode-editorIndentGuide-background); margin-left: 4px; padding-left: 12px; }
.json-row { padding: 1px 0; }
.json-key { color: #4fc1ff; }
.json-val-str { color: #ce9178; }
.json-val-num { color: #b5cea8; }
.json-val-bool { color: #569cd6; font-weight: 600; }
.json-val-null { color: #569cd6; font-style: italic; }

${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}
<div class="toolbar">
  <button id="btnRefresh">↻ Refresh</button>
  <button id="btnClear">✕ Clear</button>
  <input id="filterInput" class="filter-input" placeholder="Quick filter (URL, method, status...)">
  <label><input type="checkbox" id="chkCapture" checked> Capture</label>
  <label><input type="checkbox" id="chkAuto"> Auto-refresh</label>
  <span id="countBadge" class="count-badge">0 requests</span>
</div>
<div class="filter-bar" id="filterBar">
  <div class="filter-bar-header">
    <button id="btnAddFilter">+ Filter</button>
    <label>Include logic:<select id="selIncludeLogic"><option value="or">OR (any match)</option><option value="and">AND (all match)</option></select></label>
    <label><input type="checkbox" id="chkGroup"> Group</label>
  </div>
  <div id="filterRows"></div>
</div>
<div class="split">
  <div class="list-pane" id="listPane">
    <table><thead><tr><th style="width:60px">Method</th><th style="width:50px">Status</th><th>URL</th><th style="width:70px">Duration</th><th style="width:60px">Size</th><th style="width:40px">DNS</th></tr></thead><tbody id="tbody"></tbody></table>
    <div id="emptyMsg" class="empty">No requests captured yet. Network traffic will appear here in real-time.</div>
  </div>
  <div class="detail-pane" id="detailPane"></div>
</div>
<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ command: 'ready' });

    let allRequests = [];
    let selectedId = null;
    let filters = [];
    let filterId = 0;

    const tbody = document.getElementById('tbody');
    const emptyMsg = document.getElementById('emptyMsg');
    const detailPane = document.getElementById('detailPane');
    const filterInput = document.getElementById('filterInput');
    const countBadge = document.getElementById('countBadge');
    const filterRows = document.getElementById('filterRows');
    const chkGroup = document.getElementById('chkGroup');
    const selIncludeLogic = document.getElementById('selIncludeLogic');

    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({command:'refresh'}));
    document.getElementById('btnClear').addEventListener('click', () => { allRequests = []; renderList(); vscode.postMessage({command:'clear'}); });
    document.getElementById('chkCapture').addEventListener('change', (e) => vscode.postMessage({command:'toggleCapture', enabled:e.target.checked}));
    document.getElementById('chkAuto').addEventListener('change', (e) => vscode.postMessage({command:'toggleAutoRefresh', enabled:e.target.checked}));
    filterInput.addEventListener('input', () => renderList());
    chkGroup.addEventListener('change', () => renderList());
    selIncludeLogic.addEventListener('change', () => { renderFilterRows(); renderList(); });
    document.getElementById('btnAddFilter').addEventListener('click', () => addFilter());

    function addFilter(field, mode, value) {
        const id = ++filterId;
        const f = { id: id, field: field || 'url', mode: mode || 'include', value: value || '' };
        filters.push(f);
        renderFilterRows();
        renderList();
    }

    function removeFilter(id) {
        filters = filters.filter(f => f.id !== id);
        renderFilterRows();
        renderList();
    }

    function renderFilterRows() {
        filterRows.innerHTML = '';
        var logic = selIncludeLogic.value;
        var prevMode = null;
        filters.forEach(function(f, idx) {
            if (idx > 0 && f.mode === 'include' && prevMode === 'include') {
                var sep = document.createElement('div');
                sep.className = 'filter-logic-sep';
                sep.textContent = logic === 'and' ? 'AND' : 'OR';
                filterRows.appendChild(sep);
            }
            prevMode = f.mode;
            var row = document.createElement('div');
            row.className = 'filter-row';
            row.innerHTML =
                '<select class="f-field">' +
                '<option value="url"' + (f.field === 'url' ? ' selected' : '') + '>URL</option>' +
                '<option value="method"' + (f.field === 'method' ? ' selected' : '') + '>Method</option>' +
                '<option value="status"' + (f.field === 'status' ? ' selected' : '') + '>Status</option>' +
                '<option value="all"' + (f.field === 'all' ? ' selected' : '') + '>All</option>' +
                '</select>' +
                '<select class="f-mode">' +
                '<option value="include"' + (f.mode === 'include' ? ' selected' : '') + '>Include</option>' +
                '<option value="exclude"' + (f.mode === 'exclude' ? ' selected' : '') + '>Exclude</option>' +
                '</select>' +
                '<input class="filter-val" value="' + esc(f.value) + '" placeholder="keyword...">' +
                '<button class="filter-remove" title="Remove">✕</button>';
            var fieldSel = row.querySelector('.f-field');
            var modeSel = row.querySelector('.f-mode');
            var valInput = row.querySelector('.filter-val');
            var removeBtn = row.querySelector('.filter-remove');
            fieldSel.addEventListener('change', function() { f.field = this.value; renderList(); });
            modeSel.addEventListener('change', function() { f.mode = this.value; renderFilterRows(); renderList(); });
            valInput.addEventListener('input', function() { f.value = this.value; renderList(); });
            removeBtn.addEventListener('click', function() { removeFilter(f.id); });
            filterRows.appendChild(row);
        });
    }

    window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.command === 'setRequests') {
            var incoming = msg.requests || [];
            var incomingIds = {};
            incoming.forEach(function(r) { if (r.id) incomingIds[r.id] = true; });
            var extras = allRequests.filter(function(r) { return r.id && !incomingIds[r.id]; });
            allRequests = incoming.concat(extras);
            renderList();
        } else if (msg.command === 'resetConnection') {
            allRequests = [];
            selectedId = null;
            closeDetail();
            renderList();
        } else if (msg.command === 'networkEvent') {
            if (msg.type === 'request') {
                allRequests.push(msg.data);
                renderList();
            } else if (msg.type === 'response') {
                const idx = allRequests.findIndex(r => r.id === msg.data.id);
                if (idx >= 0) allRequests[idx] = msg.data;
                else allRequests.push(msg.data);
                renderList();
            }
        } else if (msg.command === 'showDetail') {
            renderDetail(msg.detail);
        }
    });

    function fieldValue(r, field) {
        if (field === 'url') return (r.url || '').toLowerCase();
        if (field === 'method') return (r.method || '').toLowerCase();
        if (field === 'status') return String(r.status || '');
        return ((r.url || '') + ' ' + (r.method || '') + ' ' + (r.status || '')).toLowerCase();
    }

    function filterMatch(r, f) {
        if (!f.value) return true;
        var terms = f.value.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
        if (!terms.length) return true;
        var val = fieldValue(r, f.field);
        return terms.some(function(t) { return val.includes(t); });
    }

    function buildRow(r) {
        const tr = document.createElement('tr');
        if (r.id === selectedId) tr.classList.add('selected');
        const methodCls = 'badge badge-' + ((r.method||'GET').toLowerCase() === 'get' ? 'get' : (r.method||'').toLowerCase() === 'post' ? 'post' : (r.method||'').toLowerCase() === 'put' ? 'put' : (r.method||'').toLowerCase() === 'delete' ? 'delete' : 'other');
        const statusCls = r.status >= 200 && r.status < 300 ? 'status-2xx' : r.status >= 300 && r.status < 400 ? 'status-3xx' : r.status >= 400 && r.status < 500 ? 'status-4xx' : r.status >= 500 ? 'status-5xx' : 'status-0';
        const dur = r.duration != null ? Math.round(r.duration) + 'ms' : '...';
        const size = r.size > 0 ? formatBytes(r.size) : '-';
        const urlPath = (r.url||'').replace(/^https?:[/][/][^/]+/, '');
        const dnsCell = r.hostMapped ? '<span class="badge badge-dns" title="→ ' + esc(r.resolvedIP||'') + ' (' + esc(r.matchedGroupTitle||'') + ')">⇄</span>' : '';
        tr.innerHTML = '<td><span class="' + methodCls + '">' + esc(r.method||'GET') + '</span></td><td class="' + statusCls + '">' + (r.status||'...') + '</td><td title="' + esc(r.url) + '">' + esc(urlPath || r.url) + '</td><td>' + dur + '</td><td>' + size + '</td><td>' + dnsCell + '</td>';
        tr.addEventListener('click', () => {
            if (selectedId === r.id) { closeDetail(); return; }
            selectedId = r.id;
            renderList();
            vscode.postMessage({command:'getDetail', id:r.id});
        });
        return tr;
    }

    function renderList() {
        var quickFilter = filterInput.value.toLowerCase();
        var includeFilters = filters.filter(function(f) { return f.mode === 'include' && f.value.trim(); });
        var excludeFilters = filters.filter(function(f) { return f.mode === 'exclude' && f.value.trim(); });
        var includeLogic = selIncludeLogic.value;
        var groupEnabled = chkGroup.checked && includeFilters.length > 0;

        var filtered = allRequests.filter(function(r) {
            if (quickFilter) {
                var qv = ((r.url||'') + ' ' + (r.method||'') + ' ' + (r.status||'')).toLowerCase();
                if (!qv.includes(quickFilter)) return false;
            }
            for (var i = 0; i < excludeFilters.length; i++) {
                if (filterMatch(r, excludeFilters[i])) return false;
            }
            if (includeFilters.length > 0) {
                if (includeLogic === 'and') {
                    for (var i = 0; i < includeFilters.length; i++) {
                        if (!filterMatch(r, includeFilters[i])) return false;
                    }
                } else {
                    var anyMatch = false;
                    for (var i = 0; i < includeFilters.length; i++) {
                        if (filterMatch(r, includeFilters[i])) { anyMatch = true; break; }
                    }
                    if (!anyMatch) return false;
                }
            }
            return true;
        });

        countBadge.textContent = filtered.length + ' requests';
        if (filtered.length) {
            emptyMsg.style.display = 'none';
        } else {
            emptyMsg.style.display = 'block';
            if (allRequests.length > 0) {
                emptyMsg.textContent = 'No requests match current filters.';
            } else {
                emptyMsg.textContent = 'No requests captured yet. Network traffic will appear here in real-time.';
            }
        }
        tbody.innerHTML = '';

        if (groupEnabled) {
            var allTerms = [];
            includeFilters.forEach(function(f) {
                f.value.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean).forEach(function(term) {
                    allTerms.push({ term: term, field: f.field });
                });
            });
            allTerms.forEach(function(t) {
                var group = filtered.filter(function(r) {
                    return fieldValue(r, t.field).includes(t.term);
                });
                if (!group.length) return;
                var headerTr = document.createElement('tr');
                var headerTd = document.createElement('td');
                headerTd.colSpan = 6;
                var label = t.field === 'all' ? t.term : t.field.toUpperCase() + ': ' + t.term;
                headerTd.innerHTML = '<div class="group-header">' + esc(label) + ' <span class="group-count">(' + group.length + ')</span></div>';
                headerTr.appendChild(headerTd);
                headerTr.style.cursor = 'default';
                tbody.appendChild(headerTr);
                for (var i = group.length - 1; i >= 0; i--) {
                    tbody.appendChild(buildRow(group[i]));
                }
            });
        } else {
            for (var i = filtered.length - 1; i >= 0; i--) {
                tbody.appendChild(buildRow(filtered[i]));
            }
        }
    }

    function closeDetail() {
        selectedId = null;
        detailPane.classList.remove('open');
        detailPane.innerHTML = '';
        renderList();
    }

    function tryFormatJSONContent(s) {
        try {
            var obj = JSON.parse(s);
            return '<div class="json-tree">' + renderJSONNode(obj) + '</div>';
        } catch(_) {
            return '<pre>' + esc(s) + '</pre>';
        }
    }

    function renderJSONNode(obj, trailing) {
        var trail = trailing || '';
        if (typeof obj !== 'object' || obj === null) {
            if (typeof obj === 'string') return '<span class="json-val-str">"' + esc(obj) + '"</span>' + trail;
            if (typeof obj === 'number') return '<span class="json-val-num">' + obj + '</span>' + trail;
            if (typeof obj === 'boolean') return '<span class="json-val-bool">' + obj + '</span>' + trail;
            return '<span class="json-val-null">null</span>' + trail;
        }
        var isArray = Array.isArray(obj);
        var keys = Object.keys(obj);
        if (keys.length === 0) return (isArray ? '<span class="json-val-null">[]</span>' : '<span class="json-val-null">{}</span>') + trail;
        var bracket = isArray ? '[' : '{';
        var closeBracket = isArray ? ']' : '}';
        var html = '<details open><summary>' + bracket + ' <span style="opacity:0.4;font-size:11px">' + keys.length + (isArray ? ' items' : ' keys') + '</span></summary><div class="json-content">';
        keys.forEach(function(k, i) {
            var comma = i < keys.length - 1 ? ',' : '';
            var keyHtml = isArray ? '<span style="opacity:0.35">' + esc(k) + ': </span>' : '<span class="json-key">"' + esc(k) + '"</span>: ';
            html += '<div class="json-row">' + keyHtml + renderJSONNode(obj[k], comma) + '</div>';
        });
        html += '</div>' + closeBracket + trail + '</details>';
        return html;
    }

    function renderHeaderList(headers) {
        var html = '<div class="header-grid">';
        Object.keys(headers).forEach(function(k) {
            var vals = normalizeHeaderValues(headers[k]);
            vals.forEach(function(v) {
                html += '<div class="header-key">' + esc(k) + '</div><div class="header-val">' + esc(v) + '</div>';
            });
        });
        html += '</div>';
        return html;
    }

    function renderSection(title, content, rawData, opts) {
        var enc = encodeURIComponent(rawData || '');
        var hasJson = opts && opts.json;
        var collapsed = opts && opts.collapsed;
        var btnHtml = '<div class="section-actions">';
        if (hasJson) {
            btnHtml += '<button class="btn-sm btn-collapse-all" title="Collapse all">▶ Fold</button>';
            btnHtml += '<button class="btn-sm btn-expand-all" title="Expand all">▼ Unfold</button>';
        }
        btnHtml += '<button class="btn-sm btn-copy" data-copy="' + enc + '">Copy</button></div>';
        var cls = 'detail-section' + (collapsed ? ' collapsed' : '');
        return '<div class="' + cls + '">' +
               '<div class="detail-section-header"><h3><span class="chevron">▼</span>' + esc(title) + '</h3>' + btnHtml + '</div>' +
               '<div class="section-body">' + content + '</div></div>';
    }

    function buildCopyAllData(d) {
        var copy = {};
        for (var k in d) { if (d.hasOwnProperty(k)) copy[k] = d[k]; }
        try { if (typeof copy.requestBody === 'string') copy.requestBody = JSON.parse(copy.requestBody); } catch(_) {}
        try { if (typeof copy.responseBody === 'string') copy.responseBody = JSON.parse(copy.responseBody); } catch(_) {}
        return JSON.stringify(copy, null, 2);
    }

    function renderDetail(d) {
        if (!d) { detailPane.classList.remove('open'); return; }
        detailPane.classList.add('open');
        var allData = buildCopyAllData(d);
        let html = '<div class="detail-header"><h3>' + esc(d.method) + ' ' + esc(d.url) + '</h3>' +
                   '<div style="display:flex;align-items:center;gap:8px;">' +
                   '<button class="btn-sm" id="btnMockThis" title="Create mock rule from this request">Mock</button>' +
                   '<button class="btn-sm btn-copy" data-copy="' + encodeURIComponent(allData) + '">Copy All</button>' +
                   '<button class="detail-close" id="btnCloseDetail" title="Close detail panel">✕</button>' +
                   '</div></div>';
        html += '<div class="detail-section"><div class="detail-kv">';
        html += '<span class="k">Status</span><span>' + d.status + '</span>';
        html += '<span class="k">Duration</span><span>' + (d.duration != null ? Math.round(d.duration) + 'ms' : 'pending') + '</span>';
        html += '<span class="k">Size</span><span>' + formatBytes(d.size||0) + '</span>';
        html += '<span class="k">MIME</span><span>' + esc(d.mimeType||'') + '</span>';
        html += '<span class="k">Host</span><span>' + esc(d.host||'') + '</span>';
        if (d.hostMapped) {
            html += '<span class="k">DNS Mapped</span><span style="color:#9c27b0">→ ' + esc(d.resolvedIP||'') + '</span>';
            if (d.matchedGroupTitle) html += '<span class="k">Group</span><span>' + esc(d.matchedGroupTitle) + '</span>';
        }
        if (d.source) html += '<span class="k">Source</span><span>' + esc(d.source) + '</span>';
        if (d.primaryIP) html += '<span class="k">Remote IP</span><span>' + esc(d.primaryIP) + (d.primaryPort ? ':' + esc(d.primaryPort) : '') + '</span>';
        if (d.localIP) html += '<span class="k">Local IP</span><span>' + esc(d.localIP) + (d.localPort ? ':' + esc(d.localPort) : '') + '</span>';
        if (d.redirectCount != null) html += '<span class="k">Redirects</span><span>' + esc(d.redirectCount) + '</span>';
        if (d.requestSize != null) html += '<span class="k">Request Bytes</span><span>' + formatBytes(Number(d.requestSize) || 0) + '</span>';
        if (d.headerSize != null) html += '<span class="k">Header Bytes</span><span>' + formatBytes(Number(d.headerSize) || 0) + '</span>';
        if (d.sslVerifyResult != null) html += '<span class="k">SSL Verify</span><span>' + (Number(d.sslVerifyResult) === 0 ? 'OK (0)' : esc(d.sslVerifyResult)) + '</span>';
        if (d.error) html += '<span class="k">Error</span><span style="color:#f44336">' + esc(d.error) + '</span>';
        html += '</div></div>';
        var queryParams = parseQueryParams(d.url);
        if (queryParams.length) {
            var rawQs = JSON.stringify(queryParams.reduce(function(o, p) { o[p.key] = p.value; return o; }, {}), null, 2);
            html += renderSection('Query Parameters (' + queryParams.length + ')', renderQueryParams(queryParams), rawQs);
        }
        const requestCookies = collectRequestCookies(d);
        const responseCookies = collectResponseCookies(d);
        if (requestCookies.length) {
            html += renderSection('Request Cookies', renderCookieList(requestCookies), JSON.stringify(cookiesToObj(requestCookies), null, 2), {collapsed: true});
        }
        if (responseCookies.length) {
            html += renderSection('Response Cookies', renderCookieList(responseCookies), JSON.stringify(cookiesToObj(responseCookies), null, 2), {collapsed: true});
        }
        const requestHeadersForDisplay = filterHeadersForDisplay(d.requestHeaders, requestCookies.length ? ['cookie'] : []);
        const responseHeadersForDisplay = filterHeadersForDisplay(d.responseHeaders, responseCookies.length ? ['set-cookie'] : []);
        if (requestHeadersForDisplay && Object.keys(requestHeadersForDisplay).length) {
            var rawHeaders = JSON.stringify(requestHeadersForDisplay, null, 2);
            html += renderSection('Request Headers', renderHeaderList(requestHeadersForDisplay), rawHeaders, {collapsed: true});
        }
        if (d.requestBody) {
            var isReqJson = false;
            try { JSON.parse(d.requestBody); isReqJson = true; } catch(_) {}
            html += renderSection('Request Body', tryFormatJSONContent(d.requestBody), d.requestBody, isReqJson ? {json:true} : null);
        }
        if (responseHeadersForDisplay && Object.keys(responseHeadersForDisplay).length) {
            var rawHeaders = JSON.stringify(responseHeadersForDisplay, null, 2);
            html += renderSection('Response Headers', renderHeaderList(responseHeadersForDisplay), rawHeaders, {collapsed: true});
        }
        if (d.responseBody) {
            var isResJson = false;
            try { JSON.parse(d.responseBody); isResJson = true; } catch(_) {}
            html += renderSection('Response Body', tryFormatJSONContent(d.responseBody), d.responseBody, isResJson ? {json:true} : null);
        }
        const isCurlSource = typeof d.source === 'string' && d.source.toLowerCase().includes('curl');
        const hasStructuredDetail = (!!d.requestBody)
            || (!!d.responseBody)
            || (d.requestHeaders && Object.keys(d.requestHeaders).length)
            || (d.responseHeaders && Object.keys(d.responseHeaders).length);
        if (isCurlSource && !hasStructuredDetail) {
            html += '<div class="detail-section"><h3>Detail Availability</h3><pre>Current libcurl hook captures summary fields (URL/status/duration/size/MIME).' + '\\n' + 'Request/response headers and body are not captured in this mode.</pre></div>';
        }
        detailPane.innerHTML = html;
        var closeBtn = document.getElementById('btnCloseDetail');
        if (closeBtn) { closeBtn.addEventListener('click', function() { closeDetail(); }); }
        
        detailPane.querySelectorAll('.btn-copy').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var text = decodeURIComponent(this.getAttribute('data-copy') || '');
                navigator.clipboard.writeText(text).then(function() {
                    var oldText = btn.innerText;
                    btn.innerText = 'Copied!';
                    setTimeout(function() { btn.innerText = oldText; }, 1500);
                });
            });
        });
        detailPane.querySelectorAll('.btn-collapse-all').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var body = btn.closest('.detail-section').querySelector('.section-body');
                if (body) body.querySelectorAll('details').forEach(function(d) { d.open = false; });
            });
        });
        detailPane.querySelectorAll('.btn-expand-all').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var body = btn.closest('.detail-section').querySelector('.section-body');
                if (body) body.querySelectorAll('details').forEach(function(d) { d.open = true; });
            });
        });
        var mockBtn = document.getElementById('btnMockThis');
        if (mockBtn) {
            mockBtn.addEventListener('click', function() {
                vscode.postMessage({ command: 'mockRequest', detail: d });
            });
        }
        detailPane.querySelectorAll('.detail-section-header').forEach(function(header) {
            header.addEventListener('click', function(e) {
                if (e.target.closest('.section-actions')) return;
                var section = header.closest('.detail-section');
                if (section) section.classList.toggle('collapsed');
            });
        });
    }

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function formatBytes(b) { if (b < 1024) return b + 'B'; if (b < 1048576) return (b/1024).toFixed(1) + 'KB'; return (b/1048576).toFixed(1) + 'MB'; }
    function splitCookieHeader(v) { return String(v||'').split(';').map(function(x){ return x.trim(); }).filter(Boolean); }
    function normalizeHeaderValues(v) { if (Array.isArray(v)) return v.map(String); if (v == null) return []; return [String(v)]; }
    function getHeaderValuesCaseInsensitive(headers, name) {
        if (!headers || typeof headers !== 'object') return [];
        const target = String(name || '').toLowerCase();
        const out = [];
        Object.keys(headers).forEach(function(k) {
            if (String(k).toLowerCase() === target) {
                normalizeHeaderValues(headers[k]).forEach(function(v) { out.push(v); });
            }
        });
        return out;
    }
    function filterHeadersForDisplay(headers, hiddenNames) {
        if (!headers || typeof headers !== 'object') return headers;
        if (!Array.isArray(hiddenNames) || hiddenNames.length === 0) return headers;
        const hiddenSet = new Set(hiddenNames.map(function(name){ return String(name || '').toLowerCase(); }));
        const filtered = {};
        Object.keys(headers).forEach(function(k) {
            if (!hiddenSet.has(String(k).toLowerCase())) {
                filtered[k] = headers[k];
            }
        });
        return filtered;
    }
    function collectRequestCookies(d) {
        const set = new Set();
        if (Array.isArray(d.cookies)) d.cookies.forEach(function(c){ if (c) set.add(String(c)); });
        getHeaderValuesCaseInsensitive(d.requestHeaders, 'cookie').forEach(function(v){
            splitCookieHeader(v).forEach(function(c){ set.add(c); });
        });
        return Array.from(set);
    }
    function collectResponseCookies(d) {
        const set = new Set();
        getHeaderValuesCaseInsensitive(d.responseHeaders, 'set-cookie').forEach(function(c){ if (c) set.add(c); });
        return Array.from(set);
    }
    function cookiesToObj(items) {
        var obj = {};
        items.forEach(function(item) {
            var eq = String(item).indexOf('=');
            if (eq > 0) { obj[String(item).substring(0, eq)] = String(item).substring(eq + 1); }
            else { obj[String(item)] = ''; }
        });
        return obj;
    }
    function renderCookieList(items) {
        var html = '<div class="header-grid">';
        items.forEach(function(item) {
            var eq = String(item).indexOf('=');
            if (eq > 0) {
                html += '<div class="header-key">' + esc(String(item).substring(0, eq)) + '</div><div class="header-val">' + esc(String(item).substring(eq + 1)) + '</div>';
            } else {
                html += '<div class="header-key"></div><div class="header-val">' + esc(item) + '</div>';
            }
        });
        html += '</div>';
        return html;
    }

    function parseQueryParams(url) {
        try {
            var qIdx = String(url || '').indexOf('?');
            if (qIdx < 0) return [];
            var qs = String(url).substring(qIdx + 1);
            var hashIdx = qs.indexOf('#');
            if (hashIdx >= 0) qs = qs.substring(0, hashIdx);
            if (!qs) return [];
            return qs.split('&').map(function(pair) {
                var eq = pair.indexOf('=');
                if (eq < 0) return { key: decodeURIComponent(pair), value: '' };
                return { key: decodeURIComponent(pair.substring(0, eq)), value: decodeURIComponent(pair.substring(eq + 1)) };
            });
        } catch(_) { return []; }
    }

    function renderQueryParams(params) {
        var html = '<div class="header-grid">';
        params.forEach(function(p) {
            html += '<div class="header-key">' + esc(p.key) + '</div><div class="header-val">' + esc(p.value) + '</div>';
        });
        html += '</div>';
        return html;
    }

    var _retryRefreshCount = 0;
    var _retryRefreshTimer = setInterval(function() {
        if (allRequests.length > 0 || _retryRefreshCount >= 5) {
            clearInterval(_retryRefreshTimer);
            return;
        }
        _retryRefreshCount++;
        vscode.postMessage({ command: 'refresh' });
    }, 2000);
})();
</script>
<script nonce="${nonce}">
${OVERLAY_JS}
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
