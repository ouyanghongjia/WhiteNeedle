import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

export interface HookInfo {
    selector: string;
    className: string;
    isClassMethod: boolean;
    paused: boolean;
    hitCount: number;
    lastHitTime: number;
    hasOnEnter: boolean;
    hasOnLeave: boolean;
    hasReplacement: boolean;
}

const HOOK_TEMPLATES: { label: string; description: string; code: string }[] = [
    {
        label: 'viewDidLoad',
        description: 'Track UIViewController lifecycle',
        code: `Interceptor.attach("-[UIViewController viewDidLoad]", {
    onEnter(self, sel, args) {
        console.log("[Hook] viewDidLoad:", self.className());
    }
});`,
    },
    {
        label: 'URLSession:dataTask',
        description: 'Monitor network requests',
        code: `Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter(self, sel, args) {
        var req = args[0];
        console.log("[Hook] Request:", req.URL().absoluteString());
    }
});`,
    },
    {
        label: 'UIAlertController',
        description: 'Track alert presentations',
        code: `Interceptor.attach("-[UIViewController presentViewController:animated:completion:]", {
    onEnter(self, sel, args) {
        var vc = args[0];
        if (vc.isKindOfClass_(ObjC.classes.UIAlertController)) {
            console.log("[Hook] Alert:", vc.title());
        }
    }
});`,
    },
    {
        label: 'Custom Hook...',
        description: 'Write your own hook',
        code: '',
    },
];

export class HookPanel {
    public static currentPanel: HookPanel | undefined;
    private static readonly viewType = 'whiteneedle.hookPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly deviceManager: DeviceManager;
    private disposables: vscode.Disposable[] = [];
    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    public static createOrShow(extensionUri: vscode.Uri, deviceManager: DeviceManager): HookPanel {
        const column = vscode.ViewColumn.One;
        if (HookPanel.currentPanel) {
            HookPanel.currentPanel.panel.reveal(column);
            return HookPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(
            HookPanel.viewType,
            'Hook Manager',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        HookPanel.currentPanel = new HookPanel(panel, extensionUri, deviceManager);
        return HookPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, deviceManager: DeviceManager) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.deviceManager = deviceManager;

        this.panel.webview.html = this.getHtmlContent();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'refresh': await this.loadHooks(); break;
                case 'pause': await this.toggleHook(msg.selector, true); break;
                case 'resume': await this.toggleHook(msg.selector, false); break;
                case 'detach': await this.detachHook(msg.selector); break;
                case 'applyTemplate': await this.applyTemplate(msg.index); break;
                case 'runCustomCode': await this.runCustomCode(msg.code); break;
                case 'toggleAutoRefresh': this.toggleAutoRefresh(msg.enabled); break;
            }
        }, null, this.disposables);

        this.loadHooks();
    }

    private async loadHooks(): Promise<void> {
        try {
            const hooks = await this.deviceManager.listHooksDetailed();
            this.panel.webview.postMessage({ type: 'hooks', hooks });
        } catch (e: any) {
            this.panel.webview.postMessage({ type: 'error', message: e.message });
        }
    }

    private async toggleHook(selector: string, pause: boolean): Promise<void> {
        try {
            const ok = pause
                ? await this.deviceManager.pauseHook(selector)
                : await this.deviceManager.resumeHook(selector);
            if (!ok) {
                vscode.window.showWarningMessage(`Hook not found: ${selector}`);
            }
            await this.loadHooks();
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to ${pause ? 'pause' : 'resume'} hook: ${e.message}`);
        }
    }

    private async detachHook(selector: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `Detach hook "${selector}"?`, { modal: true }, 'Detach'
        );
        if (confirm !== 'Detach') { return; }
        try {
            await this.deviceManager.detachHook(selector);
            await this.loadHooks();
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to detach hook: ${e.message}`);
        }
    }

    private async applyTemplate(index: number): Promise<void> {
        const template = HOOK_TEMPLATES[index];
        if (!template) { return; }

        if (!template.code) {
            const code = await vscode.window.showInputBox({
                prompt: 'Enter hook code (Interceptor.attach(...))',
                placeHolder: 'Interceptor.attach("-[ClassName method]", { onEnter(self, sel, args) { ... } })',
            });
            if (!code) { return; }
            await this.runCustomCode(code);
            return;
        }

        try {
            await this.deviceManager.evaluate(template.code);
            vscode.window.showInformationMessage(`Template "${template.label}" applied`);
            setTimeout(() => this.loadHooks(), 500);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to apply template: ${e.message}`);
        }
    }

    private async runCustomCode(code: string): Promise<void> {
        try {
            await this.deviceManager.evaluate(code);
            vscode.window.showInformationMessage('Hook code executed');
            setTimeout(() => this.loadHooks(), 500);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Hook code error: ${e.message}`);
        }
    }

    private toggleAutoRefresh(enabled: boolean): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        if (enabled) {
            this.refreshTimer = setInterval(() => this.loadHooks(), 3000);
        }
    }

    private dispose(): void {
        HookPanel.currentPanel = undefined;
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.disposables.forEach((d) => d.dispose());
    }

    private getHtmlContent(): string {
        const nonce = getNonce();
        const templateOptions = HOOK_TEMPLATES.map((t, i) =>
            `<option value="${i}">${t.label} — ${t.description}</option>`
        ).join('');

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hook Manager</title>
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; margin: 0; }
    .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
    .toolbar button, .toolbar select {
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
        border: none; padding: 4px 10px; cursor: pointer; border-radius: 3px; font-size: 12px;
    }
    .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
    .toolbar label { font-size: 12px; display: flex; align-items: center; gap: 4px; }
    .stats { padding: 8px 16px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
    .hook-list { overflow-y: auto; padding: 0; }
    .hook-item {
        display: grid; grid-template-columns: 1fr auto;
        padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border);
        align-items: center;
    }
    .hook-item:hover { background: var(--vscode-list-hoverBackground); }
    .hook-item.paused { opacity: 0.6; }
    .hook-selector { font-family: var(--vscode-editor-font-family); font-size: 13px; font-weight: 600; }
    .hook-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
    .hook-meta span { margin-right: 12px; }
    .hook-actions { display: flex; gap: 4px; }
    .hook-actions button {
        background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
        border: none; padding: 3px 8px; cursor: pointer; border-radius: 3px; font-size: 11px;
    }
    .hook-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .hook-actions button.danger { color: var(--vscode-errorForeground); }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; }
    .badge-active { background: #2ea04370; color: #3fb950; }
    .badge-paused { background: #d2992270; color: #d29922; }
    .badge-replace { background: #8b5cf670; color: #a78bfa; }
    .empty { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
    .empty h3 { margin-bottom: 8px; }
</style>
</head>
<body>
<div class="toolbar">
    <button id="btnRefresh">⟳ Refresh</button>
    <select id="templateSelect">${templateOptions}</select>
    <button id="btnApply">▶ Apply Template</button>
    <div style="flex:1"></div>
    <label><input type="checkbox" id="autoRefresh"> Auto-refresh</label>
</div>
<div class="stats" id="stats">No hooks active</div>
<div class="hook-list" id="hookList">
    <div class="empty"><h3>No hooks registered</h3><p>Use a template above or push a script with Interceptor.attach()</p></div>
</div>
<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();

    const hookList = document.getElementById('hookList');
    const stats = document.getElementById('stats');

    document.getElementById('btnRefresh').addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
    });

    document.getElementById('btnApply').addEventListener('click', () => {
        const sel = document.getElementById('templateSelect');
        vscode.postMessage({ command: 'applyTemplate', index: parseInt(sel.value, 10) });
    });

    document.getElementById('autoRefresh').addEventListener('change', (e) => {
        vscode.postMessage({ command: 'toggleAutoRefresh', enabled: e.target.checked });
    });

    function formatTime(ts) {
        if (!ts || ts === 0) return 'never';
        const d = new Date(ts * 1000);
        return d.toLocaleTimeString();
    }

    function renderHooks(hooks) {
        if (!hooks || hooks.length === 0) {
            hookList.innerHTML = '<div class="empty"><h3>No hooks registered</h3><p>Use a template above or push a script with Interceptor.attach()</p></div>';
            stats.textContent = 'No hooks active';
            return;
        }

        const active = hooks.filter(h => !h.paused).length;
        const paused = hooks.filter(h => h.paused).length;
        const totalHits = hooks.reduce((s, h) => s + (h.hitCount || 0), 0);
        stats.textContent = hooks.length + ' hook(s): ' + active + ' active, ' + paused + ' paused | Total hits: ' + totalHits;

        hookList.innerHTML = hooks.map(h => {
            const pausedClass = h.paused ? ' paused' : '';
            const typeBadge = h.hasReplacement
                ? '<span class="badge badge-replace">replace</span>'
                : '<span class="badge badge-active">attach</span>';
            const statusBadge = h.paused
                ? '<span class="badge badge-paused">paused</span>'
                : '';
            const methodType = h.isClassMethod ? '+' : '-';
            const toggleBtn = h.paused
                ? '<button data-action="resume" data-sel="' + escAttr(h.selector) + '">▶ Resume</button>'
                : '<button data-action="pause" data-sel="' + escAttr(h.selector) + '">⏸ Pause</button>';

            return '<div class="hook-item' + pausedClass + '">' +
                '<div>' +
                    '<div class="hook-selector">' + typeBadge + ' ' + statusBadge + ' ' + esc(h.selector) + '</div>' +
                    '<div class="hook-meta">' +
                        '<span>Class: ' + esc(h.className) + '</span>' +
                        '<span>Hits: ' + (h.hitCount || 0) + '</span>' +
                        '<span>Last: ' + formatTime(h.lastHitTime) + '</span>' +
                        '<span>' + (h.hasOnEnter ? '✓onEnter ' : '') + (h.hasOnLeave ? '✓onLeave' : '') + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="hook-actions">' +
                    toggleBtn +
                    '<button class="danger" data-action="detach" data-sel="' + escAttr(h.selector) + '">✕ Detach</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    hookList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const sel = btn.dataset.sel;
        vscode.postMessage({ command: action, selector: sel });
    });

    function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escAttr(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'hooks':
                renderHooks(msg.hooks);
                break;
            case 'error':
                hookList.innerHTML = '<div class="empty"><h3>Error</h3><p>' + esc(msg.message) + '</p></div>';
                break;
        }
    });
})();
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
