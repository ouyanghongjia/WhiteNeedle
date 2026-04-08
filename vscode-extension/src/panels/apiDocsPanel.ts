import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';

export interface BundledDocMeta {
    id: string;
    fileName: string;
    title: string;
    content: string;
}

/** Order in sidebar; unlisted files still appear at end (sorted). */
const DOC_ORDER: string[] = [
    'README.md',
    'api-mcp-tools.md',
    'api-engine.md',
    'api-objc-bridge.md',
    'api-define.md',
    'api-hook-engine.md',
    'api-block-bridge.md',
    'api-native-bridge.md',
    'api-cookies.md',
    'api-userdefaults.md',
    'api-filesystem.md',
    'api-sqlite.md',
    'api-performance.md',
    'api-uidebug.md',
];

function titleFromMarkdown(fileName: string, content: string): string {
    const m = content.match(/^#\s+(.+)$/m);
    if (m) {
        return m[1].trim();
    }
    return fileName.replace(/^api-/, '').replace(/\.md$/i, '');
}

export function loadBundledDocs(extensionPath: string): BundledDocMeta[] {
    const dir = path.join(extensionPath, 'bundled-docs');
    if (!fs.existsSync(dir)) {
        return [];
    }
    const names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    const metas: BundledDocMeta[] = names.map((fileName) => {
        const full = path.join(dir, fileName);
        const content = fs.readFileSync(full, 'utf-8');
        return {
            id: fileName,
            fileName,
            title: titleFromMarkdown(fileName, content),
            content,
        };
    });
    const orderIndex = (name: string) => {
        const i = DOC_ORDER.indexOf(name);
        return i === -1 ? 999 : i;
    };
    metas.sort((a, b) => {
        const d = orderIndex(a.fileName) - orderIndex(b.fileName);
        return d !== 0 ? d : a.fileName.localeCompare(b.fileName);
    });
    return metas;
}

export class ApiDocsPanel {
    public static currentPanel: ApiDocsPanel | undefined;
    private static readonly viewType = 'whiteneedle.apiDocsPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri): ApiDocsPanel {
        const column = vscode.ViewColumn.Beside;
        if (ApiDocsPanel.currentPanel) {
            ApiDocsPanel.currentPanel.panel.reveal(column);
            ApiDocsPanel.currentPanel.refreshDocs();
            return ApiDocsPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(
            ApiDocsPanel.viewType,
            'WhiteNeedle API Docs',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            },
        );
        ApiDocsPanel.currentPanel = new ApiDocsPanel(panel, extensionUri);
        return ApiDocsPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg: { type?: string }) => {
                if (msg?.type === 'ready') {
                    this.pushDocs();
                }
            },
            null,
            this.disposables,
        );
        this.panel.webview.html = this.getHtml();
    }

    private refreshDocs(): void {
        this.pushDocs();
    }

    private pushDocs(): void {
        const docs = loadBundledDocs(this.extensionUri.fsPath);
        const payload = docs.map((d) => ({
            id: d.id,
            title: d.title,
            fileName: d.fileName,
            html: marked.parse(d.content, { async: false }) as string,
            text: d.content,
        }));
        void this.panel.webview.postMessage({ type: 'docs', payload });
    }

    private getHtml(): string {
        const csp = [
            `default-src 'none'`,
            `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
            `script-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --list-hover: var(--vscode-list-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --link: var(--vscode-textLink-foreground);
      --code-bg: var(--vscode-textCodeBlock-background);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
    .toolbar input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--border);
      background: var(--input-bg);
      color: var(--input-fg);
      border-radius: 4px;
    }
    .toolbar .hint { opacity: 0.75; font-size: 0.9em; white-space: nowrap; }
    .main {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .sidebar {
      width: 260px;
      min-width: 180px;
      border-right: 1px solid var(--border);
      overflow: auto;
      flex-shrink: 0;
    }
    .sidebar button {
      display: block;
      width: 100%;
      text-align: left;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--fg);
      cursor: pointer;
      font-size: inherit;
      border-bottom: 1px solid var(--border);
    }
    .sidebar button:hover { background: var(--list-hover); }
    .sidebar button.active { background: var(--list-hover); font-weight: 600; }
    .sidebar button .sub { font-size: 0.85em; opacity: 0.7; }
    .content {
      flex: 1;
      overflow: auto;
      padding: 12px 20px 40px;
      line-height: 1.55;
    }
    .content h1 { font-size: 1.35em; margin-top: 0; }
    .content h2 { font-size: 1.15em; margin-top: 1.2em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
    .content h3 { font-size: 1.05em; }
    .content code {
      font-family: var(--vscode-editor-font-family);
      background: var(--code-bg);
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.92em;
    }
    .content pre {
      background: var(--code-bg);
      padding: 10px 12px;
      overflow: auto;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .content pre code { padding: 0; background: none; }
    .content a { color: var(--link); }
    .content table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    .content th, .content td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
    .empty {
      padding: 24px;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <input type="search" id="search" placeholder="搜索文档标题与正文…" autocomplete="off" />
    <span class="hint">内置 · 离线</span>
  </div>
  <div class="main">
    <nav class="sidebar" id="list"></nav>
    <article class="content" id="view">
      <div class="empty">正在加载文档…</div>
    </article>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let allDocs = [];
    let activeId = null;

    function normalize(s) {
      return (s || '').toLowerCase();
    }

    function matches(doc, q) {
      if (!q) return true;
      const n = normalize(q);
      return normalize(doc.title).includes(n) || normalize(doc.fileName).includes(n) || normalize(doc.text).includes(n);
    }

    function renderList(q) {
      const el = document.getElementById('list');
      el.innerHTML = '';
      const filtered = allDocs.filter(d => matches(d, q));
      if (filtered.length === 0) {
        el.innerHTML = '<div class="empty">无匹配文档</div>';
        return;
      }
      filtered.forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = d.id === activeId ? 'active' : '';
        btn.innerHTML = '<div>' + escapeHtml(d.title) + '</div><div class="sub">' + escapeHtml(d.fileName) + '</div>';
        btn.onclick = () => selectDoc(d.id);
        el.appendChild(btn);
      });
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function selectDoc(id) {
      activeId = id;
      const doc = allDocs.find(d => d.id === id);
      const view = document.getElementById('view');
      if (doc) {
        view.innerHTML = doc.html;
      } else {
        view.innerHTML = '<div class="empty">未找到文档</div>';
      }
      const q = document.getElementById('search').value;
      renderList(q);
    }

    document.getElementById('search').addEventListener('input', (e) => {
      renderList(e.target.value.trim());
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'docs' && Array.isArray(msg.payload)) {
        allDocs = msg.payload;
        activeId = allDocs[0] ? allDocs[0].id : null;
        renderList('');
        if (activeId) selectDoc(activeId);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }

    public dispose(): void {
        ApiDocsPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
