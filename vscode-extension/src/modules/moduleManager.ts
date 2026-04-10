import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { DeviceManager } from '../device/deviceManager';

const INSTALLED_MODULES_DIR = 'wn_installed_modules';

export class ModuleManager {
    constructor(
        private deviceManager: DeviceManager,
        private outputChannel: vscode.OutputChannel,
        private _onDidChange: vscode.EventEmitter<void>,
    ) {}

    async installFromFile(localPath: string): Promise<void> {
        const content = fs.readFileSync(localPath, 'utf-8');
        const name = path.basename(localPath);
        await this.deviceManager.writeFileOnDevice(`${INSTALLED_MODULES_DIR}/${name}`, content);
        this.outputChannel.appendLine(`[Module] Installed "${name}" from local file`);
        this._onDidChange.fire();
    }

    async installFromUrl(url: string): Promise<void> {
        const content = await this.downloadText(url);
        const name = this.fileNameFromUrl(url);
        await this.deviceManager.writeFileOnDevice(`${INSTALLED_MODULES_DIR}/${name}`, content);
        this.outputChannel.appendLine(`[Module] Installed "${name}" from URL`);
        this._onDidChange.fire();
    }

    async installFromNpm(packageName: string): Promise<void> {
        const cdnUrl = `https://unpkg.com/${packageName}`;
        const content = await this.downloadText(cdnUrl);
        const safeName = packageName.replace(/[/@]/g, '_').replace(/^_+/, '') + '.js';
        await this.deviceManager.writeFileOnDevice(`${INSTALLED_MODULES_DIR}/${safeName}`, content);
        this.outputChannel.appendLine(`[Module] Installed "${safeName}" from npm (${packageName})`);
        this._onDidChange.fire();
    }

    async uninstall(moduleName: string): Promise<void> {
        await this.deviceManager.removeDirOnDevice(`${INSTALLED_MODULES_DIR}/${moduleName}`);
        this.outputChannel.appendLine(`[Module] Uninstalled "${moduleName}"`);
        this._onDidChange.fire();
    }

    async listInstalled(): Promise<Array<{ name: string; size: number }>> {
        return this.deviceManager.listInstalledJsModules();
    }

    private fileNameFromUrl(url: string): string {
        try {
            const parsed = new URL(url);
            const segments = parsed.pathname.split('/').filter(Boolean);
            const last = segments[segments.length - 1] || 'module.js';
            return last.endsWith('.js') ? last : last + '.js';
        } catch {
            return 'module.js';
        }
    }

    private downloadText(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const get = url.startsWith('https') ? https.get : http.get;
            const request = (targetUrl: string, depth = 0) => {
                if (depth > 5) { return reject(new Error('Too many redirects')); }
                get(targetUrl, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        const nextUrl = res.headers.location.startsWith('http')
                            ? res.headers.location
                            : new URL(res.headers.location, targetUrl).toString();
                        return request(nextUrl, depth + 1);
                    }
                    if (res.statusCode && res.statusCode >= 400) {
                        return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
                    }
                    let data = '';
                    res.setEncoding('utf-8');
                    res.on('data', (chunk: string) => { data += chunk; });
                    res.on('end', () => resolve(data));
                    res.on('error', reject);
                }).on('error', reject);
            };
            request(url);
        });
    }
}
