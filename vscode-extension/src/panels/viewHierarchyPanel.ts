import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

export class ViewHierarchyPanel {
    public static currentPanel: ViewHierarchyPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, deviceManager: DeviceManager): void {
        if (ViewHierarchyPanel.currentPanel) {
            ViewHierarchyPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'whiteneedleViewHierarchy',
            'View Hierarchy',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ViewHierarchyPanel.currentPanel = new ViewHierarchyPanel(panel, deviceManager);
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager) {
        this.panel = panel;
        this.deviceManager = deviceManager;

        this.panel.webview.html = this.getHtmlContent();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'loadTree':
                    await this.loadTree();
                    break;
                case 'loadControllers':
                    await this.loadControllers();
                    break;
                case 'getDetail':
                    await this.loadDetail(msg.address);
                    break;
                case 'highlight':
                    await this.deviceManager.highlightView(msg.address);
                    break;
                case 'clearHighlight':
                    await this.deviceManager.clearHighlight();
                    break;
                case 'setProperty':
                    await this.setProperty(msg.address, msg.key, msg.value);
                    break;
                case 'requestSetProperty': {
                    const val = await vscode.window.showInputBox({
                        prompt: `Set ${msg.key} for ${msg.address}`,
                        value: String(msg.currentValue ?? ''),
                    });
                    if (val !== undefined) {
                        let parsed: any = val;
                        if (val === 'true') { parsed = true; }
                        else if (val === 'false') { parsed = false; }
                        else if (!isNaN(Number(val)) && val !== '') { parsed = Number(val); }
                        await this.setProperty(msg.address, msg.key, parsed);
                    }
                    break;
                }
                case 'search':
                    await this.searchViews(msg.className);
                    break;
                case 'screenshot':
                    await this.loadScreenshot();
                    break;
            }
        }, null, this.disposables);

        this.loadTree();
    }

    private async loadTree(): Promise<void> {
        try {
            const tree = await this.deviceManager.getViewHierarchy();
            this.panel.webview.postMessage({ command: 'setTree', tree });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async loadControllers(): Promise<void> {
        try {
            const controllers = await this.deviceManager.getViewControllers();
            this.panel.webview.postMessage({ command: 'setControllers', controllers });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async loadDetail(address: string): Promise<void> {
        try {
            const detail = await this.deviceManager.getViewDetail(address);
            this.panel.webview.postMessage({ command: 'showDetail', detail });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async setProperty(address: string, key: string, value: any): Promise<void> {
        try {
            const ok = await this.deviceManager.setViewProperty(address, key, value);
            if (ok) {
                await this.loadDetail(address);
                vscode.window.showInformationMessage(`Set ${key} = ${value}`);
            } else {
                vscode.window.showWarningMessage(`Failed to set ${key}`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(err.message);
        }
    }

    private async searchViews(className: string): Promise<void> {
        try {
            const views = await this.deviceManager.searchViews(className);
            this.panel.webview.postMessage({ command: 'searchResults', views });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private async loadScreenshot(): Promise<void> {
        try {
            const b64 = await this.deviceManager.getScreenshot();
            this.panel.webview.postMessage({ command: 'screenshot', base64: b64 });
        } catch (err: any) {
            this.panel.webview.postMessage({ command: 'error', message: err.message });
        }
    }

    private dispose(): void {
        ViewHierarchyPanel.currentPanel = undefined;
        this.disposables.forEach(d => d.dispose());
        this.panel.dispose();
    }

    private getHtmlContent(): string {
        const nonce = getNonce();
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
<style>
:root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground); --border: var(--vscode-panel-border); --hover: var(--vscode-list-hoverBackground); --accent: var(--vscode-textLink-foreground); --badge-bg: var(--vscode-badge-background); --badge-fg: var(--vscode-badge-foreground); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); }
.toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.toolbar button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { opacity: 0.85; }
.search-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 8px; border-radius: 3px; font-size: 12px; width: 180px; }
.tab-bar { display: flex; border-bottom: 1px solid var(--border); }
.tab-bar button { background: none; border: none; color: var(--fg); padding: 6px 14px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; }
.tab-bar button.active { border-bottom-color: var(--accent); color: var(--accent); }
.split { display: flex; height: calc(100vh - 82px); }
.tree-pane { flex: 1; overflow: auto; border-right: 1px solid var(--border); min-width: 320px; font-size: 12px; }
.detail-pane { width: 360px; overflow-y: auto; padding: 10px; display: none; }
.detail-pane.open { display: block; }
.tree-node { padding: 2px 0; }
.tree-row { display: flex; align-items: center; padding: 2px 4px; cursor: pointer; border-radius: 3px; white-space: nowrap; }
.tree-row:hover { background: var(--hover); }
.tree-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.tree-toggle { width: 16px; text-align: center; flex-shrink: 0; user-select: none; cursor: pointer; }
.tree-cls { color: var(--accent); font-weight: 600; }
.tree-addr { opacity: 0.5; margin-left: 6px; font-size: 11px; }
.tree-info { opacity: 0.7; margin-left: 6px; font-size: 11px; }
.tree-hidden { opacity: 0.35; }
.tree-children { padding-left: 16px; }
.detail-header { display: flex; align-items: center; justify-content: space-between; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.detail-header .dh-title { flex: 1; min-width: 0; }
.detail-header .dh-title h3 { font-size: 13px; color: var(--accent); }
.detail-header .dh-title span { font-size: 11px; opacity: 0.5; }
.detail-close { background: none; border: none; color: var(--fg); font-size: 18px; cursor: pointer; padding: 2px 6px; border-radius: 3px; opacity: 0.7; flex-shrink: 0; }
.detail-close:hover { opacity: 1; background: var(--hover); }
.detail-section { margin-bottom: 12px; }
.detail-section h3 { font-size: 13px; margin-bottom: 4px; color: var(--accent); }
.prop-grid { display: grid; grid-template-columns: 130px 1fr 24px; gap: 2px 6px; font-size: 12px; align-items: center; }
.prop-grid .k { font-weight: 600; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; }
.prop-grid .v { overflow: hidden; text-overflow: ellipsis; }
.prop-grid .edit-btn { background: none; border: none; cursor: pointer; color: var(--accent); font-size: 14px; padding: 0; }
.vc-list { font-size: 12px; }
.vc-item { padding: 3px 8px; border-bottom: 1px solid var(--border); }
.vc-item .depth { opacity: 0.4; }
.search-results .sr-item { padding: 4px 8px; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 12px; }
.search-results .sr-item:hover { background: var(--hover); }
.screenshot-container { text-align: center; padding: 10px; }
.screenshot-container img { max-width: 100%; border: 1px solid var(--border); border-radius: 4px; }
.empty { text-align: center; padding: 40px; opacity: 0.5; }
</style>
</head>
<body>
<div class="toolbar">
  <button id="btnRefresh">↻ Refresh</button>
  <button id="btnScreenshot">📷 Screenshot</button>
  <button id="btnClearHL">Clear Highlight</button>
  <input id="searchInput" class="search-input" placeholder="Search views by class...">
  <button id="btnSearch">Search</button>
</div>
<div class="tab-bar">
  <button class="active" data-tab="tree">View Tree</button>
  <button data-tab="controllers">View Controllers</button>
  <button data-tab="search">Search Results</button>
  <button data-tab="screenshot">Screenshot</button>
</div>
<div class="split">
  <div class="tree-pane" id="treePane">
    <div id="treeContent" class="empty">Click Refresh to load view hierarchy.</div>
    <div id="vcContent" style="display:none"></div>
    <div id="searchContent" style="display:none"></div>
    <div id="screenshotContent" style="display:none" class="screenshot-container"></div>
  </div>
  <div class="detail-pane" id="detailPane"></div>
</div>
<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    let selectedAddr = null;
    let currentTab = 'tree';
    const EDITABLE_KEYS = ['hidden','alpha','backgroundColor','frame','clipsToBounds','layer.cornerRadius','layer.borderWidth','text'];

    document.getElementById('btnRefresh').addEventListener('click', () => {
        if (currentTab === 'controllers') vscode.postMessage({command:'loadControllers'});
        else vscode.postMessage({command:'loadTree'});
    });
    document.getElementById('btnScreenshot').addEventListener('click', () => { switchTab('screenshot'); vscode.postMessage({command:'screenshot'}); });
    document.getElementById('btnClearHL').addEventListener('click', () => vscode.postMessage({command:'clearHighlight'}));
    document.getElementById('btnSearch').addEventListener('click', () => {
        const v = document.getElementById('searchInput').value.trim();
        if (v) { switchTab('search'); vscode.postMessage({command:'search', className:v}); }
    });
    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btnSearch').click();
    });

    document.querySelectorAll('.tab-bar button').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
            if (btn.dataset.tab === 'controllers') vscode.postMessage({command:'loadControllers'});
        });
    });

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.getElementById('treeContent').style.display = tab === 'tree' ? '' : 'none';
        document.getElementById('vcContent').style.display = tab === 'controllers' ? '' : 'none';
        document.getElementById('searchContent').style.display = tab === 'search' ? '' : 'none';
        document.getElementById('screenshotContent').style.display = tab === 'screenshot' ? '' : 'none';
    }

    window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.command === 'setTree') renderTree(msg.tree);
        else if (msg.command === 'setControllers') renderControllers(msg.controllers);
        else if (msg.command === 'showDetail') renderDetail(msg.detail);
        else if (msg.command === 'searchResults') renderSearchResults(msg.views);
        else if (msg.command === 'screenshot') renderScreenshot(msg.base64);
    });

    function renderTree(tree) {
        const el = document.getElementById('treeContent');
        if (!tree || !tree.class) { el.innerHTML = '<div class="empty">No view hierarchy data.</div>'; return; }
        el.innerHTML = '';
        el.appendChild(buildTreeNode(tree, true));
    }

    function buildTreeNode(node, expanded) {
        const div = document.createElement('div');
        div.className = 'tree-node';

        const row = document.createElement('div');
        row.className = 'tree-row' + (node.hidden ? ' tree-hidden' : '');
        if (node.address === selectedAddr) row.classList.add('selected');

        const hasSubs = node.subviews && node.subviews.length > 0;
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        toggle.textContent = hasSubs ? (expanded ? '▾' : '▸') : ' ';

        const cls = document.createElement('span');
        cls.className = 'tree-cls';
        cls.textContent = node.class;

        const addr = document.createElement('span');
        addr.className = 'tree-addr';
        addr.textContent = node.address;

        let infoText = '';
        if (node.text) infoText = '"' + node.text.substring(0, 30) + '"';
        else if (node.title) infoText = '"' + node.title.substring(0, 30) + '"';
        else infoText = node.frame || '';
        const info = document.createElement('span');
        info.className = 'tree-info';
        info.textContent = infoText;

        row.appendChild(toggle);
        row.appendChild(cls);
        row.appendChild(addr);
        row.appendChild(info);
        div.appendChild(row);

        let childContainer = null;
        if (hasSubs) {
            childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            childContainer.style.display = expanded ? '' : 'none';
            for (const sub of node.subviews) {
                childContainer.appendChild(buildTreeNode(sub, false));
            }
            div.appendChild(childContainer);
        }

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!childContainer) return;
            const open = childContainer.style.display !== 'none';
            childContainer.style.display = open ? 'none' : '';
            toggle.textContent = open ? '▸' : '▾';
        });

        row.addEventListener('click', () => {
            if (selectedAddr === node.address) {
                closeDetail();
                vscode.postMessage({command:'clearHighlight'});
                return;
            }
            selectedAddr = node.address;
            document.querySelectorAll('.tree-row.selected').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            vscode.postMessage({command:'getDetail', address:node.address});
            vscode.postMessage({command:'highlight', address:node.address});
        });

        return div;
    }

    function renderControllers(controllers) {
        const el = document.getElementById('vcContent');
        if (!controllers || !controllers.length) { el.innerHTML = '<div class="empty">No view controllers.</div>'; return; }
        el.innerHTML = '<div class="vc-list">' + controllers.map(vc =>
            '<div class="vc-item"><span class="depth">' + '  '.repeat(vc.depth || 0) + '</span><span class="tree-cls">' + esc(vc.class) + '</span> <span class="tree-addr">' + esc(vc.address) + '</span>' + (vc.title ? ' "' + esc(vc.title) + '"' : '') + '</div>'
        ).join('') + '</div>';
    }

    function closeDetail() {
        selectedAddr = null;
        var pane = document.getElementById('detailPane');
        pane.classList.remove('open');
        pane.innerHTML = '';
        document.querySelectorAll('.tree-row.selected').forEach(function(r) { r.classList.remove('selected'); });
    }

    function renderDetail(d) {
        const pane = document.getElementById('detailPane');
        if (!d) { pane.classList.remove('open'); return; }
        pane.classList.add('open');
        let html = '<div class="detail-header"><div class="dh-title"><h3>' + esc(d.class) + '</h3><span>' + esc(d.address) + '</span></div><button class="detail-close" id="btnCloseVHDetail" title="Close detail panel">✕</button></div>';
        html += '<div class="detail-section"><h3>Properties</h3><div class="prop-grid">';
        const keys = Object.keys(d).filter(k => k !== 'class' && k !== 'address');
        for (const k of keys) {
            const editable = EDITABLE_KEYS.includes(k);
            html += '<span class="k">' + esc(k) + '</span><span class="v">' + esc(String(d[k])) + '</span>';
            if (editable) {
                html += '<button class="edit-btn" data-key="' + esc(k) + '" data-val="' + esc(String(d[k])) + '">✎</button>';
            } else {
                html += '<span></span>';
            }
        }
        html += '</div></div>';
        pane.innerHTML = html;

        pane.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                vscode.postMessage({ command: 'requestSetProperty', address: d.address, key: btn.dataset.key, currentValue: btn.dataset.val });
            });
        });
        var closeBtn = document.getElementById('btnCloseVHDetail');
        if (closeBtn) { closeBtn.addEventListener('click', function() { closeDetail(); }); }
    }

    function renderSearchResults(views) {
        const el = document.getElementById('searchContent');
        if (!views || !views.length) { el.innerHTML = '<div class="empty">No views found.</div>'; return; }
        el.innerHTML = '<div class="search-results">' + views.map(v =>
            '<div class="sr-item" data-addr="' + esc(v.address) + '"><span class="tree-cls">' + esc(v.class) + '</span> <span class="tree-addr">' + esc(v.address) + '</span> ' + esc(v.frame) + (v.text ? ' "' + esc(v.text) + '"' : '') + '</div>'
        ).join('') + '</div>';
        el.querySelectorAll('.sr-item').forEach(item => {
            item.addEventListener('click', () => {
                vscode.postMessage({command:'getDetail', address:item.dataset.addr});
                vscode.postMessage({command:'highlight', address:item.dataset.addr});
            });
        });
    }

    function renderScreenshot(b64) {
        const el = document.getElementById('screenshotContent');
        if (!b64) { el.innerHTML = '<div class="empty">Failed to capture screenshot.</div>'; return; }
        el.innerHTML = '<img src="data:image/png;base64,' + b64 + '" alt="Screenshot">';
    }

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
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
