import * as path from 'path';
import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';
import { HookCodeRegistry } from '../panels/hookCodeRegistry';
import { DependencyAnalyzer } from './dependencyAnalyzer';

const TMP_DIR = 'tmp/wn_run';

export class ScriptRunner {
    private currentScriptName: string | null = null;

    constructor(
        private deviceManager: DeviceManager,
        private outputChannel: vscode.OutputChannel,
        private hookCodeRegistry: HookCodeRegistry,
    ) {}

    async pushAndRun(code: string, filePath: string): Promise<void> {
        if (!this.deviceManager.isConnected) {
            throw new Error('Not connected to any device. Please connect first.');
        }

        const mode = vscode.workspace
            .getConfiguration('whiteneedle')
            .get<string>('scriptMode', 'single');

        if (mode === 'project') {
            await this.pushAndRunProject(code, filePath);
        } else {
            await this.pushAndRunSingle(code, filePath);
        }
    }

    private static hasEsmSyntax(code: string): boolean {
        return /\b(import\s+.+from\s+|export\s+(default|function|class|\{))/m.test(code);
    }

    /** Single-file mode: IIFE wrap + reuse existing JSContext (fast) */
    private async pushAndRunSingle(code: string, filePath: string): Promise<void> {
        if (this.currentScriptName) {
            this.outputChannel.appendLine('[ScriptRunner] Unloading previous script...');
            await this.deviceManager.unloadScript(this.currentScriptName);
        }

        const name = path.basename(filePath);
        let finalCode = code;
        if (ScriptRunner.hasEsmSyntax(code)) {
            this.outputChannel.appendLine('[ScriptRunner] ESM syntax detected, converting to CJS...');
            finalCode = DependencyAnalyzer.esmToCjs(code);
        }
        this.outputChannel.appendLine(`[ScriptRunner] Loading (single): ${name}`);
        await this.deviceManager.loadScript(finalCode, name);
        this.currentScriptName = name;
        this.outputChannel.appendLine(`[ScriptRunner] Running: ${name}`);
    }

    /** Project mode: fresh JSContext + push dependencies + replay hooks */
    private async pushAndRunProject(code: string, filePath: string): Promise<void> {
        const name = path.basename(filePath);

        // 1. Analyze local dependencies
        this.outputChannel.appendLine('[ScriptRunner] Analyzing local dependencies...');
        const deps = DependencyAnalyzer.analyze(code, filePath);
        if (deps.length > 0) {
            this.outputChannel.appendLine(
                `[ScriptRunner] Found ${deps.length} local dep(s): ${deps.map(d => d.relativePath).join(', ')}`
            );
        }

        // 2. Reset JSContext (detach hooks, stop FPS, clear module cache, teardown + setup)
        this.outputChannel.appendLine('[ScriptRunner] Resetting JSContext...');
        await this.deviceManager.resetContext();

        // 3. Replay HookPanel-recorded hook codes
        const hookCodes = this.hookCodeRegistry.getRecordedHooks();
        if (hookCodes.length > 0) {
            this.outputChannel.appendLine(`[ScriptRunner] Replaying ${hookCodes.length} hook code(s)...`);
            for (const hookCode of hookCodes) {
                try {
                    await this.deviceManager.evaluate(hookCode);
                } catch (e: any) {
                    this.outputChannel.appendLine(`[ScriptRunner] Hook replay warning: ${e.message}`);
                }
            }
        }

        // 4. Detect ESM and convert all sources to CJS
        const useEsm = ScriptRunner.hasEsmSyntax(code) ||
            deps.some(d => ScriptRunner.hasEsmSyntax(d.content));
        let mainCode = code;
        if (useEsm) {
            this.outputChannel.appendLine('[ScriptRunner] ESM syntax detected, converting to CJS...');
            mainCode = DependencyAnalyzer.esmToCjs(code);
            for (const dep of deps) {
                dep.content = DependencyAnalyzer.esmToCjs(dep.content);
            }
        }

        // 5. Push dependencies to temporary directory on device
        await this.deviceManager.removeDirOnDevice(TMP_DIR);
        if (deps.length > 0) {
            await this.deviceManager.mkdirOnDevice(TMP_DIR);
            for (const dep of deps) {
                const depDir = path.dirname(dep.relativePath);
                if (depDir && depDir !== '.') {
                    await this.deviceManager.mkdirOnDevice(`${TMP_DIR}/${depDir}`);
                }
                await this.deviceManager.writeFileOnDevice(
                    `${TMP_DIR}/${dep.relativePath}`,
                    dep.content,
                );
            }
            await this.deviceManager.evaluate(`Module.addSearchPath("${TMP_DIR}")`);
            this.outputChannel.appendLine(`[ScriptRunner] Pushed ${deps.length} dep(s) to ${TMP_DIR}`);
        }

        // 6. Load main script
        this.outputChannel.appendLine(`[ScriptRunner] Loading (project): ${name}`);
        await this.deviceManager.loadScript(mainCode, name);
        this.currentScriptName = name;
        this.outputChannel.appendLine(`[ScriptRunner] Running: ${name}`);
    }

    async stop(): Promise<void> {
        if (!this.currentScriptName) { return; }

        await this.deviceManager.unloadScript(this.currentScriptName);
        this.outputChannel.appendLine(
            `[ScriptRunner] Stopped: ${this.currentScriptName}`
        );
        this.currentScriptName = null;
    }

    get isRunning(): boolean {
        return this.currentScriptName !== null;
    }
}
