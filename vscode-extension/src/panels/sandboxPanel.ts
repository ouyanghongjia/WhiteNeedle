import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DeviceManager } from '../device/deviceManager';
import { bindConnectionState, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    mtime: number;
}

interface SnapshotEntry {
    path: string;
    size: number;
    mtime: number;
    isDir: boolean;
}

interface FileEvent {
    time: number;
    type: 'added' | 'removed' | 'modified' | 'moved';
    path: string;
    oldPath?: string;
    size: number;
    sizeDelta?: number;
    isDir: boolean;
}

export class SandboxPanel {
    public static currentPanel: SandboxPanel | undefined;
    private static readonly viewType = 'whiteneedle.sandboxPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private disposables: vscode.Disposable[] = [];

    private monitorTimer: ReturnType<typeof setInterval> | undefined;
    private prevSnapshot: Map<string, SnapshotEntry> = new Map();
    private monitorRunning = false;

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
            { enableScripts: true, retainContextWhenHidden: true }
        );

        SandboxPanel.currentPanel = new SandboxPanel(panel, deviceManager);
        return SandboxPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, deviceManager: DeviceManager) {
        this.panel = panel;
        this.deviceManager = deviceManager;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        bindConnectionState(this.panel, this.deviceManager, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                const esc = (s: string) => s.replace(/'/g, "\\'");
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
                    case 'rename':
                        await this.doRename(msg.oldPath, msg.newName);
                        break;
                    case 'paste':
                        await this.doPaste(msg.sourcePath, msg.targetDir, msg.op);
                        break;
                    case 'startMonitor':
                        await this.startMonitor(msg.paths, msg.interval);
                        break;
                    case 'stopMonitor':
                        this.stopMonitor();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    // ── Files Tab handlers ──

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
            const doc = await vscode.workspace.openTextDocument({ content, language: guessLanguage(name) });
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to read: ${err.message}` });
        }
    }

    private async downloadFile(filePath: string, name: string, size: number): Promise<void> {
        const defaultUri = vscode.Uri.file(
            path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir(), name)
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
                async (progress) => { downloaded = await this.downloadDirRecursive(folderPath, localRoot, progress); }
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
                if (b64 && b64 !== 'null') { fs.writeFileSync(localItemPath, Buffer.from(b64, 'base64')); count++; }
            }
        }
        return count;
    }

    private async uploadFile(targetDir: string): Promise<void> {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
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
                        const remotePath = targetDir.endsWith('/') ? targetDir + name : targetDir + '/' + name;
                        await this.deviceManager.evaluate(`FileSystem.writeBytes('${remotePath.replace(/'/g, "\\'")}', '${b64}')`);
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
            await this.deviceManager.evaluate(`FileSystem.write('${filePath.replace(/'/g, "\\'")}', '${escaped}')`);
            this.postMessage({ command: 'writeSuccess', path: filePath });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Write failed: ${err.message}` });
        }
    }

    private async deleteEntry(entryPath: string, name: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(`Delete "${name}"?`, { modal: true }, 'Delete');
        if (confirm !== 'Delete') { return; }
        try {
            await this.deviceManager.evaluate(`FileSystem.remove('${entryPath.replace(/'/g, "\\'")}')`);
            this.postMessage({ command: 'entryDeleted', path: entryPath });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Failed to delete: ${err.message}` });
        }
    }

    private async doRename(oldPath: string, newName: string): Promise<void> {
        try {
            const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
            const newPath = parentDir + '/' + newName;
            const esc = (s: string) => s.replace(/'/g, "\\'");
            const result = await this.deviceManager.evaluate(`FileSystem.move('${esc(oldPath)}', '${esc(newPath)}')`);
            if (result === false || result === 'false') { throw new Error('Rename failed on device'); }
            this.postMessage({ command: 'opDone', toast: 'Renamed' });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Rename failed: ${err.message}` });
        }
    }

    private async doPaste(sourcePath: string, targetDir: string, op: string): Promise<void> {
        try {
            const esc = (s: string) => s.replace(/'/g, "\\'");
            const dirNorm = targetDir.endsWith('/') ? targetDir : targetDir + '/';

            const rawList = await this.deviceManager.evaluate(
                `JSON.stringify(FileSystem.list('${esc(targetDir)}'))`
            ) as any;
            const listStr = typeof rawList === 'string' ? rawList : rawList?.value ?? '[]';
            const existing: FileEntry[] = JSON.parse(listStr);
            const existingNames = new Set(existing.map(e => e.name));

            const srcName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
            const destName = this.resolveUniqueName(srcName, existingNames);
            const dest = dirNorm + destName;

            const fn = op === 'cut' ? 'move' : 'copy';
            const result = await this.deviceManager.evaluate(
                `FileSystem.${fn}('${esc(sourcePath)}', '${esc(dest)}')`
            );
            if (result === false || result === 'false') {
                throw new Error(`${fn} failed on device`);
            }
            const verb = op === 'cut' ? 'Moved' : 'Copied';
            const toast = destName !== srcName ? `${verb} → ${destName}` : verb;
            this.postMessage({ command: 'opDone', toast, clearClipboard: true });
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Paste failed: ${err.message}` });
        }
    }

    private resolveUniqueName(name: string, existingNames: Set<string>): string {
        if (!existingNames.has(name)) { return name; }
        const dotIdx = name.lastIndexOf('.');
        const base = dotIdx > 0 ? name.substring(0, dotIdx) : name;
        const ext = dotIdx > 0 ? name.substring(dotIdx) : '';

        const re = new RegExp(
            '^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\((\\d+)\\)' + ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
        );
        let max = 0;
        for (const n of existingNames) {
            const m = n.match(re);
            if (m) { max = Math.max(max, parseInt(m[1], 10)); }
        }
        return `${base} (${max + 1})${ext}`;
    }

    // ── Monitor logic ──

    private async takeSnapshot(paths: string[]): Promise<Map<string, SnapshotEntry>> {
        const pathsJson = JSON.stringify(paths);
        const code = `JSON.stringify(FileSystem.snapshot(${pathsJson}, 10))`;
        const raw = await this.deviceManager.evaluate(code) as any;
        const parsed = typeof raw === 'string' ? raw : raw?.value ?? '[]';
        const entries: SnapshotEntry[] = JSON.parse(parsed);
        const map = new Map<string, SnapshotEntry>();
        for (const e of entries) { map.set(e.path, e); }
        return map;
    }

    private diffSnapshots(prev: Map<string, SnapshotEntry>, curr: Map<string, SnapshotEntry>): FileEvent[] {
        const now = Date.now();
        const added: FileEvent[] = [];
        const removed: FileEvent[] = [];
        const modified: FileEvent[] = [];
        for (const [p, ce] of curr) {
            const pe = prev.get(p);
            if (!pe) {
                added.push({ time: now, type: 'added', path: p, size: ce.size, isDir: ce.isDir });
            } else if (pe.size !== ce.size || pe.mtime !== ce.mtime) {
                modified.push({ time: now, type: 'modified', path: p, size: ce.size, sizeDelta: ce.size - pe.size, isDir: ce.isDir });
            }
        }
        for (const [p, pe] of prev) {
            if (!curr.has(p)) { removed.push({ time: now, type: 'removed', path: p, size: pe.size, isDir: pe.isDir }); }
        }
        const events: FileEvent[] = [...modified];
        const unmatchedAdded = [...added];
        const unmatchedRemoved = [...removed];
        for (let ri = unmatchedRemoved.length - 1; ri >= 0; ri--) {
            const re = unmatchedRemoved[ri];
            const ai = unmatchedAdded.findIndex(ae =>
                ae.size === re.size && ae.isDir === re.isDir &&
                prev.get(re.path)?.mtime === curr.get(ae.path)?.mtime
            );
            if (ai >= 0) {
                const ae = unmatchedAdded[ai];
                events.push({ time: now, type: 'moved', path: ae.path, oldPath: re.path, size: ae.size, isDir: ae.isDir });
                unmatchedAdded.splice(ai, 1);
                unmatchedRemoved.splice(ri, 1);
            }
        }
        events.push(...unmatchedAdded, ...unmatchedRemoved);
        return events;
    }

    private async startMonitor(paths: string[], intervalMs: number): Promise<void> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return;
        }
        this.stopMonitor();
        try {
            this.prevSnapshot = await this.takeSnapshot(paths);
            this.monitorRunning = true;
            this.postMessage({ command: 'monitorStarted', fileCount: this.prevSnapshot.size });
            this.monitorTimer = setInterval(async () => {
                if (!this.monitorRunning || !this.deviceManager.isConnected) { this.stopMonitor(); return; }
                try {
                    const curr = await this.takeSnapshot(paths);
                    const events = this.diffSnapshots(this.prevSnapshot, curr);
                    this.prevSnapshot = curr;
                    if (events.length > 0) { this.postMessage({ command: 'monitorEvents', events, fileCount: curr.size }); }
                } catch { /* retry next tick */ }
            }, intervalMs);
        } catch (err: any) {
            this.postMessage({ command: 'error', text: `Monitor failed: ${err.message}` });
        }
    }

    private stopMonitor(): void {
        if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = undefined; }
        if (this.monitorRunning) { this.monitorRunning = false; this.postMessage({ command: 'monitorStopped' }); }
    }

    private postMessage(msg: any): void { this.panel.webview.postMessage(msg); }

    public dispose(): void {
        this.stopMonitor();
        SandboxPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) { const d = this.disposables.pop(); if (d) { d.dispose(); } }
    }

    // ── HTML ──

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
    --list-active: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.1));
    --error-fg: var(--vscode-errorForeground, #f44);
    --green: #4ec9b0; --red: #f44747; --yellow: #dcdcaa; --blue: #569cd6;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); }

.tab-bar { display: flex; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 20; }
.tab-btn { padding: 8px 18px; cursor: pointer; border: none; background: transparent; color: var(--fg); font-size: 13px; opacity: 0.6; border-bottom: 2px solid transparent; }
.tab-btn:hover { opacity: 0.85; }
.tab-btn.active { opacity: 1; border-bottom-color: var(--btn-bg); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }

.toolbar { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); align-items: center; position: sticky; top: 36px; background: var(--bg); z-index: 10; }
.breadcrumb { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; flex: 1; min-width: 0; }
.breadcrumb span { cursor: pointer; padding: 2px 6px; border-radius: 3px; white-space: nowrap; }
.breadcrumb span:hover { background: var(--list-hover); }
.breadcrumb .sep { opacity: 0.4; cursor: default; padding: 0 2px; }
.breadcrumb .sep:hover { background: transparent; }
button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
button:hover { background: var(--btn-hover); }
button.danger { background: var(--error-fg); }
button.small { padding: 2px 6px; font-size: 11px; }
button:disabled { opacity: 0.4; cursor: default; }

.file-list { padding: 4px 0; }
.file-row { display: flex; align-items: center; padding: 4px 12px; gap: 10px; cursor: default; user-select: none; }
.file-row:hover { background: var(--list-hover); }
.file-row.selected { background: var(--list-active); }
.file-row.cut-item { opacity: 0.45; }
.file-row .icon { width: 20px; text-align: center; flex-shrink: 0; }
.file-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.file-row .name-input { flex: 1; min-width: 0; padding: 1px 4px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--btn-bg); border-radius: 2px; font: inherit; outline: none; }
.file-row .meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
.file-row .actions { display: flex; gap: 4px; opacity: 0; }
.file-row:hover .actions { opacity: 1; }
.empty { text-align: center; padding: 40px; opacity: 0.5; }

/* context menu */
.ctx-menu { position: fixed; z-index: 999; background: var(--vscode-menu-background, var(--bg)); border: 1px solid var(--vscode-menu-border, var(--border)); border-radius: 4px; padding: 4px 0; min-width: 160px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); overflow: visible; }
.ctx-menu .ctx-item { padding: 5px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.ctx-menu .ctx-item:hover { background: var(--list-hover); }
.ctx-menu .ctx-item.disabled { opacity: 0.4; pointer-events: none; }
.ctx-menu .ctx-sep { border-top: 1px solid var(--border); margin: 4px 0; }
.ctx-menu .ctx-shortcut { opacity: 0.5; font-size: 11px; margin-left: 20px; }

/* monitor tab */
.mon-toolbar { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; position: sticky; top: 36px; background: var(--bg); z-index: 10; }
.mon-toolbar select { padding: 3px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }
.mon-toolbar label { font-size: 12px; display: flex; align-items: center; gap: 3px; cursor: pointer; }
.mon-toolbar label input[type="checkbox"] { cursor: pointer; }
.mon-stats { padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 12px; opacity: 0.8; display: flex; gap: 14px; flex-wrap: wrap; }
.mon-stats .stat-added { color: var(--green); } .mon-stats .stat-removed { color: var(--red); }
.mon-stats .stat-modified { color: var(--yellow); } .mon-stats .stat-moved { color: var(--blue); }
.mon-filter { padding: 6px 12px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; }
.mon-filter input { flex: 1; padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }
.mon-filter select { padding: 3px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }
.mon-log { padding: 4px 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
.mon-row { padding: 3px 12px; display: flex; gap: 8px; align-items: baseline; }
.mon-row:hover { background: var(--list-hover); }
.mon-time { opacity: 0.5; flex-shrink: 0; width: 60px; }
.mon-type { flex-shrink: 0; width: 16px; text-align: center; font-weight: bold; }
.mon-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mon-size { opacity: 0.6; flex-shrink: 0; white-space: nowrap; font-size: 11px; }
.type-added .mon-type { color: var(--green); } .type-removed .mon-type { color: var(--red); }
.type-modified .mon-type { color: var(--yellow); } .type-moved .mon-type { color: var(--blue); }
.type-info { opacity: 0.5; } .type-info .mon-type { opacity: 0.5; }

.toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg); z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
.toast.show { opacity: 1; }
.toast.error { background: var(--error-fg); }
${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}

<div class="tab-bar">
    <button class="tab-btn active" data-tab="files">📁 Files</button>
    <button class="tab-btn" data-tab="monitor">📡 Monitor</button>
</div>

<div class="tab-panel active" id="tab-files">
    <div class="toolbar">
        <div class="breadcrumb" id="breadcrumb"></div>
        <button id="pasteBtn" style="display:none" title="Paste here">📋 Paste</button>
        <button id="uploadBtn">⬆ Upload</button>
        <button id="refreshBtn">↻</button>
    </div>
    <div id="fileList" class="file-list">
        <div class="empty">Loading…</div>
    </div>
</div>

<div class="tab-panel" id="tab-monitor">
    <div class="mon-toolbar">
        <button id="monStartBtn">▶ Start</button>
        <button id="monStopBtn" disabled>⏹ Stop</button>
        <button id="monClearBtn">🗑 Clear</button>
        <span style="opacity:0.5">Interval:</span>
        <select id="monInterval">
            <option value="1000">1s</option>
            <option value="2000" selected>2s</option>
            <option value="5000">5s</option>
            <option value="10000">10s</option>
            <option value="30000">30s</option>
        </select>
        <span style="opacity:0.5;margin-left:8px">Paths:</span>
        <label><input type="checkbox" class="mon-path-cb" value="Documents" checked> Documents</label>
        <label><input type="checkbox" class="mon-path-cb" value="Library" checked> Library</label>
        <label><input type="checkbox" class="mon-path-cb" value="tmp" checked> tmp</label>
    </div>
    <div class="mon-stats" id="monStats">
        <span id="statTotal">📁 —</span>
        <span class="stat-added" id="statAdded">+0</span>
        <span class="stat-removed" id="statRemoved">−0</span>
        <span class="stat-modified" id="statModified">~0</span>
        <span class="stat-moved" id="statMoved">→0</span>
    </div>
    <div class="mon-filter">
        <input id="monFilterPath" type="text" placeholder="Filter by path…" />
        <select id="monFilterType">
            <option value="all">All</option>
            <option value="added">+ Added</option>
            <option value="removed">− Removed</option>
            <option value="modified">~ Modified</option>
            <option value="moved">→ Moved</option>
        </select>
    </div>
    <div class="mon-log" id="monLog">
        <div class="empty">Click ▶ Start to begin monitoring file changes</div>
    </div>
</div>

<div class="ctx-menu" id="ctxMenu" style="display:none"></div>
<div class="toast" id="toast"></div>

<script>
${OVERLAY_JS}
const vscode = acquireVsCodeApi();

// ─── Tab switching ───
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// ═══════════════ Files Tab ═══════════════
let currentPath = '/';
let currentEntries = [];
let clipboard = null; // { path, name, isDir, op: 'cut'|'copy' }
let selectedEntry = null; // { path, name, isDir, size }

function navigateTo(dir) {
    currentPath = dir;
    renderBreadcrumb();
    vscode.postMessage({ command: 'listDir', path: dir });
}

function renderBreadcrumb() {
    const el = document.getElementById('breadcrumb');
    let html = '<span onclick="navigateTo(\\'/\\')">📱 /</span>';
    const parts = currentPath.split('/').filter(Boolean);
    let acc = '/';
    parts.forEach(p => {
        acc += p + '/';
        const target = acc.replace(/\\/$/, '');
        html += '<span class="sep">/</span><span onclick="navigateTo(\\'' + escJ(target) + '\\')">' + escH(p) + '</span>';
    });
    el.innerHTML = html;
}

document.getElementById('refreshBtn').addEventListener('click', () => navigateTo(currentPath));
document.getElementById('uploadBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'uploadFile', targetDir: currentPath });
});
document.getElementById('pasteBtn').addEventListener('click', () => {
    if (clipboard) doPaste();
});

function updatePasteBtn() {
    const btn = document.getElementById('pasteBtn');
    if (clipboard) {
        btn.style.display = '';
        btn.textContent = (clipboard.op === 'cut' ? '📋 Paste (move)' : '📋 Paste (copy)');
    } else {
        btn.style.display = 'none';
    }
}

function renderEntries(entries) {
    currentEntries = entries;
    const el = document.getElementById('fileList');
    if (!entries || entries.length === 0) {
        el.innerHTML = '<div class="empty">Empty directory</div>';
        return;
    }
    el.innerHTML = '';
    entries.forEach(e => {
        const row = document.createElement('div');
        row.className = 'file-row';
        if (clipboard && clipboard.op === 'cut' && clipboard.path === e.path) row.classList.add('cut-item');
        row.dataset.path = e.path;
        row.dataset.name = e.name;
        row.dataset.isDir = e.isDir ? '1' : '0';
        row.dataset.size = String(e.size);

        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = e.isDir ? '📁' : getIcon(e.name);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = e.name;

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = e.isDir ? '' : formatSize(e.size);

        const actions = document.createElement('span');
        actions.className = 'actions';
        if (e.isDir) {
            actions.innerHTML = '<button class="small" title="Download" onclick="event.stopPropagation();doDownloadFolder(this)">⬇</button>'
                + '<button class="small danger" title="Delete" onclick="event.stopPropagation();doDelete(this)">✕</button>';
        } else {
            actions.innerHTML = '<button class="small" title="Download" onclick="event.stopPropagation();doDownloadFile(this)">⬇</button>'
                + '<button class="small danger" title="Delete" onclick="event.stopPropagation();doDelete(this)">✕</button>';
        }

        row.appendChild(icon);
        row.appendChild(nameSpan);
        row.appendChild(meta);
        row.appendChild(actions);

        // click → select; double-click → open dir / read file
        row.addEventListener('click', (ev) => {
            if (ev.target.closest('.actions') || ev.target.classList.contains('name-input')) return;
            selectRow(row);
        });
        nameSpan.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            if (e.isDir) navigateTo(e.path);
            else vscode.postMessage({ command: 'readFile', path: e.path, name: e.name });
        });

        row.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            selectRow(row);
            showContextMenu(ev.clientX, ev.clientY, e);
        });

        el.appendChild(row);
    });
}

function selectRow(row) {
    document.querySelectorAll('.file-row.selected').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    selectedEntry = {
        path: row.dataset.path,
        name: row.dataset.name,
        isDir: row.dataset.isDir === '1',
        size: parseInt(row.dataset.size, 10),
    };
}

// ─── Inline rename ───
function startInlineRename(entry) {
    const row = document.querySelector('.file-row[data-path="' + CSS.escape(entry.path) + '"]');
    if (!row) return;
    const nameSpan = row.querySelector('.name');
    if (!nameSpan) return;
    const oldName = entry.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.value = oldName;

    // select filename without extension for files
    const dotIdx = !entry.isDir ? oldName.lastIndexOf('.') : -1;
    nameSpan.replaceWith(input);
    input.focus();
    if (dotIdx > 0) input.setSelectionRange(0, dotIdx);
    else input.select();

    let committed = false;
    function commit() {
        if (committed) return;
        committed = true;
        const newName = input.value.trim();
        const span = document.createElement('span');
        span.className = 'name';
        if (newName && newName !== oldName && !newName.includes('/')) {
            span.textContent = newName;
            input.replaceWith(span);
            vscode.postMessage({ command: 'rename', oldPath: entry.path, newName });
        } else {
            span.textContent = oldName;
            input.replaceWith(span);
        }
    }
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { committed = true; const s = document.createElement('span'); s.className = 'name'; s.textContent = oldName; input.replaceWith(s); }
    });
    input.addEventListener('blur', commit);
}

// ─── Context menu ───
function showContextMenu(x, y, entry) {
    const menu = document.getElementById('ctxMenu');
    const hasCB = !!clipboard;
    let html = '';
    html += '<div class="ctx-item" data-action="rename">Rename<span class="ctx-shortcut">F2</span></div>';
    html += '<div class="ctx-sep"></div>';
    html += '<div class="ctx-item" data-action="cut">Cut<span class="ctx-shortcut">⌘X</span></div>';
    html += '<div class="ctx-item" data-action="copy">Copy<span class="ctx-shortcut">⌘C</span></div>';
    html += '<div class="ctx-item' + (hasCB ? '' : ' disabled') + '" data-action="paste">Paste<span class="ctx-shortcut">⌘V</span></div>';
    html += '<div class="ctx-sep"></div>';
    if (entry.isDir) {
        html += '<div class="ctx-item" data-action="open">Open Folder</div>';
        html += '<div class="ctx-item" data-action="download">Download Folder</div>';
    } else {
        html += '<div class="ctx-item" data-action="open">Open File</div>';
        html += '<div class="ctx-item" data-action="download">Download</div>';
    }
    html += '<div class="ctx-sep"></div>';
    html += '<div class="ctx-item" style="color:var(--red)" data-action="delete">Delete</div>';
    menu.innerHTML = html;

    positionMenu(menu, x, y);

    menu.querySelectorAll('.ctx-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', () => {
            hideContextMenu();
            const a = item.dataset.action;
            if (a === 'rename') startInlineRename(entry);
            else if (a === 'cut') { clipboard = { path: entry.path, name: entry.name, isDir: entry.isDir, op: 'cut' }; updatePasteBtn(); markCutItems(); showToast('Cut: ' + entry.name); }
            else if (a === 'copy') { clipboard = { path: entry.path, name: entry.name, isDir: entry.isDir, op: 'copy' }; updatePasteBtn(); markCutItems(); showToast('Copied: ' + entry.name); }
            else if (a === 'paste') doPaste();
            else if (a === 'open') {
                if (entry.isDir) navigateTo(entry.path);
                else vscode.postMessage({ command: 'readFile', path: entry.path, name: entry.name });
            }
            else if (a === 'download') {
                if (entry.isDir) vscode.postMessage({ command: 'downloadFolder', path: entry.path, name: entry.name });
                else vscode.postMessage({ command: 'downloadFile', path: entry.path, name: entry.name, size: entry.size });
            }
            else if (a === 'delete') vscode.postMessage({ command: 'deleteEntry', path: entry.path, name: entry.name });
        });
    });
}

function positionMenu(menu, x, y) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 4) left = vw - rect.width - 4;
    if (left < 4) left = 4;
    if (top + rect.height > vh - 4) top = y - rect.height;
    if (top < 4) top = 4;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

function hideContextMenu() { document.getElementById('ctxMenu').style.display = 'none'; }
document.addEventListener('click', (e) => { if (!e.target.closest('.ctx-menu')) hideContextMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });

// also right-click on empty area → paste only
document.getElementById('fileList').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.file-row')) return;
    e.preventDefault();
    const menu = document.getElementById('ctxMenu');
    const hasCB = !!clipboard;
    menu.innerHTML = '<div class="ctx-item' + (hasCB ? '' : ' disabled') + '" data-action="paste">Paste here<span class="ctx-shortcut">⌘V</span></div>';
    positionMenu(menu, e.clientX, e.clientY);
    menu.querySelector('.ctx-item:not(.disabled)')?.addEventListener('click', () => { hideContextMenu(); doPaste(); });
});

function markCutItems() {
    document.querySelectorAll('.file-row').forEach(r => {
        r.classList.toggle('cut-item', !!(clipboard && clipboard.op === 'cut' && clipboard.path === r.dataset.path));
    });
}

function doPaste() {
    if (!clipboard) return;
    vscode.postMessage({ command: 'paste', sourcePath: clipboard.path, targetDir: currentPath, op: clipboard.op });
}

// ─── Keyboard shortcuts ───
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'F2' && selectedEntry) { e.preventDefault(); startInlineRename(selectedEntry); }
    if (mod && e.key === 'x' && selectedEntry) { e.preventDefault(); clipboard = { ...selectedEntry, op: 'cut' }; updatePasteBtn(); markCutItems(); showToast('Cut: ' + selectedEntry.name); }
    if (mod && e.key === 'c' && selectedEntry) { e.preventDefault(); clipboard = { ...selectedEntry, op: 'copy' }; updatePasteBtn(); markCutItems(); showToast('Copied: ' + selectedEntry.name); }
    if (mod && e.key === 'v' && clipboard) { e.preventDefault(); doPaste(); }
    if (e.key === 'Delete' && selectedEntry) { e.preventDefault(); vscode.postMessage({ command: 'deleteEntry', path: selectedEntry.path, name: selectedEntry.name }); }
    if (e.key === 'Enter' && selectedEntry && !e.target.closest('.name-input')) {
        e.preventDefault();
        if (selectedEntry.isDir) navigateTo(selectedEntry.path);
        else vscode.postMessage({ command: 'readFile', path: selectedEntry.path, name: selectedEntry.name });
    }
    if (e.key === 'Backspace' && !e.target.closest('.name-input')) {
        e.preventDefault();
        const parts = currentPath.split('/').filter(Boolean);
        if (parts.length > 0) { parts.pop(); navigateTo('/' + parts.join('/')); }
    }
});

// ─── helpers ───
function doDownloadFile(btn) {
    const row = btn.closest('.file-row');
    vscode.postMessage({ command: 'downloadFile', path: row.dataset.path, name: row.dataset.name, size: parseInt(row.dataset.size,10) });
}
function doDownloadFolder(btn) {
    const row = btn.closest('.file-row');
    vscode.postMessage({ command: 'downloadFolder', path: row.dataset.path, name: row.dataset.name });
}
function doDelete(btn) {
    const row = btn.closest('.file-row');
    vscode.postMessage({ command: 'deleteEntry', path: row.dataset.path, name: row.dataset.name });
}
function getIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const m = { plist:'📄', json:'📋', js:'📜', db:'🗃️', sqlite:'🗃️', sqlite3:'🗃️', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', webp:'🖼️', log:'📝', txt:'📝' };
    return m[ext] || '📄';
}
function formatSize(b) {
    if (!b) return '';
    const u = ['B','KB','MB','GB'];
    const i = Math.min(Math.floor(Math.log(Math.abs(b))/Math.log(1024)), u.length-1);
    return (Math.abs(b)/Math.pow(1024,i)).toFixed(i===0?0:1) + ' ' + u[i];
}

// ═══════════════ Monitor Tab ═══════════════
let monEvents = [];
let monTotals = { added: 0, removed: 0, modified: 0, moved: 0 };
let monFileCount = 0;
let monRunning = false;

document.getElementById('monStartBtn').addEventListener('click', () => {
    const paths = [];
    document.querySelectorAll('.mon-path-cb:checked').forEach(cb => paths.push(cb.value));
    if (paths.length === 0) { showToast('Select at least one path', true); return; }
    const interval = parseInt(document.getElementById('monInterval').value, 10);
    vscode.postMessage({ command: 'startMonitor', paths, interval });
    document.getElementById('monStartBtn').disabled = true;
});
document.getElementById('monStopBtn').addEventListener('click', () => vscode.postMessage({ command: 'stopMonitor' }));
document.getElementById('monClearBtn').addEventListener('click', () => {
    monEvents = []; monTotals = { added:0, removed:0, modified:0, moved:0 };
    renderMonLog(); updateMonStats();
});
document.getElementById('monFilterPath').addEventListener('input', renderMonLog);
document.getElementById('monFilterType').addEventListener('change', renderMonLog);

function setMonUI(running) {
    monRunning = running;
    document.getElementById('monStartBtn').disabled = running;
    document.getElementById('monStopBtn').disabled = !running;
    document.getElementById('monInterval').disabled = running;
    document.querySelectorAll('.mon-path-cb').forEach(cb => cb.disabled = running);
}
function updateMonStats() {
    document.getElementById('statTotal').textContent = '📁 ' + monFileCount.toLocaleString() + ' files';
    document.getElementById('statAdded').textContent = '+' + monTotals.added;
    document.getElementById('statRemoved').textContent = '−' + monTotals.removed;
    document.getElementById('statModified').textContent = '~' + monTotals.modified;
    document.getElementById('statMoved').textContent = '→' + monTotals.moved;
}
function renderMonLog() {
    const el = document.getElementById('monLog');
    const fp = document.getElementById('monFilterPath').value.toLowerCase();
    const ft = document.getElementById('monFilterType').value;
    let f = monEvents;
    if (fp) f = f.filter(e => (e.path||'').toLowerCase().includes(fp) || (e.oldPath||'').toLowerCase().includes(fp));
    if (ft !== 'all') f = f.filter(e => e.type === ft);
    if (f.length === 0) { el.innerHTML = '<div class="empty">' + (monEvents.length === 0 ? (monRunning ? 'Monitoring… no changes yet' : 'Click ▶ Start to begin monitoring') : 'No matching events') + '</div>'; return; }
    let h = '';
    for (const e of f) {
        const cls = 'type-' + e.type;
        const sym = {added:'+',removed:'−',modified:'~',moved:'→',info:'▶'}[e.type]||'•';
        const t = e.time ? new Date(e.time).toLocaleTimeString('en-GB',{hour12:false}) : '';
        let ph = escH(e.path), sh = '';
        if (e.type==='moved') ph = '<span style="opacity:0.5">'+escH(e.oldPath||'')+'</span> ➜ '+escH(e.path);
        if (e.type==='added'||e.type==='moved') sh = formatSize(e.size);
        else if (e.type==='modified'&&e.sizeDelta!==undefined) sh = (e.sizeDelta>=0?'+':'')+formatSize(Math.abs(e.sizeDelta));
        if (e.type==='info') ph = '<span>'+escH(e.path)+'</span>';
        h += '<div class="mon-row '+cls+'"><span class="mon-time">'+t+'</span><span class="mon-type">'+sym+'</span><span class="mon-path">'+(e.isDir?'📁 ':'')+ph+'</span><span class="mon-size">'+sh+'</span></div>';
    }
    el.innerHTML = h;
}

// ═══════════════ Message handler ═══════════════
function escH(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }
function escJ(s) { return (s||'').replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'"); }
function showToast(text, isError) {
    const t = document.getElementById('toast');
    t.textContent = text; t.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => t.className = 'toast', 2500);
}
function trimLog() { if (monEvents.length > 500) monEvents.length = 500; }

window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {
        case 'dirListed': renderEntries(msg.entries); break;
        case 'entryDeleted': navigateTo(currentPath); showToast('Deleted'); break;
        case 'opDone':
            if (msg.clearClipboard) { clipboard = null; updatePasteBtn(); }
            navigateTo(currentPath); showToast(msg.toast || 'Done');
            break;
        case 'monitorStarted':
            setMonUI(true); monFileCount = msg.fileCount || 0;
            monEvents.unshift({ time: Date.now(), type:'info', path:'Monitoring started ('+monFileCount.toLocaleString()+' files)', size:0, isDir:false });
            trimLog(); updateMonStats(); renderMonLog(); break;
        case 'monitorEvents':
            if (msg.fileCount !== undefined) monFileCount = msg.fileCount;
            for (const ev of (msg.events||[])) { monEvents.unshift(ev); if (ev.type in monTotals) monTotals[ev.type]++; }
            trimLog(); updateMonStats(); renderMonLog(); break;
        case 'monitorStopped':
            setMonUI(false);
            monEvents.unshift({ time: Date.now(), type:'info', path:'Monitoring stopped', size:0, isDir:false });
            trimLog(); renderMonLog(); break;
        case 'error': showToast(msg.text, true); break;
    }
});

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
