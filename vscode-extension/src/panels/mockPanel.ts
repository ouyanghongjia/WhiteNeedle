import * as vscode from 'vscode';
import { DeviceManager, ConnectionState } from '../device/deviceManager';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

export class MockPanel {
    public static currentPanel: MockPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, deviceManager: DeviceManager): void {
        if (MockPanel.currentPanel) {
            MockPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'whiteneedleMock',
            'HTTP Mock Rules',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        MockPanel.currentPanel = new MockPanel(panel, deviceManager);
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager) {
        this.panel = panel;
        this.deviceManager = deviceManager;

        this.panel.webview.html = this.getHtmlContent();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'refresh': await this.refresh(); break;
                case 'addRule': await this.addRule(msg.rule); break;
                case 'updateRule': await this.updateRule(msg.ruleId, msg.updates); break;
                case 'removeRule': await this.removeRule(msg.ruleId); break;
                case 'removeAll': await this.removeAll(); break;
                case 'toggleInterceptor': await this.toggleInterceptor(msg.enabled); break;
            }
        }, null, this.disposables);

        const onStateChanged = (s: ConnectionState) => {
            if (s === 'connected') { this.refresh(); }
        };
        this.deviceManager.on('stateChanged', onStateChanged);
        this.disposables.push(new vscode.Disposable(() => {
            this.deviceManager.removeListener('stateChanged', onStateChanged);
        }));

        bindConnectionState(this.panel, this.deviceManager, this.disposables);
        this.refresh();
    }

    private async refresh(): Promise<void> {
        try {
            const [rules, status] = await Promise.all([
                this.deviceManager.listMockRules(),
                this.deviceManager.getMockInterceptorStatus(),
            ]);
            this.panel.webview.postMessage({ command: 'setState', rules, status });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async addRule(rule: Record<string, unknown>): Promise<void> {
        try {
            await this.deviceManager.addMockRule(rule);
            await this.refresh();
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async updateRule(ruleId: string, updates: Record<string, unknown>): Promise<void> {
        try {
            await this.deviceManager.updateMockRule(ruleId, updates);
            await this.refresh();
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async removeRule(ruleId: string): Promise<void> {
        try {
            await this.deviceManager.removeMockRule(ruleId);
            await this.refresh();
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async removeAll(): Promise<void> {
        try {
            await this.deviceManager.removeAllMockRules();
            await this.refresh();
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async toggleInterceptor(enabled: boolean): Promise<void> {
        try {
            if (enabled) {
                await this.deviceManager.enableMockInterceptor();
            } else {
                await this.deviceManager.disableMockInterceptor();
            }
            await this.refresh();
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private dispose(): void {
        MockPanel.currentPanel = undefined;
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
:root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground); --border: var(--vscode-panel-border); --hover: var(--vscode-list-hoverBackground); --accent: var(--vscode-textLink-foreground); --badge-bg: var(--vscode-badge-background); --badge-fg: var(--vscode-badge-foreground); --input-bg: var(--vscode-input-background); --input-fg: var(--vscode-input-foreground); --input-border: var(--vscode-input-border); --error: #f44336; --success: #4caf50; --warn: #ff9800; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); }

.toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.toolbar button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { opacity: 0.85; }
.toolbar button.danger { background: var(--error); color: white; }
.toolbar label { font-size: 12px; display: flex; align-items: center; gap: 4px; }
.toolbar .spacer { flex: 1; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
.status-dot.on { background: var(--success); }
.status-dot.off { background: #999; }
.status-text { font-size: 11px; opacity: 0.8; }

.content { padding: 0; }

/* Add Rule Form */
.add-form { padding: 12px; border-bottom: 1px solid var(--border); background: var(--vscode-editorGroupHeader-tabsBackground); display: none; }
.add-form.open { display: block; }
.form-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }
.form-row label { font-size: 12px; font-weight: 600; min-width: 80px; }
.form-row input, .form-row select, .form-row textarea { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 4px 8px; border-radius: 3px; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
.form-row input { flex: 1; min-width: 200px; }
.form-row select { min-width: 140px; }
.form-row textarea { flex: 1; min-width: 200px; min-height: 60px; resize: vertical; }
.form-actions { display: flex; gap: 8px; margin-top: 4px; }
.form-actions button { padding: 5px 14px; border-radius: 3px; cursor: pointer; font-size: 12px; border: none; }
.btn-primary { background: var(--accent); color: white; }
.btn-secondary { background: var(--badge-bg); color: var(--badge-fg); }

/* Rule List */
.rule-list { padding: 0; }
.rule-card { border-bottom: 1px solid var(--border); padding: 10px 12px; }
.rule-card:hover { background: var(--hover); }
.rule-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.rule-url { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rule-meta { display: flex; gap: 8px; font-size: 11px; opacity: 0.7; align-items: center; flex-wrap: wrap; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.badge-method { background: #2196f3; color: white; }
.badge-mode-pure { background: #9c27b0; color: white; }
.badge-mode-rewrite { background: var(--warn); color: white; }
.badge-status { background: var(--badge-bg); color: var(--badge-fg); }
.badge-disabled { background: #666; color: #ccc; }
.badge-delay { background: #607d8b; color: white; }
.rule-actions { display: flex; gap: 4px; }
.rule-actions button { background: none; border: 1px solid var(--border); color: var(--fg); padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
.rule-actions button:hover { background: var(--hover); }
.rule-actions button.danger:hover { background: var(--error); color: white; border-color: var(--error); }
.rule-body-preview { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; background: var(--vscode-textCodeBlock-background); padding: 4px 8px; border-radius: 3px; margin-top: 4px; max-height: 80px; overflow: hidden; white-space: pre-wrap; word-break: break-all; opacity: 0.8; }

.empty { text-align: center; padding: 48px 20px; opacity: 0.5; }
.empty p { margin-top: 8px; font-size: 12px; }

.toast { position: fixed; bottom: 16px; right: 16px; background: var(--error); color: white; padding: 8px 16px; border-radius: 4px; font-size: 12px; z-index: 999; display: none; }
.toast.visible { display: block; }
${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}
<div class="toolbar">
    <button id="btnAdd">+ Add Rule</button>
    <button id="btnRefresh">↻ Refresh</button>
    <button id="btnClearAll" class="danger">✕ Clear All</button>
    <span class="spacer"></span>
    <span class="status-dot off" id="statusDot"></span>
    <span class="status-text" id="statusText">Interceptor off</span>
    <label><input type="checkbox" id="chkInterceptor"> Enable Interceptor</label>
</div>

<div class="add-form" id="addForm">
    <div class="form-row">
        <label>URL Pattern</label>
        <input id="fUrlPattern" placeholder="e.g. api/v2/order  or  regex:order/\\d+">
    </div>
    <div class="form-row">
        <label>Method</label>
        <select id="fMethod">
            <option value="*">Any (*)</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
        </select>
        <label style="min-width:auto">Mode</label>
        <select id="fMode">
            <option value="pureMock">Pure Mock</option>
            <option value="rewriteResponse">Rewrite Response</option>
        </select>
    </div>
    <div class="form-row">
        <label>Status Code</label>
        <input id="fStatus" type="number" value="200" style="max-width:80px; min-width:80px; flex:none">
        <label style="min-width:auto">Delay (s)</label>
        <input id="fDelay" type="number" value="0" step="0.1" style="max-width:80px; min-width:80px; flex:none">
    </div>
    <div class="form-row">
        <label>Headers</label>
        <input id="fHeaders" placeholder='{"Content-Type":"application/json"}'>
    </div>
    <div class="form-row">
        <label>Body</label>
        <textarea id="fBody" placeholder='{"code":0,"data":{}}'></textarea>
    </div>
    <div class="form-actions">
        <button class="btn-primary" id="btnSubmitRule">Add Rule</button>
        <button class="btn-secondary" id="btnCancelAdd">Cancel</button>
    </div>
</div>

<div class="content">
    <div class="rule-list" id="ruleList"></div>
    <div class="empty" id="emptyMsg">
        <div style="font-size:32px; opacity:0.4">🎭</div>
        <p>No mock rules configured.<br>Click <b>+ Add Rule</b> to create one.</p>
    </div>
</div>

<div class="toast" id="toast"></div>

<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    let rules = [];
    let interceptorOn = false;
    let editingId = null;

    const addForm = document.getElementById('addForm');
    const ruleList = document.getElementById('ruleList');
    const emptyMsg = document.getElementById('emptyMsg');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const chkInterceptor = document.getElementById('chkInterceptor');
    const toast = document.getElementById('toast');

    document.getElementById('btnAdd').addEventListener('click', () => {
        editingId = null;
        clearForm();
        document.getElementById('btnSubmitRule').textContent = 'Add Rule';
        addForm.classList.toggle('open');
    });
    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
    document.getElementById('btnClearAll').addEventListener('click', () => {
        if (rules.length === 0) return;
        vscode.postMessage({ command: 'removeAll' });
    });
    document.getElementById('btnCancelAdd').addEventListener('click', () => {
        addForm.classList.remove('open');
        editingId = null;
    });
    chkInterceptor.addEventListener('change', (e) => {
        vscode.postMessage({ command: 'toggleInterceptor', enabled: e.target.checked });
    });

    document.getElementById('btnSubmitRule').addEventListener('click', () => {
        const urlPattern = document.getElementById('fUrlPattern').value.trim();
        if (!urlPattern) { showToast('URL Pattern is required'); return; }

        const rule = {
            urlPattern,
            method: document.getElementById('fMethod').value,
            mode: document.getElementById('fMode').value,
            statusCode: parseInt(document.getElementById('fStatus').value) || 200,
            delay: parseFloat(document.getElementById('fDelay').value) || 0,
            responseBody: document.getElementById('fBody').value,
        };

        const headersStr = document.getElementById('fHeaders').value.trim();
        if (headersStr) {
            try { rule.responseHeaders = JSON.parse(headersStr); }
            catch (_) { showToast('Invalid JSON in Headers'); return; }
        }

        if (editingId) {
            vscode.postMessage({ command: 'updateRule', ruleId: editingId, updates: rule });
        } else {
            vscode.postMessage({ command: 'addRule', rule });
        }
        addForm.classList.remove('open');
        editingId = null;
    });

    window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.command === 'setState') {
            rules = msg.rules || [];
            interceptorOn = msg.status?.installed ?? false;
            chkInterceptor.checked = interceptorOn;
            updateStatus();
            renderRules();
        } else if (msg.command === 'error') {
            showToast(msg.message);
        }
    });

    function updateStatus() {
        statusDot.className = 'status-dot ' + (interceptorOn ? 'on' : 'off');
        statusText.textContent = interceptorOn
            ? 'Interceptor ON · ' + rules.length + ' rule(s)'
            : 'Interceptor off';
    }

    function renderRules() {
        emptyMsg.style.display = rules.length ? 'none' : 'block';
        ruleList.innerHTML = '';
        for (const r of rules) {
            const card = document.createElement('div');
            card.className = 'rule-card';

            const modeLabel = r.mode === 'rewriteResponse' ? 'Rewrite' : 'Pure Mock';
            const modeCls = r.mode === 'rewriteResponse' ? 'badge-mode-rewrite' : 'badge-mode-pure';
            const enabledBadge = r.enabled === false ? ' <span class="badge badge-disabled">disabled</span>' : '';
            const delayBadge = r.delay > 0 ? ' <span class="badge badge-delay">' + r.delay + 's</span>' : '';

            let html = '<div class="rule-header">';
            html += '<span class="rule-url" title="' + esc(r.urlPattern) + '">' + esc(r.urlPattern) + '</span>';
            html += '<div class="rule-actions">';
            html += '<button class="btn-edit" data-id="' + esc(r.id) + '">' + (r.enabled === false ? '▶ Enable' : '⏸ Disable') + '</button>';
            html += '<button class="btn-edit-form" data-id="' + esc(r.id) + '">✎ Edit</button>';
            html += '<button class="danger btn-remove" data-id="' + esc(r.id) + '">✕</button>';
            html += '</div></div>';
            html += '<div class="rule-meta">';
            html += '<span class="badge badge-method">' + esc(r.method || '*') + '</span>';
            html += '<span class="badge ' + modeCls + '">' + modeLabel + '</span>';
            html += '<span class="badge badge-status">' + (r.statusCode || 200) + '</span>';
            html += enabledBadge + delayBadge;
            html += '</div>';

            if (r.responseBody) {
                const preview = r.responseBody.length > 200 ? r.responseBody.substring(0, 200) + '...' : r.responseBody;
                html += '<div class="rule-body-preview">' + esc(tryFormat(preview)) + '</div>';
            }

            card.innerHTML = html;

            card.querySelector('.btn-edit').addEventListener('click', () => {
                const newEnabled = r.enabled === false;
                vscode.postMessage({ command: 'updateRule', ruleId: r.id, updates: { enabled: newEnabled } });
            });
            card.querySelector('.btn-edit-form').addEventListener('click', () => {
                editingId = r.id;
                document.getElementById('fUrlPattern').value = r.urlPattern || '';
                document.getElementById('fMethod').value = r.method || '*';
                document.getElementById('fMode').value = r.mode || 'pureMock';
                document.getElementById('fStatus').value = r.statusCode || 200;
                document.getElementById('fDelay').value = r.delay || 0;
                document.getElementById('fHeaders').value = r.responseHeaders ? JSON.stringify(r.responseHeaders) : '';
                document.getElementById('fBody').value = r.responseBody || '';
                document.getElementById('btnSubmitRule').textContent = 'Update Rule';
                addForm.classList.add('open');
            });
            card.querySelector('.btn-remove').addEventListener('click', () => {
                vscode.postMessage({ command: 'removeRule', ruleId: r.id });
            });

            ruleList.appendChild(card);
        }
    }

    function clearForm() {
        document.getElementById('fUrlPattern').value = '';
        document.getElementById('fMethod').value = '*';
        document.getElementById('fMode').value = 'pureMock';
        document.getElementById('fStatus').value = '200';
        document.getElementById('fDelay').value = '0';
        document.getElementById('fHeaders').value = '';
        document.getElementById('fBody').value = '';
    }

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 3000);
    }

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function tryFormat(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch(_) { return s; } }
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
