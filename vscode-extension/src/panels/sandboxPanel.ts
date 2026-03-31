import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DeviceManager } from '../device/deviceManager';

interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    mtime: number;
}

export class SandboxPanel {
    public static currentPanel: SandboxPanel | undefined;
    private static readonly viewType = 'whiteneedle.sandboxPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager
    ): SandboxPanel {
        const column = vscode.ViewColumn.One;

        if (SandboxPanel.currentPanel) {
            SandboxPanel.currentPanel.panel.reveal(column);
            return SandboxPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            SandboxPanel.viewType,
            'Sandbox Files',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        SandboxPanel.currentPanel = new SandboxPanel(panel, deviceManager);
        return SandboxPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager) {
        this.panel = panel;
        this.deviceManager = deviceManager;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'listDir':
                        await this.listDir(msg.path);
                        break;
                    case 'readFile':
                        await this.readFile(msg.path, msg.name);
                        break;
                    case 'downloadFile':
                        await this.downloadFile(msg.path, msg.name, msg.size);
                        break;
                    case 'downloadFolder':
                        await this.downloadFolder(msg.path, msg.name);
                        break;
                    case 'deleteEntry':
                        await this.deleteEntry(msg.path, msg.name);
                        break;
                    case 'uploadFile':
                        await this.uploadFile(msg.targetDir);
                        break;
                    case 'writeText':
                        await this.writeText(msg.path, msg.content);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    private async listDir(dirPath: string): Promise<void> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        try {
            const code = `JSON.stringify(FileSystem.list('${dirPath.replace(/'/g, "\\'")}'))`;
            const raw = await this.deviceManager.evaluate(code) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const entries: FileEntry[] = JSON.parse(parsed);
            entries.sort((a, b) => {
                if (a.isDir !== b.isDir) { return a.isDir ? -1 : 1; }
                return a.name.localeCompare(b.name);
            });
            this.postMessage({ command: 'dirListed', path: dirPath, entries });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to list: ${err.message}` });
        }
    }

    private async readFile(filePath: string, name: string): Promise<void> {
        try {
            const code = `FileSystem.read('${filePath.replace(/'/g, "\\'")}')`;
            const raw = await this.deviceManager.evaluate(code) as any;
            const content = typeof raw === 'string' ? raw : raw?.value ?? '';

            if (content === null || content === 'null') {
                vscode.window.showWarningMessage('Could not read file (binary or inaccessible).');
                return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content,
                language: guessLanguage(name),
            });
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to read: ${err.message}` });
        }
    }

    private async downloadFile(filePath: string, name: string, size: number): Promise<void> {
        const defaultUri = vscode.Uri.file(
            path.join(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir(),
                name
            )
        );
        const dest = await vscode.window.showSaveDialog({ defaultUri, title: `Save "${name}" to...` });
        if (!dest) { return; }

        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Downloading ${name}...`, cancellable: false },
                async () => {
                    const code = `FileSystem.readBytes('${filePath.replace(/'/g, "\\'")}')`;
                    const raw = await this.deviceManager.evaluate(code) as any;
                    const b64 = typeof raw === 'string' ? raw : raw?.value ?? '';
                    if (!b64 || b64 === 'null') { throw new Error('File is empty or inaccessible'); }
                    fs.writeFileSync(dest.fsPath, Buffer.from(b64, 'base64'));
                }
            );
            vscode.window.showInformationMessage(`Downloaded: ${name} (${formatSize(size)})`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Download failed: ${err.message}`);
        }
    }

    private async downloadFolder(folderPath: string, name: string): Promise<void> {
        const destFolder = await vscode.window.showOpenDialog({
            canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
            title: `Choose destination for "${name}"`,
        });
        if (!destFolder || destFolder.length === 0) { return; }

        const localRoot = path.join(destFolder[0].fsPath, name);
        try {
            let downloaded = 0;
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Downloading ${name}/...`, cancellable: false },
                async (progress) => {
                    downloaded = await this.downloadDirRecursive(folderPath, localRoot, progress);
                }
            );
            vscode.window.showInformationMessage(`Downloaded ${downloaded} files to ${localRoot}`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Download failed: ${err.message}`);
        }
    }

    private async downloadDirRecursive(
        remotePath: string, localPath: string,
        progress: vscode.Progress<{ message?: string }>
    ): Promise<number> {
        fs.mkdirSync(localPath, { recursive: true });
        const code = `JSON.stringify(FileSystem.list('${remotePath.replace(/'/g, "\\'")}'))`;
        const raw = await this.deviceManager.evaluate(code) as any;
        const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
        const entries: FileEntry[] = JSON.parse(parsed);

        let count = 0;
        for (const entry of entries) {
            const localItemPath = path.join(localPath, entry.name);
            if (entry.isDir) {
                count += await this.downloadDirRecursive(entry.path, localItemPath, progress);
            } else {
                progress.report({ message: entry.name });
                const readCode = `FileSystem.readBytes('${entry.path.replace(/'/g, "\\'")}')`;
                const b64Raw = await this.deviceManager.evaluate(readCode) as any;
                const b64 = typeof b64Raw === 'string' ? b64Raw : b64Raw?.value ?? '';
                if (b64 && b64 !== 'null') {
                    fs.writeFileSync(localItemPath, Buffer.from(b64, 'base64'));
                    count++;
                }
            }
        }
        return count;
    }

    private async uploadFile(targetDir: string): Promise<void> {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            title: 'Select files to upload to device',
        });
        if (!files || files.length === 0) { return; }

        try {
            let uploaded = 0;
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Uploading files...', cancellable: false },
                async (progress) => {
                    for (const file of files) {
                        const name = path.basename(file.fsPath);
                        progress.report({ message: name });
                        const data = fs.readFileSync(file.fsPath);
                        const b64 = data.toString('base64');
                        const remotePath = targetDir.endsWith('/')
                            ? targetDir + name
                            : targetDir + '/' + name;
                        const code = `FileSystem.writeBytes('${remotePath.replace(/'/g, "\\'")}', '${b64}')`;
                        await this.deviceManager.evaluate(code);
                        uploaded++;
                    }
                }
            );
            vscode.window.showInformationMessage(`Uploaded ${uploaded} file(s) to ${targetDir}`);
            await this.listDir(targetDir);
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Upload failed: ${err.message}` });
        }
    }

    private async writeText(filePath: string, content: string): Promise<void> {
        try {
            const escaped = content.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
            const code = `FileSystem.write('${filePath.replace(/'/g, "\\'")}', '${escaped}')`;
            await this.deviceManager.evaluate(code);
            this.postMessage({ command: 'writeSuccess', path: filePath });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Write failed: ${err.message}` });
        }
    }

    private async deleteEntry(entryPath: string, name: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `Delete "${name}"?`, { modal: true }, 'Delete'
        );
        if (confirm !== 'Delete') { return; }

        try {
            const code = `FileSystem.remove('${entryPath.replace(/'/g, "\\'")}')`;
            await this.deviceManager.evaluate(code);
            this.postMessage({ command: 'entryDeleted', path: entryPath });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to delete: ${err.message}` });
        }
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        SandboxPanel.currentPanel = undefined;
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
<title>Sandbox Files</title>
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
        --list-hover: var(--vscode-list-hoverBackground);
        --error-fg: var(--vscode-errorForeground, #f44);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); }

    .toolbar { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); align-items: center; position: sticky; top: 0; background: var(--bg); z-index: 10; }
    .breadcrumb { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; flex: 1; min-width: 0; }
    .breadcrumb span { cursor: pointer; padding: 2px 6px; border-radius: 3px; white-space: nowrap; }
    .breadcrumb span:hover { background: var(--list-hover); }
    .breadcrumb .sep { opacity: 0.4; cursor: default; padding: 0 2px; }
    .breadcrumb .sep:hover { background: transparent; }
    button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
    button:hover { background: var(--btn-hover); }
    button.danger { background: var(--error-fg); }
    button.small { padding: 2px 6px; font-size: 11px; }

    .file-list { padding: 4px 0; }
    .file-row { display: flex; align-items: center; padding: 4px 12px; gap: 10px; cursor: pointer; }
    .file-row:hover { background: var(--list-hover); }
    .file-row .icon { width: 20px; text-align: center; flex-shrink: 0; }
    .file-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-row .meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
    .file-row .actions { display: flex; gap: 4px; opacity: 0; }
    .file-row:hover .actions { opacity: 1; }

    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg); z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .toast.error { background: var(--error-fg); }
</style>
</head>
<body>
<div class="toolbar">
    <div class="breadcrumb" id="breadcrumb"></div>
    <button id="uploadBtn">⬆ Upload</button>
    <button id="refreshBtn">↻ Refresh</button>
</div>
<div id="fileList" class="file-list">
    <div class="empty">Click ↻ Refresh to browse sandbox</div>
</div>
<div class="toast" id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
let currentPath = '/';
let pathStack = ['/'];

function navigateTo(dirPath) {
    currentPath = dirPath;
    const parts = dirPath.split('/').filter(Boolean);
    pathStack = ['/'];
    let acc = '/';
    parts.forEach(p => { acc += p + '/'; pathStack.push(acc); });
    renderBreadcrumb();
    vscode.postMessage({ command: 'listDir', path: dirPath });
}

function renderBreadcrumb() {
    const el = document.getElementById('breadcrumb');
    let html = '<span onclick="navigateTo(\\'/\\')">📱 /</span>';
    const parts = currentPath.split('/').filter(Boolean);
    let acc = '/';
    parts.forEach((p, i) => {
        acc += p + '/';
        const isLast = i === parts.length - 1;
        html += '<span class="sep">/</span>';
        html += '<span onclick="navigateTo(\\'' + escJ(acc.replace(/\\/$/, '')) + '\\')">' + escH(p) + '</span>';
    });
    el.innerHTML = html;
}

document.getElementById('refreshBtn').addEventListener('click', () => {
    navigateTo(currentPath);
});
document.getElementById('uploadBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'uploadFile', targetDir: currentPath });
});

function renderEntries(entries) {
    const el = document.getElementById('fileList');
    if (!entries || entries.length === 0) {
        el.innerHTML = '<div class="empty">Empty directory</div>';
        return;
    }
    let html = '';
    entries.forEach(e => {
        html += '<div class="file-row">';
        if (e.isDir) {
            html += '<span class="icon">📁</span>';
            html += '<span class="name" onclick="navigateTo(\\'' + escJ(e.path) + '\\')">' + escH(e.name) + '</span>';
            html += '<span class="meta"></span>';
            html += '<span class="actions">';
            html += '<button class="small" onclick="event.stopPropagation();downloadFolder(\\'' + escJ(e.path) + '\\',\\'' + escJ(e.name) + '\\')">⬇</button>';
            html += '<button class="small danger" onclick="event.stopPropagation();deleteEntry(\\'' + escJ(e.path) + '\\',\\'' + escJ(e.name) + '\\')">✕</button>';
            html += '</span>';
        } else {
            const icon = getIcon(e.name);
            html += '<span class="icon">' + icon + '</span>';
            html += '<span class="name" onclick="readFile(\\'' + escJ(e.path) + '\\',\\'' + escJ(e.name) + '\\')">' + escH(e.name) + '</span>';
            html += '<span class="meta">' + formatSize(e.size) + '</span>';
            html += '<span class="actions">';
            html += '<button class="small" onclick="event.stopPropagation();downloadFile(\\'' + escJ(e.path) + '\\',\\'' + escJ(e.name) + '\\',' + e.size + ')">⬇</button>';
            html += '<button class="small danger" onclick="event.stopPropagation();deleteEntry(\\'' + escJ(e.path) + '\\',\\'' + escJ(e.name) + '\\')">✕</button>';
            html += '</span>';
        }
        html += '</div>';
    });
    el.innerHTML = html;
}

function readFile(p, name) { vscode.postMessage({ command: 'readFile', path: p, name }); }
function downloadFile(p, name, size) { vscode.postMessage({ command: 'downloadFile', path: p, name, size }); }
function downloadFolder(p, name) { vscode.postMessage({ command: 'downloadFolder', path: p, name }); }
function deleteEntry(p, name) { vscode.postMessage({ command: 'deleteEntry', path: p, name }); }

function getIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { plist:'📄', json:'📋', js:'📜', db:'🗃️', sqlite:'🗃️', sqlite3:'🗃️', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', webp:'🖼️', log:'📝', txt:'📝' };
    return map[ext] || '📄';
}
function formatSize(b) {
    if (!b) return '0 B';
    const u = ['B','KB','MB','GB'];
    const i = Math.min(Math.floor(Math.log(b)/Math.log(1024)), u.length-1);
    return (b/Math.pow(1024,i)).toFixed(i===0?0:1) + ' ' + u[i];
}

window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {
        case 'dirListed':
            renderEntries(msg.entries);
            break;
        case 'entryDeleted':
            navigateTo(currentPath);
            showToast('Deleted');
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

navigateTo('/');
</script>
</body>
</html>`;
    }
}

function formatSize(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function guessLanguage(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'json': return 'json';
        case 'plist': case 'xml': return 'xml';
        case 'js': return 'javascript';
        case 'html': return 'html';
        case 'css': return 'css';
        case 'sql': return 'sql';
        default: return 'plaintext';
    }
}
