import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';
import { ScriptRunner } from '../scripting/scriptRunner';

export class ObjCPanel {
    public static currentPanel: ObjCPanel | undefined;
    private static readonly viewType = 'whiteneedle.objcPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly scriptRunner: ScriptRunner;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        scriptRunner: ScriptRunner
    ): ObjCPanel {
        const column = vscode.ViewColumn.One;

        if (ObjCPanel.currentPanel) {
            ObjCPanel.currentPanel.panel.reveal(column);
            return ObjCPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            ObjCPanel.viewType,
            'ObjC Runtime',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        ObjCPanel.currentPanel = new ObjCPanel(panel, deviceManager, scriptRunner);
        return ObjCPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager, scriptRunner: ScriptRunner) {
        this.panel = panel;
        this.deviceManager = deviceManager;
        this.scriptRunner = scriptRunner;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'loadClasses':
                        await this.loadClasses(msg.filter);
                        break;
                    case 'loadMethods':
                        await this.loadMethods(msg.className);
                        break;
                    case 'traceMethod':
                        await this.traceMethod(msg.className, msg.methodSignature);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    private async loadClasses(filter?: string): Promise<void> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        try {
            const classes = await this.deviceManager.getClassNames(filter || undefined);
            this.postMessage({ command: 'classesLoaded', classes: classes || [] });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load classes: ${err.message}` });
        }
    }

    private async loadMethods(className: string): Promise<void> {
        try {
            const result = await this.deviceManager.getMethods(className);
            const methods = [
                ...result.classMethods.map((m: string) => `+ ${m}`),
                ...result.instanceMethods.map((m: string) => `- ${m}`),
            ];
            this.postMessage({ command: 'methodsLoaded', className, methods });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to load methods: ${err.message}` });
        }
    }

    private async traceMethod(className: string, methodSignature: string): Promise<void> {
        const isClassMethod = methodSignature.startsWith('+');
        const sig = methodSignature.replace(/^[+-]\s*/, '');
        const prefix = isClassMethod ? '+' : '-';
        const hookKey = `${prefix}[${className} ${sig}]`;
        const traceScript = `
Interceptor.attach('${hookKey}', {
    onEnter: function(self) {
        console.log('[Trace] ${hookKey} called, self=' + self);
    },
    onLeave: function() {
        console.log('[Trace] ${hookKey} returned');
    }
});
console.log('[WhiteNeedle] Tracing: ${hookKey}');
`;
        try {
            await this.scriptRunner.pushAndRun(traceScript, `trace-${className}`);
            this.postMessage({ command: 'traceStarted', hookKey });
            vscode.window.showInformationMessage(`Tracing: ${hookKey}`);
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Trace failed: ${err.message}` });
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        ObjCPanel.currentPanel = undefined;
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
<title>ObjC Runtime</title>
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
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); }

    .toolbar { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 10; align-items: center; }
    .toolbar input { flex: 1; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; outline: none; }
    .toolbar input:focus { border-color: var(--btn-bg); }
    button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
    button:hover { background: var(--btn-hover); }
    button.small { padding: 2px 8px; font-size: 11px; }

    .stats { padding: 4px 12px; font-size: 11px; opacity: 0.6; border-bottom: 1px solid var(--border); }

    .class-list { padding: 0; }
    .class-row { display: flex; align-items: center; padding: 3px 12px; cursor: pointer; gap: 6px; }
    .class-row:hover { background: var(--list-hover); }
    .class-row .arrow { width: 14px; font-size: 10px; flex-shrink: 0; transition: transform 0.15s; display: inline-block; }
    .class-row .arrow.open { transform: rotate(90deg); }
    .class-row .name { flex: 1; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }

    .method-list { padding-left: 24px; border-left: 1px solid var(--border); margin-left: 18px; }
    .method-row { display: flex; align-items: center; padding: 2px 8px; gap: 6px; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
    .method-row:hover { background: var(--list-hover); }
    .method-row .type { width: 14px; text-align: center; font-weight: bold; flex-shrink: 0; }
    .method-row .type.class-method { color: #e5c07b; }
    .method-row .type.instance-method { color: #61afef; }
    .method-row .sig { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .method-row .trace-btn { opacity: 0; }
    .method-row:hover .trace-btn { opacity: 1; }

    .group-header { display: flex; align-items: center; padding: 6px 12px; gap: 6px; cursor: pointer; font-weight: 600; border-bottom: 1px solid var(--border); }
    .group-header:hover { background: var(--list-hover); }
    .group-header .arrow { width: 14px; font-size: 10px; transition: transform 0.15s; display: inline-block; }
    .group-header .arrow.open { transform: rotate(90deg); }

    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg); z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .toast.error { background: var(--error-fg); }
</style>
</head>
<body>
<div class="toolbar">
    <input id="filterInput" placeholder="Filter classes (e.g. UIView, NS...)" />
    <button id="loadBtn">Load Classes</button>
</div>
<div class="stats" id="stats"></div>
<div id="classList" class="class-list">
    <div class="empty">Enter a filter and click "Load Classes"</div>
</div>
<div class="toast" id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
let allClasses = [];
let openClasses = {};
let methodsCache = {};
let openGroups = {};

document.getElementById('loadBtn').addEventListener('click', () => {
    const filter = document.getElementById('filterInput').value.trim();
    vscode.postMessage({ command: 'loadClasses', filter: filter || undefined });
});
document.getElementById('filterInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loadBtn').click();
});

function renderClasses() {
    const el = document.getElementById('classList');
    const stats = document.getElementById('stats');

    if (allClasses.length === 0) {
        stats.textContent = '';
        el.innerHTML = '<div class="empty">No classes found</div>';
        return;
    }

    stats.textContent = allClasses.length + ' classes';

    if (allClasses.length <= 300) {
        let html = '';
        allClasses.forEach(cls => { html += renderClassRow(cls); });
        el.innerHTML = html;
    } else {
        const groups = {};
        allClasses.forEach(cls => {
            const prefix = cls.substring(0, 2).toUpperCase();
            if (!groups[prefix]) groups[prefix] = [];
            groups[prefix].push(cls);
        });
        let html = '';
        Object.keys(groups).sort().forEach(prefix => {
            const isOpen = openGroups[prefix];
            html += '<div class="group-header" onclick="toggleGroup(\\'' + escJ(prefix) + '\\')">';
            html += '<span class="arrow ' + (isOpen ? 'open' : '') + '">▶</span>';
            html += prefix + ' <span class="badge" style="margin-left:4px;padding:1px 6px;border-radius:8px;font-size:11px;background:var(--badge-bg);color:var(--badge-fg)">' + groups[prefix].length + '</span>';
            html += '</div>';
            if (isOpen) {
                groups[prefix].forEach(cls => { html += renderClassRow(cls); });
            }
        });
        el.innerHTML = html;
    }
}

function renderClassRow(cls) {
    const isOpen = openClasses[cls];
    let html = '<div class="class-row" onclick="toggleClass(\\'' + escJ(cls) + '\\')">';
    html += '<span class="arrow ' + (isOpen ? 'open' : '') + '">▶</span>';
    html += '<span class="name">' + escH(cls) + '</span>';
    html += '</div>';
    if (isOpen) {
        const methods = methodsCache[cls];
        if (!methods) {
            html += '<div class="method-list" style="padding:8px 8px 8px 32px;opacity:0.5">Loading methods...</div>';
        } else if (methods.length === 0) {
            html += '<div class="method-list" style="padding:8px 8px 8px 32px;opacity:0.5">No methods</div>';
        } else {
            html += '<div class="method-list">';
            methods.forEach(m => {
                const isClass = m.startsWith('+');
                html += '<div class="method-row">';
                html += '<span class="type ' + (isClass ? 'class-method' : 'instance-method') + '">' + m.charAt(0) + '</span>';
                html += '<span class="sig" title="' + escH(m) + '">' + escH(m.substring(2)) + '</span>';
                html += '<button class="small trace-btn" onclick="event.stopPropagation();traceMethod(\\'' + escJ(cls) + '\\',\\'' + escJ(m) + '\\')">Trace</button>';
                html += '</div>';
            });
            html += '</div>';
        }
    }
    return html;
}

function toggleGroup(prefix) {
    openGroups[prefix] = !openGroups[prefix];
    renderClasses();
}

function toggleClass(cls) {
    openClasses[cls] = !openClasses[cls];
    if (openClasses[cls] && !methodsCache[cls]) {
        vscode.postMessage({ command: 'loadMethods', className: cls });
    }
    renderClasses();
}

function traceMethod(cls, sig) {
    vscode.postMessage({ command: 'traceMethod', className: cls, methodSignature: sig });
}

window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {
        case 'classesLoaded':
            allClasses = msg.classes || [];
            openClasses = {};
            methodsCache = {};
            openGroups = {};
            renderClasses();
            showToast(allClasses.length + ' classes loaded');
            break;
        case 'methodsLoaded':
            methodsCache[msg.className] = msg.methods || [];
            renderClasses();
            break;
        case 'traceStarted':
            showToast('Tracing: ' + msg.hookKey);
            break;
        case 'error':
            showToast(msg.text, true);
            break;
    }
});

function escH(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }
function escJ(s) { return (s||'').replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'"); }
function showToast(text, isError) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => t.className = 'toast', 2500);
}
</script>
</body>
</html>`;
    }
}
