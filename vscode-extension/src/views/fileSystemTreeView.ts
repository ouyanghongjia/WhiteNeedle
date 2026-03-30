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
    ctime: number;
}

type FSTreeItem = FolderItem | FileItem;

class FolderItem extends vscode.TreeItem {
    constructor(public readonly entry: FileEntry) {
        super(entry.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'fsFolder';
        this.iconPath = new vscode.ThemeIcon('folder');
        this.tooltip = entry.path;
    }
}

class FileItem extends vscode.TreeItem {
    constructor(public readonly entry: FileEntry) {
        super(entry.name, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'fsFile';
        this.description = formatFileSize(entry.size);
        this.iconPath = new vscode.ThemeIcon(getFileIcon(entry.name));
        this.tooltip = `${entry.path}\nSize: ${formatFileSize(entry.size)}\nModified: ${new Date(entry.mtime).toLocaleString()}`;
    }
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getFileIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'plist': return 'file-code';
        case 'json': return 'json';
        case 'js': return 'symbol-method';
        case 'db': case 'sqlite': case 'sqlite3': return 'database';
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': return 'file-media';
        case 'log': case 'txt': return 'file-text';
        default: return 'file';
    }
}

export class FileSystemTreeProvider implements vscode.TreeDataProvider<FSTreeItem> {
    private _onDidChange = new vscode.EventEmitter<FSTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    private rootEntries: FSTreeItem[] = [];
    private sandboxHome = '';

    constructor(private deviceManager: DeviceManager) {}

    refresh(): void {
        this.rootEntries = [];
        this._onDidChange.fire(undefined);
    }

    async loadRoot(): Promise<void> {
        if (!this.deviceManager.isConnected) {
            vscode.window.showWarningMessage('WhiteNeedle: Not connected to a device.');
            return;
        }

        try {
            const homeRaw = await this.deviceManager.evaluate('FileSystem.home') as any;
            this.sandboxHome = typeof homeRaw === 'string' ? homeRaw : homeRaw?.value ?? '';

            this.rootEntries = await this.listDir('/');
            this._onDidChange.fire(undefined);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to browse sandbox: ${err.message}`);
        }
    }

    private async listDir(relPath: string): Promise<FSTreeItem[]> {
        try {
            const code = `JSON.stringify(FileSystem.list('${relPath.replace(/'/g, "\\'")}'))`;
            const raw = await this.deviceManager.evaluate(code) as any;
            const parsed = typeof raw === 'string' ? raw : raw?.value ?? JSON.stringify(raw);
            const entries: FileEntry[] = JSON.parse(parsed);

            return entries
                .sort((a, b) => {
                    if (a.isDir !== b.isDir) { return a.isDir ? -1 : 1; }
                    return a.name.localeCompare(b.name);
                })
                .map(e => e.isDir ? new FolderItem(e) : new FileItem(e));
        } catch {
            return [];
        }
    }

    async readFile(item: FileItem): Promise<void> {
        if (!this.deviceManager.isConnected) { return; }

        try {
            const code = `FileSystem.read('${item.entry.path.replace(/'/g, "\\'")}')`;
            const raw = await this.deviceManager.evaluate(code) as any;
            const content = typeof raw === 'string' ? raw : raw?.value ?? '';

            if (content === null || content === 'null') {
                vscode.window.showWarningMessage('Could not read file (binary or inaccessible).');
                return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content: content,
                language: guessLanguage(item.entry.name),
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to read file: ${err.message}`);
        }
    }

    async downloadFile(item: FileItem): Promise<void> {
        if (!this.deviceManager.isConnected) { return; }

        const defaultUri = vscode.Uri.file(
            path.join(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir(),
                item.entry.name
            )
        );

        const dest = await vscode.window.showSaveDialog({
            defaultUri,
            title: `Save "${item.entry.name}" to...`,
        });
        if (!dest) { return; }

        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Downloading ${item.entry.name}...`, cancellable: false },
                async () => {
                    const code = `FileSystem.readBytes('${item.entry.path.replace(/'/g, "\\'")}')`;
                    const raw = await this.deviceManager.evaluate(code) as any;
                    const b64 = typeof raw === 'string' ? raw : raw?.value ?? '';

                    if (!b64 || b64 === 'null') {
                        throw new Error('File is empty or inaccessible');
                    }

                    const buffer = Buffer.from(b64, 'base64');
                    fs.writeFileSync(dest.fsPath, buffer);
                }
            );

            const action = await vscode.window.showInformationMessage(
                `Downloaded: ${item.entry.name} (${formatFileSize(item.entry.size)})`,
                'Open File', 'Open Folder'
            );
            if (action === 'Open File') {
                await vscode.commands.executeCommand('vscode.open', dest);
            } else if (action === 'Open Folder') {
                await vscode.commands.executeCommand('revealFileInOS', dest);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Download failed: ${err.message}`);
        }
    }

    async downloadFolder(item: FolderItem): Promise<void> {
        if (!this.deviceManager.isConnected) { return; }

        const destFolder = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: `Choose destination for "${item.entry.name}"`,
        });
        if (!destFolder || destFolder.length === 0) { return; }

        const localRoot = path.join(destFolder[0].fsPath, item.entry.name);

        try {
            let downloaded = 0;
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Downloading ${item.entry.name}/...`, cancellable: false },
                async (progress) => {
                    downloaded = await this.downloadDirRecursive(item.entry.path, localRoot, progress);
                }
            );

            const action = await vscode.window.showInformationMessage(
                `Downloaded ${downloaded} files to ${localRoot}`,
                'Open Folder'
            );
            if (action === 'Open Folder') {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(localRoot));
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Download failed: ${err.message}`);
        }
    }

    private async downloadDirRecursive(
        remotePath: string,
        localPath: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
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

    async deleteEntry(item: FSTreeItem): Promise<void> {
        const entry = item instanceof FolderItem ? item.entry : (item as FileItem).entry;
        const confirm = await vscode.window.showWarningMessage(
            `Delete "${entry.name}"?`, { modal: true }, 'Delete'
        );
        if (confirm !== 'Delete') { return; }

        try {
            const code = `FileSystem.remove('${entry.path.replace(/'/g, "\\'")}')`;
            await this.deviceManager.evaluate(code);
            this.refresh();
            await this.loadRoot();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to delete: ${err.message}`);
        }
    }

    getTreeItem(element: FSTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FSTreeItem): Promise<FSTreeItem[]> {
        if (!element) {
            if (this.rootEntries.length === 0 && this.deviceManager.isConnected) {
                await this.loadRoot();
            }
            return this.rootEntries;
        }

        if (element instanceof FolderItem) {
            return this.listDir(element.entry.path);
        }

        return [];
    }
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
