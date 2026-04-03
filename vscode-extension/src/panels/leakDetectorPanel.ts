import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';
import { ScriptRunner } from '../scripting/scriptRunner';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

export class LeakDetectorPanel {
    public static currentPanel: LeakDetectorPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly scriptRunner: ScriptRunner;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        scriptRunner: ScriptRunner
    ): void {
        if (LeakDetectorPanel.currentPanel) {
            LeakDetectorPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'whiteneedleLeakDetector',
            'Leak Detector',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        LeakDetectorPanel.currentPanel = new LeakDetectorPanel(panel, deviceManager, scriptRunner);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        deviceManager: DeviceManager,
        scriptRunner: ScriptRunner
    ) {
        this.panel = panel;
        this.deviceManager = deviceManager;
        this.scriptRunner = scriptRunner;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        bindConnectionState(this.panel, this.deviceManager, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'takeSnapshot':
                        await this.takeSnapshot(msg.tag, msg.filter);
                        break;
                    case 'diffSnapshots':
                        await this.diffSnapshots(msg.tagBefore, msg.tagAfter);
                        break;
                    case 'findInstances':
                        await this.findInstances(msg.className, msg.maxCount);
                        break;
                    case 'getStrongRefs':
                        await this.getStrongRefs(msg.address);
                        break;
                    case 'scanRefs':
                        await this.scanRefs(msg.address);
                        break;
                    case 'detectCycles':
                        await this.detectCycles(msg.address);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    private async evalJS(code: string): Promise<any> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return null;
        }
        try {
            const raw = await this.deviceManager.evaluate(code);
            if (raw && typeof raw === 'object' && 'value' in raw) {
                return (raw as { value: unknown }).value;
            }
            return raw;
        } catch (err: any) {
            this.postMessage({ command: 'error', text: err.message });
            return null;
        }
    }

    private async takeSnapshot(tag: string, filter?: string): Promise<void> {
        const filterArg = filter ? `"${filter}"` : 'undefined';
        const result = await this.evalJS(
            `LeakDetector.takeSnapshot("${tag}", ${filterArg})`
        );
        this.postMessage({ command: 'snapshotTaken', tag: result || tag });
    }

    private async diffSnapshots(tagBefore: string, tagAfter: string): Promise<void> {
        const result = await this.evalJS(
            `JSON.stringify(LeakDetector.diffSnapshots("${tagBefore}", "${tagAfter}"))`
        );
        if (!result) return;
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'diffResult', data: parsed });
        } catch {
            this.postMessage({ command: 'diffResult', data: result });
        }
    }

    private async findInstances(className: string, maxCount: number = 500): Promise<void> {
        const result = await this.evalJS(
            `JSON.stringify(LeakDetector.findInstances("${className}", true, ${maxCount}))`
        );
        if (!result) return;
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'instancesFound', data: parsed, className });
        } catch {
            this.postMessage({ command: 'instancesFound', data: [], className });
        }
    }

    private async getStrongRefs(address: string): Promise<void> {
        const result = await this.evalJS(
            `JSON.stringify(LeakDetector.getStrongReferences("${address}"))`
        );
        if (!result) return;
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'strongRefs', data: parsed, address });
        } catch {
            this.postMessage({ command: 'strongRefs', data: [], address });
        }
    }

    private async scanRefs(address: string): Promise<void> {
        const result = await this.evalJS(
            `JSON.stringify(LeakDetector.scanReferences("${address}", 128))`
        );
        if (!result) return;
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'scannedRefs', data: parsed, address });
        } catch {
            this.postMessage({ command: 'scannedRefs', data: [], address });
        }
    }

    private async detectCycles(address: string): Promise<void> {
        const result = await this.evalJS(
            `JSON.stringify(LeakDetector.detectCycles("${address}", 10))`
        );
        if (!result) return;
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'cyclesDetected', data: parsed, address });
        } catch {
            this.postMessage({ command: 'cyclesDetected', data: [], address });
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        LeakDetectorPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    private getHtml(): string {
        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Leak Detector</title>
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
        --badge-bg: var(--vscode-badge-background, #007acc);
        --badge-fg: var(--vscode-badge-foreground, #fff);
        --danger: #f44747;
        --warn: #cca700;
        --ok: #89d185;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family, sans-serif); background: var(--bg); color: var(--fg); padding: 12px; font-size: 13px; }
    h2 { font-size: 15px; margin-bottom: 8px; }
    .section { border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
    .section-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    input[type="text"], input[type="number"] {
        background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border);
        border-radius: 4px; padding: 4px 8px; font-size: 12px; min-width: 120px;
    }
    button {
        background: var(--btn-bg); color: var(--btn-fg); border: none;
        border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 12px; white-space: nowrap;
    }
    button:hover { opacity: 0.85; }
    button.danger { background: var(--danger); }
    .badge { background: var(--badge-bg); color: var(--badge-fg); border-radius: 10px; padding: 1px 8px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
    th { font-weight: 600; opacity: 0.8; position: sticky; top: 0; background: var(--bg); }
    .addr { font-family: monospace; cursor: pointer; color: var(--badge-bg); text-decoration: underline; }
    .addr:hover { opacity: 0.7; }
    .delta-pos { color: var(--danger); font-weight: 600; }
    .delta-zero { color: var(--ok); }
    .scroll-box { max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; }
    .status { font-size: 11px; opacity: 0.6; margin-top: 4px; }
    .error { color: var(--danger); }
    .tabs { display: flex; gap: 0; margin-bottom: 12px; }
    .tab { padding: 6px 16px; cursor: pointer; border: 1px solid var(--border); border-bottom: none; border-radius: 6px 6px 0 0; opacity: 0.6; font-size: 12px; }
    .tab.active { opacity: 1; background: var(--bg); border-bottom: 2px solid var(--btn-bg); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .graph-container { position: relative; width: 100%; height: 300px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; background: var(--input-bg); }
    .graph-node {
        position: absolute; background: var(--bg); border: 2px solid var(--btn-bg); border-radius: 6px;
        padding: 6px 10px; font-size: 11px; cursor: pointer; z-index: 2; white-space: nowrap;
    }
    .graph-node.cycle { border-color: var(--danger); background: rgba(244,71,71,0.1); }
    .graph-edge { position: absolute; z-index: 1; }
    ${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}

<h2>🔍 Memory Leak Detector</h2>

<div class="tabs">
    <div class="tab active" data-tab="snapshot" onclick="switchTab('snapshot')">Snapshot Diff</div>
    <div class="tab" data-tab="instances" onclick="switchTab('instances')">Find Instances</div>
    <div class="tab" data-tab="refs" onclick="switchTab('refs')">Reference Graph</div>
</div>

<!-- Snapshot Diff Tab -->
<div class="tab-content active" id="tab-snapshot">
    <div class="section">
        <div class="section-title">📸 Heap Snapshots</div>
        <div class="row">
            <input type="text" id="snapFilter" placeholder="Class filter (optional)" style="flex:1" />
        </div>
        <div class="row">
            <button onclick="takeSnap('before')">① Take "Before"</button>
            <button onclick="takeSnap('after')">② Take "After"</button>
            <button onclick="doDiff()">③ Diff</button>
            <span id="snapStatus" class="status"></span>
        </div>
    </div>
    <div class="section" id="diffSection" style="display:none">
        <div class="section-title">📊 Grown Instances <span class="badge" id="diffCount">0</span></div>
        <div class="scroll-box">
            <table>
                <thead><tr><th>Class</th><th>Before</th><th>After</th><th>Δ</th></tr></thead>
                <tbody id="diffBody"></tbody>
            </table>
        </div>
    </div>
</div>

<!-- Find Instances Tab -->
<div class="tab-content" id="tab-instances">
    <div class="section">
        <div class="section-title">🏗 Heap Instance Search</div>
        <div class="row">
            <input type="text" id="instClass" placeholder="Class name (e.g. UIViewController)" style="flex:1" />
            <input type="number" id="instMax" placeholder="Max" value="500" style="width:80px" />
            <button onclick="findInstances()">Search</button>
        </div>
    </div>
    <div class="section" id="instSection" style="display:none">
        <div class="section-title">📋 Results <span class="badge" id="instCount">0</span></div>
        <div class="scroll-box">
            <table>
                <thead><tr><th>Class</th><th>Address</th><th>Size</th><th>Actions</th></tr></thead>
                <tbody id="instBody"></tbody>
            </table>
        </div>
    </div>
</div>

<!-- Reference Graph Tab -->
<div class="tab-content" id="tab-refs">
    <div class="section">
        <div class="section-title">🔗 Reference Inspector</div>
        <div class="row">
            <input type="text" id="refAddr" placeholder="Object address (0x...)" style="flex:1" />
            <button onclick="loadStrongRefs()">Strong Refs (ivar)</button>
            <button onclick="loadScanRefs()">Conservative Scan</button>
            <button onclick="loadCycles()" class="danger">Detect Cycles</button>
        </div>
    </div>
    <div class="section" id="refsSection" style="display:none">
        <div class="section-title" id="refsTitle">References</div>
        <div class="scroll-box">
            <table>
                <thead><tr><th>Name/Offset</th><th>Class</th><th>Address</th><th>Actions</th></tr></thead>
                <tbody id="refsBody"></tbody>
            </table>
        </div>
    </div>
    <div class="section" id="cyclesSection" style="display:none">
        <div class="section-title">🔄 Retain Cycles <span class="badge" id="cycleCount">0</span></div>
        <div id="cyclesBody" style="font-size:12px; font-family:monospace;"></div>
    </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let snapshots = {};

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
}

function takeSnap(tag) {
    const filter = document.getElementById('snapFilter').value.trim() || undefined;
    vscode.postMessage({ command: 'takeSnapshot', tag, filter });
    document.getElementById('snapStatus').textContent = 'Taking snapshot "' + tag + '"...';
}

function doDiff() {
    if (!snapshots['before'] || !snapshots['after']) {
        document.getElementById('snapStatus').textContent = 'Take both snapshots first.';
        return;
    }
    vscode.postMessage({ command: 'diffSnapshots', tagBefore: 'before', tagAfter: 'after' });
    document.getElementById('snapStatus').textContent = 'Computing diff...';
}

function findInstances() {
    const cls = document.getElementById('instClass').value.trim();
    if (!cls) return;
    const max = parseInt(document.getElementById('instMax').value) || 500;
    vscode.postMessage({ command: 'findInstances', className: cls, maxCount: max });
}

function loadStrongRefs() {
    const addr = document.getElementById('refAddr').value.trim();
    if (!addr) return;
    vscode.postMessage({ command: 'getStrongRefs', address: addr });
}

function loadScanRefs() {
    const addr = document.getElementById('refAddr').value.trim();
    if (!addr) return;
    vscode.postMessage({ command: 'scanRefs', address: addr });
}

function loadCycles() {
    const addr = document.getElementById('refAddr').value.trim();
    if (!addr) return;
    vscode.postMessage({ command: 'detectCycles', address: addr });
}

function inspectAddr(addr) {
    document.getElementById('refAddr').value = addr;
    switchTab('refs');
    loadStrongRefs();
}

window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.command) {
        case 'snapshotTaken':
            snapshots[msg.tag] = true;
            document.getElementById('snapStatus').textContent = 'Snapshot "' + msg.tag + '" ✓';
            break;

        case 'diffResult':
            renderDiff(msg.data);
            break;

        case 'instancesFound':
            renderInstances(msg.data, msg.className);
            break;

        case 'strongRefs':
            renderRefs(msg.data, msg.address, 'strong');
            break;

        case 'scannedRefs':
            renderRefs(msg.data, msg.address, 'conservative');
            break;

        case 'cyclesDetected':
            renderCycles(msg.data, msg.address);
            break;

        case 'error':
            document.getElementById('snapStatus').textContent = '❌ ' + msg.text;
            break;
    }
});

function renderDiff(data) {
    const grown = (data && data.grown) || [];
    document.getElementById('diffSection').style.display = '';
    document.getElementById('diffCount').textContent = grown.length;
    document.getElementById('snapStatus').textContent = grown.length > 0
        ? grown.length + ' class(es) grew in count' : 'No growth detected ✓';

    const tbody = document.getElementById('diffBody');
    tbody.innerHTML = '';
    for (const row of grown) {
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + esc(row.className) + '</td>' +
            '<td>' + row.before + '</td>' +
            '<td>' + row.after + '</td>' +
            '<td class="delta-pos">+' + row.delta + '</td>';
        tr.style.cursor = 'pointer';
        tr.onclick = () => {
            document.getElementById('instClass').value = row.className;
            switchTab('instances');
            findInstances();
        };
        tbody.appendChild(tr);
    }
}

function renderInstances(data, className) {
    const arr = Array.isArray(data) ? data : [];
    document.getElementById('instSection').style.display = '';
    document.getElementById('instCount').textContent = arr.length;

    const tbody = document.getElementById('instBody');
    tbody.innerHTML = '';
    for (const inst of arr) {
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + esc(inst.className) + '</td>' +
            '<td class="addr" onclick="inspectAddr(\\''+inst.address+'\\')">'+inst.address+'</td>' +
            '<td>' + inst.size + '</td>' +
            '<td><button onclick="inspectAddr(\\''+inst.address+'\\')">Inspect</button></td>';
        tbody.appendChild(tr);
    }
}

function renderRefs(data, address, mode) {
    const arr = Array.isArray(data) ? data : [];
    document.getElementById('refsSection').style.display = '';
    document.getElementById('refsTitle').textContent =
        (mode === 'strong' ? '🔗 Strong ivar refs' : '🔍 Conservative scan') +
        ' from ' + address + ' (' + arr.length + ')';

    const tbody = document.getElementById('refsBody');
    tbody.innerHTML = '';
    for (const ref of arr) {
        const label = ref.name || ('offset ' + ref.offset);
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + esc(label) + '</td>' +
            '<td>' + esc(ref.className) + '</td>' +
            '<td class="addr" onclick="inspectAddr(\\''+ref.address+'\\')">'+ref.address+'</td>' +
            '<td><button onclick="inspectAddr(\\''+ref.address+'\\')">→</button></td>';
        tbody.appendChild(tr);
    }
}

function renderCycles(data, address) {
    const cycles = Array.isArray(data) ? data : [];
    document.getElementById('cyclesSection').style.display = '';
    document.getElementById('cycleCount').textContent = cycles.length;

    const container = document.getElementById('cyclesBody');
    container.innerHTML = '';
    if (cycles.length === 0) {
        container.innerHTML = '<div style="padding:8px;color:var(--ok);">No retain cycles detected from ' + esc(address) + ' ✓</div>';
        return;
    }
    for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i];
        const div = document.createElement('div');
        div.style.cssText = 'padding:8px; margin-bottom:6px; border:1px solid var(--danger); border-radius:4px;';
        let html = '<strong style="color:var(--danger)">Cycle ' + (i+1) + ':</strong><br>';
        for (let j = 0; j < cycle.length; j++) {
            const node = cycle[j];
            const ivar = node.retainedVia ? esc(node.retainedVia) : '?';
            html += '<span class="addr" onclick="inspectAddr(\\''+node.address+'\\')">'+esc(node.className)+' ('+node.address+')</span>';
            const nextIdx = (j + 1) % cycle.length;
            const nextLabel = j < cycle.length - 1
                ? esc(cycle[nextIdx].className)
                : esc(cycle[0].className) + ' ↺';
            html += ' <span style="color:var(--danger)">—[' + ivar + ']→</span> ';
        }
        div.innerHTML = html;
        container.appendChild(div);
    }
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

${OVERLAY_JS}
</script>
</body>
</html>`;
    }
}
