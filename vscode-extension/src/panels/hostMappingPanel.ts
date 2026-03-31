import * as vscode from 'vscode';
import { ProxyServer } from '../proxy/proxyServer';

interface HostGroup {
    id: string;
    title: string;
    content: string;
    enabled: boolean;
}

interface EffectiveRule {
    hostname: string;
    ip: string;
    groupTitle: string;
}

const STORAGE_KEY = 'whiteneedle.hostMappingGroups';

export class HostMappingPanel {
    public static currentPanel: HostMappingPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly globalState: vscode.Memento;
    private readonly proxyServer?: ProxyServer;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        globalState: vscode.Memento,
        proxyServer?: ProxyServer,
    ): void {
        if (HostMappingPanel.currentPanel) {
            HostMappingPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'whiteneedleHostMapping',
            'Host Mapping',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        HostMappingPanel.currentPanel = new HostMappingPanel(panel, globalState, proxyServer);
    }

    private constructor(panel: vscode.WebviewPanel, globalState: vscode.Memento, proxyServer?: ProxyServer) {
        this.panel = panel;
        this.globalState = globalState;
        this.proxyServer = proxyServer;
        this.panel.webview.html = this.getHtmlContent();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'loadGroups':
                    this.sendState();
                    break;
                case 'createGroup':
                    this.createGroup(msg.title, msg.content);
                    break;
                case 'updateGroup':
                    this.updateGroup(msg.groupId, msg.content);
                    break;
                case 'renameGroup':
                    this.renameGroup(msg.groupId, msg.title);
                    break;
                case 'deleteGroup':
                    this.deleteGroup(msg.groupId);
                    break;
                case 'toggleGroup':
                    this.toggleGroup(msg.groupId, msg.enabled);
                    break;
                case 'importHostsText':
                    this.importHostsText(msg.title, msg.text);
                    break;
                case 'exportGroups':
                    await this.exportGroups();
                    break;
            }
        }, null, this.disposables);

        this.sendState();
    }

    private getGroups(): HostGroup[] {
        return this.globalState.get<HostGroup[]>(STORAGE_KEY, []);
    }

    private async saveGroups(groups: HostGroup[]): Promise<void> {
        await this.globalState.update(STORAGE_KEY, groups);
        this.sendState();
        this.syncToProxy();
    }

    public static getEffectiveRules(globalState: vscode.Memento): EffectiveRule[] {
        const groups = globalState.get<HostGroup[]>(STORAGE_KEY, []);
        return HostMappingPanel.computeEffective(groups);
    }

    private static computeEffective(groups: HostGroup[]): EffectiveRule[] {
        const rules: EffectiveRule[] = [];
        for (const g of groups) {
            if (!g.enabled) { continue; }
            const lines = (g.content || '').split('\n');
            for (const raw of lines) {
                const line = raw.trim();
                if (!line || line.startsWith('#')) { continue; }
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const ip = parts[0];
                    for (let i = 1; i < parts.length; i++) {
                        const hostname = parts[i];
                        if (hostname.startsWith('#')) { break; }
                        rules.push({ hostname, ip, groupTitle: g.title });
                    }
                }
            }
        }
        return rules;
    }

    private sendState(): void {
        const groups = this.getGroups();
        const effective = HostMappingPanel.computeEffective(groups);
        const payload = groups.map(g => {
            const ruleCount = HostMappingPanel.computeEffective([{ ...g, enabled: true }]).length;
            return { id: g.id, title: g.title, content: g.content, enabled: g.enabled, ruleCount };
        });
        this.panel.webview.postMessage({ command: 'setGroups', groups: payload, effective });
    }

    private syncToProxy(): void {
        if (!this.proxyServer || !this.proxyServer.running) { return; }
        const effective = HostMappingPanel.computeEffective(this.getGroups());
        this.proxyServer.updateRules(effective);
    }

    private createGroup(title: string, content: string): void {
        const groups = this.getGroups();
        const id = `hg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        groups.push({ id, title, content, enabled: true });
        this.saveGroups(groups);
    }

    private updateGroup(groupId: string, content: string): void {
        const groups = this.getGroups();
        const g = groups.find(x => x.id === groupId);
        if (g) { g.content = content; }
        this.saveGroups(groups);
    }

    private renameGroup(groupId: string, title: string): void {
        const groups = this.getGroups();
        const g = groups.find(x => x.id === groupId);
        if (g) { g.title = title; }
        this.saveGroups(groups);
    }

    private deleteGroup(groupId: string): void {
        const groups = this.getGroups().filter(x => x.id !== groupId);
        this.saveGroups(groups);
    }

    private toggleGroup(groupId: string, enabled: boolean): void {
        const groups = this.getGroups();
        const g = groups.find(x => x.id === groupId);
        if (g) { g.enabled = enabled; }
        this.saveGroups(groups);
    }

    private importHostsText(title: string, text: string): void {
        const groups = this.getGroups();
        const id = `hg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        groups.push({ id, title, content: text, enabled: true });
        this.saveGroups(groups);
    }

    private async exportGroups(): Promise<void> {
        try {
            const groups = this.getGroups();
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('whiteneedle_hosts.json'),
                filters: { 'JSON Files': ['json'] },
            });
            if (!uri) { return; }
            const content = JSON.stringify(groups, null, 2);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            vscode.window.showInformationMessage('Host groups exported successfully.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Export failed: ${err.message}`);
        }
    }

    private dispose(): void {
        HostMappingPanel.currentPanel = undefined;
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
:root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
    --hover: var(--vscode-list-hoverBackground);
    --accent: var(--vscode-textLink-foreground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --success: #4caf50;
    --danger: #f44336;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); height: 100vh; display: flex; flex-direction: column; }
.toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.toolbar button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { opacity: 0.85; }
.toolbar button.danger { background: var(--danger); }
.main { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 240px; border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
.sidebar-header { padding: 8px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px; display: flex; align-items: center; justify-content: space-between; }
.group-list { flex: 1; overflow-y: auto; }
.group-item { padding: 8px 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
.group-item:hover { background: var(--hover); }
.group-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.group-item .toggle { width: 32px; height: 18px; border-radius: 9px; border: none; cursor: pointer; position: relative; transition: background 0.2s; }
.group-item .toggle.on { background: var(--success); }
.group-item .toggle.off { background: #666; }
.group-item .toggle::after { content: ''; position: absolute; width: 14px; height: 14px; border-radius: 50%; background: white; top: 2px; transition: left 0.2s; }
.group-item .toggle.on::after { left: 16px; }
.group-item .toggle.off::after { left: 2px; }
.group-info { flex: 1; overflow: hidden; }
.group-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-meta { font-size: 11px; opacity: 0.6; }
.editor-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.editor-header { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; font-size: 12px; }
.editor-header .title { font-weight: 600; font-size: 14px; }
.editor-header button { background: var(--badge-bg); color: var(--badge-fg); border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
.editor-container { flex: 1; position: relative; }
.editor-container textarea {
    width: 100%; height: 100%; resize: none; border: none; outline: none;
    background: var(--vscode-textCodeBlock-background); color: var(--fg);
    font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
    font-size: 13px; line-height: 1.6; padding: 12px; tab-size: 4;
}
.editor-container textarea::placeholder { opacity: 0.4; }
.effective-panel { border-top: 1px solid var(--border); max-height: 200px; overflow-y: auto; }
.effective-header { padding: 6px 12px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.effective-header .arrow { transition: transform 0.2s; display: inline-block; }
.effective-header .arrow.open { transform: rotate(90deg); }
.effective-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.effective-table th { text-align: left; padding: 3px 12px; font-weight: 600; opacity: 0.6; }
.effective-table td { padding: 3px 12px; border-top: 1px solid var(--border); }
.effective-table .ip { color: var(--accent); }
.effective-table .group-tag { opacity: 0.5; font-size: 11px; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; opacity: 0.5; gap: 12px; }
.empty-state p { font-size: 13px; }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 16px; min-width: 320px; }
.modal h3 { margin-bottom: 12px; font-size: 14px; }
.modal input, .modal textarea { width: 100%; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 6px 8px; border-radius: 3px; margin-bottom: 8px; font-size: 13px; }
.modal textarea { height: 120px; font-family: monospace; resize: vertical; }
.modal-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
.modal-actions button { padding: 5px 14px; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
.modal-actions .primary { background: var(--accent); color: white; }
.modal-actions .secondary { background: var(--badge-bg); color: var(--badge-fg); }
.hidden { display: none !important; }
</style>
</head>
<body>
<div class="toolbar">
    <button id="btnNew">+ New Group</button>
    <button id="btnImportText">Import Text</button>
    <button id="btnExport">Export All</button>
    <button id="btnRefresh">\u21bb Refresh</button>
</div>
<div class="main">
    <div class="sidebar">
        <div class="sidebar-header"><span>Host Groups</span></div>
        <div class="group-list" id="groupList"></div>
    </div>
    <div class="editor-area">
        <div id="editorEmpty" class="empty-state">
            <p>Select a host group from the sidebar, or create a new one.</p>
            <p style="font-size:11px">Format: one rule per line \u2014 <code>IP hostname</code></p>
        </div>
        <div id="editorMain" class="hidden">
            <div class="editor-header">
                <span class="title" id="editorTitle"></span>
                <button id="btnSave">Save</button>
                <button id="btnRename">Rename</button>
                <button id="btnDelete" style="background:var(--danger);color:white">Delete</button>
            </div>
            <div class="editor-container">
                <textarea id="editor" placeholder="# Lines starting with # are comments\\n# Format: IP hostname\\n# Example:\\n# 10.0.0.1 api.example.com" spellcheck="false"></textarea>
            </div>
        </div>
        <div class="effective-panel">
            <div class="effective-header" id="effectiveToggle">
                <span class="arrow" id="effectiveArrow">\u25b6</span>
                <span>Effective Rules</span>
                <span id="effectiveCount" style="opacity:0.5;font-weight:normal"></span>
            </div>
            <div id="effectiveBody" class="hidden">
                <table class="effective-table">
                    <thead><tr><th>Hostname</th><th>IP</th><th>Group</th></tr></thead>
                    <tbody id="effectiveTbody"></tbody>
                </table>
            </div>
        </div>
    </div>
</div>

<div id="modalOverlay" class="modal-overlay hidden">
    <div class="modal" id="modalContent"></div>
</div>

<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    let groups = [];
    let effective = [];
    let selectedGroupId = null;
    let effectiveOpen = false;

    const groupList = document.getElementById('groupList');
    const editorEmpty = document.getElementById('editorEmpty');
    const editorMain = document.getElementById('editorMain');
    const editorTitle = document.getElementById('editorTitle');
    const editor = document.getElementById('editor');
    const effectiveToggle = document.getElementById('effectiveToggle');
    const effectiveArrow = document.getElementById('effectiveArrow');
    const effectiveBody = document.getElementById('effectiveBody');
    const effectiveTbody = document.getElementById('effectiveTbody');
    const effectiveCount = document.getElementById('effectiveCount');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalContent = document.getElementById('modalContent');

    document.getElementById('btnNew').addEventListener('click', showNewGroupModal);
    document.getElementById('btnImportText').addEventListener('click', showImportTextModal);
    document.getElementById('btnExport').addEventListener('click', () => vscode.postMessage({ command: 'exportGroups' }));
    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ command: 'loadGroups' }));
    document.getElementById('btnSave').addEventListener('click', saveCurrentGroup);
    document.getElementById('btnRename').addEventListener('click', showRenameModal);
    document.getElementById('btnDelete').addEventListener('click', deleteCurrentGroup);
    effectiveToggle.addEventListener('click', toggleEffective);

    window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.command === 'setGroups') {
            groups = msg.groups || [];
            effective = msg.effective || [];
            renderAll();
        } else if (msg.command === 'error') {
            console.error('[HostMapping]', msg.message);
        }
    });

    function renderAll() { renderGroupList(); renderEditor(); renderEffective(); }

    function renderGroupList() {
        groupList.innerHTML = '';
        if (groups.length === 0) {
            groupList.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.4;font-size:12px">No host groups yet</div>';
            return;
        }
        groups.forEach(g => {
            const div = document.createElement('div');
            div.className = 'group-item' + (g.id === selectedGroupId ? ' selected' : '');
            const toggle = document.createElement('button');
            toggle.className = 'toggle ' + (g.enabled ? 'on' : 'off');
            toggle.title = g.enabled ? 'Disable' : 'Enable';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'toggleGroup', groupId: g.id, enabled: !g.enabled });
            });
            const info = document.createElement('div');
            info.className = 'group-info';
            info.innerHTML = '<div class="group-title">' + esc(g.title) + '</div>'
                + '<div class="group-meta">' + (g.ruleCount || 0) + ' rules</div>';
            div.appendChild(toggle);
            div.appendChild(info);
            div.addEventListener('click', () => selectGroup(g.id));
            groupList.appendChild(div);
        });
    }

    function selectGroup(id) { selectedGroupId = id; renderGroupList(); renderEditor(); }

    function renderEditor() {
        const g = groups.find(g => g.id === selectedGroupId);
        if (!g) { editorEmpty.classList.remove('hidden'); editorMain.classList.add('hidden'); return; }
        editorEmpty.classList.add('hidden');
        editorMain.classList.remove('hidden');
        editorTitle.textContent = g.title + (g.enabled ? ' \u2713' : '');
        editor.value = g.content || '';
    }

    function renderEffective() {
        effectiveCount.textContent = '(' + effective.length + ')';
        effectiveTbody.innerHTML = '';
        if (effective.length === 0) {
            effectiveTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;opacity:0.4;padding:8px">No active rules</td></tr>';
            return;
        }
        effective.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + esc(r.hostname) + '</td><td class="ip">' + esc(r.ip) + '</td><td class="group-tag">' + esc(r.groupTitle || '') + '</td>';
            effectiveTbody.appendChild(tr);
        });
    }

    function toggleEffective() {
        effectiveOpen = !effectiveOpen;
        effectiveArrow.className = 'arrow' + (effectiveOpen ? ' open' : '');
        effectiveBody.classList.toggle('hidden', !effectiveOpen);
    }

    function saveCurrentGroup() {
        if (!selectedGroupId) return;
        vscode.postMessage({ command: 'updateGroup', groupId: selectedGroupId, content: editor.value });
    }

    function deleteCurrentGroup() {
        if (!selectedGroupId) return;
        const g = groups.find(g => g.id === selectedGroupId);
        if (!g) return;
        showConfirmModal('Delete "' + g.title + '"?', 'This will permanently remove this host group and all its rules.', () => {
            vscode.postMessage({ command: 'deleteGroup', groupId: selectedGroupId });
            selectedGroupId = null;
        });
    }

    function closeModal() { modalOverlay.classList.add('hidden'); }

    function showNewGroupModal() {
        modalContent.innerHTML = '<h3>New Host Group</h3>'
            + '<input id="mTitle" placeholder="Group title (e.g. Dev Environment)">'
            + '<textarea id="mContent" placeholder="# IP hostname\\n10.0.0.1 api.example.com"></textarea>'
            + '<div class="modal-actions"><button class="secondary" id="mCancel">Cancel</button>'
            + '<button class="primary" id="mCreate">Create</button></div>';
        modalOverlay.classList.remove('hidden');
        setTimeout(() => document.getElementById('mTitle').focus(), 50);
        document.getElementById('mCancel').addEventListener('click', closeModal);
        document.getElementById('mCreate').addEventListener('click', () => {
            const title = document.getElementById('mTitle').value.trim();
            const content = document.getElementById('mContent').value;
            if (!title) return;
            vscode.postMessage({ command: 'createGroup', title, content });
            closeModal();
        });
    }

    function showRenameModal() {
        const g = groups.find(g => g.id === selectedGroupId);
        if (!g) return;
        modalContent.innerHTML = '<h3>Rename Group</h3>'
            + '<input id="mTitle" value="' + esc(g.title) + '">'
            + '<div class="modal-actions"><button class="secondary" id="mCancel">Cancel</button>'
            + '<button class="primary" id="mRename">Rename</button></div>';
        modalOverlay.classList.remove('hidden');
        setTimeout(() => { const el = document.getElementById('mTitle'); el.focus(); el.select(); }, 50);
        document.getElementById('mCancel').addEventListener('click', closeModal);
        document.getElementById('mRename').addEventListener('click', () => {
            const title = document.getElementById('mTitle').value.trim();
            if (!title) return;
            vscode.postMessage({ command: 'renameGroup', groupId: selectedGroupId, title });
            closeModal();
        });
    }

    function showImportTextModal() {
        modalContent.innerHTML = '<h3>Import from Text</h3>'
            + '<input id="mTitle" placeholder="Group title">'
            + '<textarea id="mContent" placeholder="# Paste hosts content here\\n# Format: IP hostname\\n10.0.0.1 api.example.com"></textarea>'
            + '<div class="modal-actions"><button class="secondary" id="mCancel">Cancel</button>'
            + '<button class="primary" id="mImport">Import</button></div>';
        modalOverlay.classList.remove('hidden');
        setTimeout(() => document.getElementById('mTitle').focus(), 50);
        document.getElementById('mCancel').addEventListener('click', closeModal);
        document.getElementById('mImport').addEventListener('click', () => {
            const title = document.getElementById('mTitle').value.trim() || 'Imported';
            const text = document.getElementById('mContent').value;
            if (!text.trim()) return;
            vscode.postMessage({ command: 'importHostsText', title, text });
            closeModal();
        });
    }

    function showConfirmModal(title, message, onConfirm) {
        modalContent.innerHTML = '<h3>' + esc(title) + '</h3><p style="margin-bottom:12px;font-size:13px;opacity:0.8">' + esc(message) + '</p>'
            + '<div class="modal-actions"><button class="secondary" id="mCancel">Cancel</button>'
            + '<button class="primary" id="mConfirm" style="background:var(--danger)">Delete</button></div>';
        modalOverlay.classList.remove('hidden');
        document.getElementById('mCancel').addEventListener('click', closeModal);
        document.getElementById('mConfirm').addEventListener('click', () => { closeModal(); onConfirm(); });
    }

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
    });

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
