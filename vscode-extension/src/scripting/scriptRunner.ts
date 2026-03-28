import * as path from 'path';
import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';

export class ScriptRunner {
    private currentScriptName: string | null = null;

    constructor(
        private deviceManager: DeviceManager,
        private outputChannel: vscode.OutputChannel
    ) {}

    async pushAndRun(code: string, filePath: string): Promise<void> {
        if (!this.deviceManager.isConnected) {
            throw new Error('Not connected to any device. Please connect first.');
        }

        if (this.currentScriptName) {
            this.outputChannel.appendLine('[ScriptRunner] Unloading previous script...');
            await this.deviceManager.unloadScript();
        }

        const name = path.basename(filePath);
        this.outputChannel.appendLine(`[ScriptRunner] Loading: ${name}`);

        await this.deviceManager.loadScript(code, name);
        this.currentScriptName = name;

        this.outputChannel.appendLine(`[ScriptRunner] Running: ${name}`);
    }

    async stop(): Promise<void> {
        if (!this.currentScriptName) return;

        await this.deviceManager.unloadScript();
        this.outputChannel.appendLine(
            `[ScriptRunner] Stopped: ${this.currentScriptName}`
        );
        this.currentScriptName = null;
    }

    get isRunning(): boolean {
        return this.currentScriptName !== null;
    }
}
