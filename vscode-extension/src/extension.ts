import * as vscode from 'vscode';
import { DeviceDiscovery, WNDevice } from './discovery/bonjourDiscovery';
import { DeviceTreeProvider } from './views/deviceTreeView';
import { DeviceManager } from './device/deviceManager';
import { ScriptRunner } from './scripting/scriptRunner';
import { ObjCTreeProvider } from './views/objcTreeView';
import { ScriptTreeProvider } from './views/scriptTreeView';

let discovery: DeviceDiscovery;
let deviceManager: DeviceManager;
let scriptRunner: ScriptRunner;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('WhiteNeedle');
    outputChannel.appendLine('[WhiteNeedle] Extension activated');

    deviceManager = new DeviceManager(outputChannel);
    scriptRunner = new ScriptRunner(deviceManager, outputChannel);
    discovery = new DeviceDiscovery();

    const deviceTreeProvider = new DeviceTreeProvider(discovery, deviceManager);
    const deviceTreeView = vscode.window.createTreeView('whiteneedle-devices', {
        treeDataProvider: deviceTreeProvider,
    });

    const scriptTreeProvider = new ScriptTreeProvider(deviceManager);
    const scriptTreeView = vscode.window.createTreeView('whiteneedle-scripts', {
        treeDataProvider: scriptTreeProvider,
    });

    const objcTreeProvider = new ObjCTreeProvider(deviceManager);
    const objcTreeView = vscode.window.createTreeView('whiteneedle-objc', {
        treeDataProvider: objcTreeProvider,
    });

    const refreshAllViews = () => {
        deviceTreeProvider.refresh();
        scriptTreeProvider.refresh();
    };

    context.subscriptions.push(
        deviceTreeView,
        scriptTreeView,
        objcTreeView,
        outputChannel,

        vscode.commands.registerCommand('whiteneedle.refreshDevices', () => {
            discovery.restart();
            deviceTreeProvider.refresh();
            outputChannel.appendLine('[WhiteNeedle] Scanning for devices...');
        }),

        vscode.commands.registerCommand('whiteneedle.connectByIP', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter device IP address and port (e.g., 169.254.115.191:27042)',
                placeHolder: '192.168.x.x:27042',
                value: '169.254.115.191:27042',
                validateInput: (val) => {
                    const match = val.match(/^[\d.]+:\d+$/);
                    return match ? null : 'Format: IP:PORT (e.g., 192.168.1.10:27042)';
                },
            });
            if (!input) { return; }

            const [host, portStr] = input.split(':');
            const port = parseInt(portStr, 10);

            const manualDevice: WNDevice = {
                name: `Manual (${host})`,
                host,
                port,
                bundleId: 'manual',
                deviceName: host,
                systemVersion: 'unknown',
                model: 'unknown',
                wnVersion: 'unknown',
                enginePort: port,
                engineType: 'jscore',
            };

            try {
                outputChannel.appendLine(`[WhiteNeedle] Connecting to ${host}:${port}...`);
                outputChannel.show();
                await deviceManager.connect(manualDevice);

                const bridge = deviceManager.getBridge();
                if (bridge) {
                    bridge.on('console', (data: { message: string; level: string }) => {
                        outputChannel.appendLine(`[${data.level}] ${data.message}`);
                    });
                    bridge.on('scriptError', (data: { error: string }) => {
                        outputChannel.appendLine(`[ScriptError] ${data.error}`);
                    });
                }

                refreshAllViews();
                vscode.window.showInformationMessage(`Connected to ${host}:${port}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
                outputChannel.appendLine(`[WhiteNeedle] Connection failed: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('whiteneedle.connectDevice', async (device) => {
            if (!device) {
                const devices = discovery.getDevices();
                if (devices.length === 0) {
                    const action = await vscode.window.showWarningMessage(
                        'No devices found via Bonjour. Try manual connection?',
                        'Connect by IP',
                        'Cancel'
                    );
                    if (action === 'Connect by IP') {
                        vscode.commands.executeCommand('whiteneedle.connectByIP');
                    }
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    devices.map(d => ({
                        label: d.deviceName,
                        description: `${d.host}:${d.enginePort}`,
                        detail: `${d.bundleId} — iOS ${d.systemVersion} (${d.engineType})`,
                        device: d,
                    })),
                    { placeHolder: 'Select a device to connect' }
                );
                if (!picked) { return; }
                device = (picked as any).device;
            }
            try {
                await deviceManager.connect(device);

                const bridge = deviceManager.getBridge();
                if (bridge) {
                    bridge.on('console', (data: { message: string; level: string }) => {
                        outputChannel.appendLine(`[${data.level}] ${data.message}`);
                    });
                    bridge.on('scriptError', (data: { error: string }) => {
                        outputChannel.appendLine(`[ScriptError] ${data.error}`);
                    });
                }

                refreshAllViews();
                vscode.window.showInformationMessage(`Connected to ${device.deviceName || device.name}`);
                outputChannel.appendLine(
                    `[WhiteNeedle] Connected to ${device.deviceName} (${device.host}:${device.enginePort})`
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('whiteneedle.disconnectDevice', async () => {
            await deviceManager.disconnect();
            refreshAllViews();
            outputChannel.appendLine('[WhiteNeedle] Disconnected');
            vscode.window.showInformationMessage('WhiteNeedle: Disconnected');
        }),

        vscode.commands.registerCommand('whiteneedle.pushScript', async () => {
            if (!deviceManager.isConnected) {
                const action = await vscode.window.showWarningMessage(
                    'WhiteNeedle: Not connected to any device.',
                    'Connect by IP',
                    'Cancel'
                );
                if (action === 'Connect by IP') {
                    vscode.commands.executeCommand('whiteneedle.connectByIP');
                }
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active script file.');
                return;
            }
            const fileName = editor.document.fileName;
            if (!fileName.endsWith('.js')) {
                vscode.window.showWarningMessage('Not a JavaScript file. Please open a .js script first.');
                return;
            }
            const code = editor.document.getText();
            try {
                await scriptRunner.pushAndRun(code, fileName);
                scriptTreeProvider.setActiveScript(fileName);
                outputChannel.appendLine(`[WhiteNeedle] Script loaded: ${fileName}`);
                outputChannel.show();
                vscode.window.showInformationMessage(`Script pushed: ${require('path').basename(fileName)}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Script error: ${err.message}`);
                outputChannel.appendLine(`[WhiteNeedle] Script error: ${err.message}`);
                outputChannel.show();
            }
        }),

        vscode.commands.registerCommand('whiteneedle.stopScript', async () => {
            await scriptRunner.stop();
            scriptTreeProvider.setActiveScript(null);
            outputChannel.appendLine('[WhiteNeedle] Script stopped');
        }),

        vscode.commands.registerCommand('whiteneedle.evaluate', async () => {
            if (!deviceManager.isConnected) {
                vscode.window.showWarningMessage('WhiteNeedle: Not connected to any device.');
                return;
            }
            const input = await vscode.window.showInputBox({
                prompt: 'Enter JavaScript expression to evaluate',
                placeHolder: 'ObjC.use("UIApplication").invoke("sharedApplication")',
            });
            if (!input) { return; }
            try {
                const result = await deviceManager.evaluate(input);
                outputChannel.appendLine(`[eval] > ${input}`);
                outputChannel.appendLine(`[eval] ${JSON.stringify(result, null, 2)}`);
                outputChannel.show();
            } catch (err: any) {
                outputChannel.appendLine(`[eval] Error: ${err.message}`);
                outputChannel.show();
            }
        }),

        vscode.commands.registerCommand('whiteneedle.newScript', async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: 'javascript',
                content: SCRIPT_TEMPLATE,
            });
            await vscode.window.showTextDocument(doc);
        }),

        vscode.commands.registerCommand('whiteneedle.loadClasses', () => {
            objcTreeProvider.loadClasses();
        }),

        vscode.commands.registerCommand('whiteneedle.filterClasses', async () => {
            const input = await vscode.window.showInputBox({
                placeHolder: 'Filter classes (e.g., UIView, NS...)',
                prompt: 'Enter class name filter',
            });
            if (input !== undefined) {
                objcTreeProvider.setFilter(input);
            }
        }),

        vscode.commands.registerCommand('whiteneedle.traceMethod', async (item: any) => {
            if (!item?.className || !item?.methodSignature) { return; }
            const isClassMethod = item.methodSignature.startsWith('+');
            const sig = item.methodSignature.replace(/^[+-]\s*/, '');
            const prefix = isClassMethod ? '+' : '-';
            const hookKey = `${prefix}[${item.className} ${sig}]`;
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
                await scriptRunner.pushAndRun(traceScript, `trace-${item.className}`);
                scriptTreeProvider.setActiveScript(null);
                outputChannel.appendLine(`[WhiteNeedle] Tracing: ${hookKey}`);
                outputChannel.show();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Trace failed: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('whiteneedle.listHooks', async () => {
            try {
                const hooks = await deviceManager.listHooks();
                if (hooks.length === 0) {
                    vscode.window.showInformationMessage('No active hooks.');
                } else {
                    outputChannel.appendLine(`[WhiteNeedle] Active hooks (${hooks.length}):`);
                    hooks.forEach(h => outputChannel.appendLine(`  ${h}`));
                    outputChannel.show();
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed: ${err.message}`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (doc) => {
            const config = vscode.workspace.getConfiguration('whiteneedle');
            if (!config.get<boolean>('autoReload')) { return; }
            if (!doc.fileName.endsWith('.js')) { return; }
            if (!deviceManager.isConnected) { return; }

            try {
                await scriptRunner.pushAndRun(doc.getText(), doc.fileName);
                scriptTreeProvider.setActiveScript(doc.fileName);
                outputChannel.appendLine(`[WhiteNeedle] Auto-reloaded: ${doc.fileName}`);
            } catch (err: any) {
                outputChannel.appendLine(`[WhiteNeedle] Auto-reload error: ${err.message}`);
            }
        })
    );

    discovery.start();
    outputChannel.appendLine('[WhiteNeedle] Scanning for devices on LAN...');
    outputChannel.show();
}

export function deactivate() {
    discovery?.stop();
    deviceManager?.disconnect();
}

const SCRIPT_TEMPLATE = `// WhiteNeedle Script (JavaScriptCore)
// API: ObjC.use(), ObjC.classes, Interceptor.attach(), console.log()
// Push: Cmd+Shift+R or click Play button in editor title bar

// Example: Hook an Objective-C method
Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
    onEnter: function(self) {
        console.log('[Hook] NSURLSession request intercepted');
    },
    onLeave: function() {
        console.log('[Hook] NSURLSession request completed');
    }
});

// Example: Call a class method
var app = ObjC.use('UIApplication').invoke('sharedApplication');
console.log('[WhiteNeedle] App delegate:', app.invoke('delegate'));

// Export RPC methods (callable from VSCode)
rpc.exports = {
    ping: function() { return 'pong'; }
};

console.log('[WhiteNeedle] Script loaded successfully');
`;
