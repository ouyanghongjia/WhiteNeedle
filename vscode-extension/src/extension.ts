import * as vscode from 'vscode';
import * as net from 'net';
import { DeviceDiscovery, WNDevice } from './discovery/bonjourDiscovery';
import { DeviceTreeProvider } from './views/deviceTreeView';
import { DeviceManager, ConnectionState } from './device/deviceManager';
import { ScriptRunner } from './scripting/scriptRunner';
import { ScriptTreeProvider } from './views/scriptTreeView';
import { CookiePanel } from './panels/cookiePanel';
import { UserDefaultsPanel } from './panels/userDefaultsPanel';
import { SandboxPanel } from './panels/sandboxPanel';
import { ObjCPanel } from './panels/objcPanel';
import { LogPanel, LogCategory, LogLevel } from './panels/logPanel';
import { HookPanel } from './panels/hookPanel';
import { NetworkPanel } from './panels/networkPanel';
import { ViewHierarchyPanel } from './panels/viewHierarchyPanel';
import { HostMappingPanel } from './panels/hostMappingPanel';
import { SnippetPanel } from './panels/snippetPanel';
import { ProxyServer } from './proxy/proxyServer';
import {
    WhiteNeedleConfigurationProvider,
    WhiteNeedleDebugAdapterFactory,
} from './debugging/debugAdapterFactory';

let discovery: DeviceDiscovery;
let deviceManager: DeviceManager;
let scriptRunner: ScriptRunner;
let proxyServer: ProxyServer;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let proxyStatusBarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext;

function appendLog(category: LogCategory, level: LogLevel, message: string, source?: string): void {
    outputChannel.appendLine(`[${category}:${level}] ${message}`);
    LogPanel.getInstance()?.appendLog(category, level, message, source);
}

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('WhiteNeedle');
    outputChannel.appendLine('[WhiteNeedle] Extension activated');

    deviceManager = new DeviceManager(outputChannel);
    scriptRunner = new ScriptRunner(deviceManager, outputChannel);
    discovery = new DeviceDiscovery();

    // --- Proxy Server ---
    proxyServer = new ProxyServer();
    proxyServer.on('log', (msg: string) => {
        outputChannel.appendLine(`[Proxy] ${msg}`);
    });
    proxyServer.on('error', (err: Error) => {
        outputChannel.appendLine(`[Proxy] Error: ${err.message}`);
    });
    proxyServer.on('started', (port: number) => {
        outputChannel.appendLine(`[Proxy] Started on port ${port}`);
        updateProxyStatusBar();
    });
    proxyServer.on('stopped', () => {
        outputChannel.appendLine('[Proxy] Stopped');
        updateProxyStatusBar();
    });

    // --- Status Bar ---
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'whiteneedle.statusBarAction';
    updateStatusBar('disconnected');
    statusBarItem.show();

    proxyStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    proxyStatusBarItem.command = 'whiteneedle.toggleProxy';
    updateProxyStatusBar();
    proxyStatusBarItem.show();

    deviceManager.on('stateChanged', (state: ConnectionState) => {
        updateStatusBar(state);
        if (state === 'connected') {
            syncProxyRules();
        }
    });

    deviceManager.on('reconnected', (device: WNDevice) => {
        attachBridgeListeners();
        refreshAllViews();
        syncProxyRules();
        appendLog('System', 'log', `Reconnected to ${device.deviceName || device.host}`);
        vscode.window.showInformationMessage(
            `WhiteNeedle: Reconnected to ${device.deviceName || device.host}`
        );
    });

    deviceManager.on('reconnectFailed', (device: WNDevice) => {
        refreshAllViews();
        appendLog('System', 'error', `Failed to reconnect to ${device.deviceName || device.host}`);
        vscode.window.showWarningMessage(
            `WhiteNeedle: Failed to reconnect to ${device.deviceName || device.host}. Click status bar to reconnect manually.`
        );
    });

    // --- Tree Views ---
    const deviceTreeProvider = new DeviceTreeProvider(discovery, deviceManager);
    const deviceTreeView = vscode.window.createTreeView('whiteneedle-devices', {
        treeDataProvider: deviceTreeProvider,
    });

    const scriptTreeProvider = new ScriptTreeProvider(deviceManager);
    const scriptTreeView = vscode.window.createTreeView('whiteneedle-scripts', {
        treeDataProvider: scriptTreeProvider,
    });

    // --- Debug ---
    const debugFactory = new WhiteNeedleDebugAdapterFactory();
    const debugConfigProvider = new WhiteNeedleConfigurationProvider();
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('whiteneedle', debugFactory),
        vscode.debug.registerDebugConfigurationProvider(
            'whiteneedle',
            debugConfigProvider,
            vscode.DebugConfigurationProviderTriggerKind.Initial
        ),
        vscode.debug.registerDebugConfigurationProvider(
            'whiteneedle',
            debugConfigProvider,
            vscode.DebugConfigurationProviderTriggerKind.Dynamic
        )
    );

    const refreshAllViews = () => {
        deviceTreeProvider.refresh();
        scriptTreeProvider.refresh();
    };

    const attachedBridges = new WeakSet<object>();
    const attachBridgeListeners = () => {
        const bridge = deviceManager.getBridge();
        if (!bridge) { return; }
        if (attachedBridges.has(bridge as object)) { return; }
        attachedBridges.add(bridge as object);
        bridge.on('console', (data: { message: string; level: string }) => {
            const lvl = (data.level === 'warn' || data.level === 'error' || data.level === 'debug')
                ? data.level as LogLevel : 'log';
            appendLog('Console', lvl, data.message);
        });
        bridge.on('scriptError', (data: { error: string }) => {
            appendLog('Error', 'error', data.error, 'script');
        });
        bridge.on('networkRequest', (data: any) => {
            appendLog('Network', 'log', `${data.method} ${data.url}`, 'network');
        });
        bridge.on('networkResponse', (data: any) => {
            const status = data.status || 0;
            const lvl: LogLevel = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'log';
            appendLog('Network', lvl, `${data.method} ${data.url} → ${status}`, 'network');
        });
    };

    context.subscriptions.push(
        deviceTreeView,
        scriptTreeView,
        outputChannel,
        statusBarItem,

        // --- Status Bar Action ---
        vscode.commands.registerCommand('whiteneedle.statusBarAction', async () => {
            if (deviceManager.isConnected) {
                const device = deviceManager.getConnectedDevice();
                const action = await vscode.window.showQuickPick([
                    { label: '$(debug-disconnect) Disconnect', id: 'disconnect' },
                    { label: '$(refresh) Refresh Devices', id: 'refresh' },
                    { label: '$(info) Device Info', id: 'info' },
                ], { placeHolder: `Connected to ${device?.deviceName || device?.host}` });
                if (!action) { return; }
                switch (action.id) {
                    case 'disconnect':
                        vscode.commands.executeCommand('whiteneedle.disconnectDevice');
                        break;
                    case 'refresh':
                        vscode.commands.executeCommand('whiteneedle.refreshDevices');
                        break;
                    case 'info':
                        if (device) {
                            outputChannel.appendLine(`[Device] ${device.deviceName} | ${device.model} | iOS ${device.systemVersion} | ${device.bundleId}`);
                            outputChannel.show();
                        }
                        break;
                }
            } else {
                const action = await vscode.window.showQuickPick([
                    { label: '$(search) Browse Devices (Bonjour)', id: 'connect' },
                    { label: '$(plug) Connect by IP', id: 'ip' },
                ], { placeHolder: 'WhiteNeedle — Not Connected' });
                if (!action) { return; }
                switch (action.id) {
                    case 'connect':
                        vscode.commands.executeCommand('whiteneedle.connectDevice');
                        break;
                    case 'ip':
                        vscode.commands.executeCommand('whiteneedle.connectByIP');
                        break;
                }
            }
        }),

        // --- Device commands ---
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
                inspectorPort: 9222,
            };

            try {
                outputChannel.appendLine(`[WhiteNeedle] Connecting to ${host}:${port}...`);
                outputChannel.show();
                await deviceManager.connect(manualDevice);
                attachBridgeListeners();
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
                attachBridgeListeners();
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

        // --- Script commands ---
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

        // --- Webview Panel commands ---
        vscode.commands.registerCommand('whiteneedle.openLogs', () => {
            LogPanel.createOrShow(context.extensionUri);
        }),

        vscode.commands.registerCommand('whiteneedle.openCookies', () => {
            CookiePanel.createOrShow(context.extensionUri, deviceManager, outputChannel);
        }),

        vscode.commands.registerCommand('whiteneedle.openUserDefaults', () => {
            UserDefaultsPanel.createOrShow(context.extensionUri, deviceManager, outputChannel);
        }),

        vscode.commands.registerCommand('whiteneedle.openSandbox', () => {
            SandboxPanel.createOrShow(context.extensionUri, deviceManager);
        }),

        vscode.commands.registerCommand('whiteneedle.openObjC', () => {
            ObjCPanel.createOrShow(context.extensionUri, deviceManager, scriptRunner);
        }),

        vscode.commands.registerCommand('whiteneedle.openHooks', () => {
            HookPanel.createOrShow(context.extensionUri, deviceManager);
        }),

        vscode.commands.registerCommand('whiteneedle.openNetwork', () => {
            NetworkPanel.createOrShow(context.extensionUri, deviceManager);
        }),

        vscode.commands.registerCommand('whiteneedle.openViewHierarchy', () => {
            ViewHierarchyPanel.createOrShow(context.extensionUri, deviceManager);
        }),

        vscode.commands.registerCommand('whiteneedle.openHostMapping', () => {
            HostMappingPanel.createOrShow(context.extensionUri, context.globalState, proxyServer);
        }),

        vscode.commands.registerCommand('whiteneedle.openSnippets', () => {
            SnippetPanel.createOrShow(context.extensionUri, deviceManager, scriptRunner, context.globalState);
        }),

        // --- Proxy commands ---
        vscode.commands.registerCommand('whiteneedle.startProxy', async () => {
            if (proxyServer.running) {
                vscode.window.showInformationMessage(`WhiteNeedle Proxy already running on port ${proxyServer.port}`);
                return;
            }
            const cfg = vscode.workspace.getConfiguration('whiteneedle');
            const port = cfg.get<number>('proxyPort', 8899);
            try {
                const actualPort = await proxyServer.start(port);
                vscode.window.showInformationMessage(
                    `WhiteNeedle Proxy started on port ${actualPort}. Set your device HTTP proxy to this Mac's IP:${actualPort}`
                );
                syncProxyRules();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Proxy start failed: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('whiteneedle.stopProxy', () => {
            proxyServer.stop();
            vscode.window.showInformationMessage('WhiteNeedle Proxy stopped');
        }),

        vscode.commands.registerCommand('whiteneedle.toggleProxy', async () => {
            if (proxyServer.running) {
                proxyServer.stop();
            } else {
                const cfg = vscode.workspace.getConfiguration('whiteneedle');
                const port = cfg.get<number>('proxyPort', 8899);
                try {
                    await proxyServer.start(port);
                    syncProxyRules();
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Proxy start failed: ${err.message}`);
                }
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

    discovery.on('deviceFound', async (device: WNDevice) => {
        if (deviceManager.isConnected) { return; }
        const cfg = vscode.workspace.getConfiguration('whiteneedle');
        const autoConnect = cfg.get<boolean>('autoConnect', true);
        if (!autoConnect) { return; }

        const lastHost = cfg.get<string>('deviceHost');
        if (lastHost && device.host === lastHost) {
            outputChannel.appendLine(
                `[WhiteNeedle] Auto-reconnecting to previously connected device: ${device.deviceName} (${device.host}:${device.enginePort})`
            );
            try {
                await deviceManager.connect(device);
                attachBridgeListeners();
                refreshAllViews();
                vscode.window.showInformationMessage(
                    `WhiteNeedle: Auto-connected to ${device.deviceName || device.host}`
                );
            } catch (err: any) {
                outputChannel.appendLine(`[WhiteNeedle] Auto-connect failed: ${err.message}`);
            }
        }
    });

    discovery.start();
    outputChannel.appendLine('[WhiteNeedle] Scanning for devices on LAN...');
    outputChannel.show();

    scheduleLastDeviceFallback(context, attachBridgeListeners, refreshAllViews);
}

export function deactivate() {
    proxyServer?.stop();
    discovery?.stop();
    deviceManager?.disconnect();
}

function updateProxyStatusBar(): void {
    if (proxyServer.running) {
        proxyStatusBarItem.text = `$(radio-tower) Proxy:${proxyServer.port}`;
        proxyStatusBarItem.tooltip = `WhiteNeedle Proxy running on port ${proxyServer.port}\nClick to stop`;
        proxyStatusBarItem.backgroundColor = undefined;
    } else {
        proxyStatusBarItem.text = '$(circle-slash) Proxy: Off';
        proxyStatusBarItem.tooltip = 'WhiteNeedle Proxy is not running\nClick to start';
        proxyStatusBarItem.backgroundColor = undefined;
    }
}

function syncProxyRules(): void {
    if (!proxyServer.running) {
        return;
    }
    const effective = HostMappingPanel.getEffectiveRules(extensionContext.globalState);
    proxyServer.updateRules(effective);
    outputChannel.appendLine(`[Proxy] Synced ${effective.length} host mapping rules`);
}

function updateStatusBar(state: ConnectionState): void {
    switch (state) {
        case 'connected': {
            const device = deviceManager.getConnectedDevice();
            const label = device?.deviceName || device?.host || 'Device';
            statusBarItem.text = `$(plug) WN: ${label}`;
            statusBarItem.tooltip = `WhiteNeedle — Connected to ${label}\nClick for options`;
            statusBarItem.backgroundColor = undefined;
            break;
        }
        case 'connecting':
            statusBarItem.text = '$(sync~spin) WN: Connecting...';
            statusBarItem.tooltip = 'WhiteNeedle — Establishing connection...';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'reconnecting':
            statusBarItem.text = '$(sync~spin) WN: Reconnecting...';
            statusBarItem.tooltip = 'WhiteNeedle — Connection lost, attempting to reconnect...';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            break;
        case 'disconnected':
        default:
            statusBarItem.text = '$(debug-disconnect) WN: Disconnected';
            statusBarItem.tooltip = 'WhiteNeedle — Not connected\nClick to connect';
            statusBarItem.backgroundColor = undefined;
            break;
    }
}

/**
 * If Bonjour discovery doesn't find the device within a few seconds,
 * attempt a direct TCP probe to the last-known host:port as fallback.
 */
function scheduleLastDeviceFallback(
    context: vscode.ExtensionContext,
    attachBridgeListeners: () => void,
    refreshAllViews: () => void,
): void {
    const cfg = vscode.workspace.getConfiguration('whiteneedle');
    const lastHost = cfg.get<string>('deviceHost');
    const autoConnect = cfg.get<boolean>('autoConnect', true);
    if (!lastHost || !autoConnect) { return; }

    const fallbackDelay = 6000;
    const timer = setTimeout(async () => {
        if (deviceManager.isConnected) { return; }
        if (discovery.getDevices().length > 0) { return; }

        const port = 27042;
        outputChannel.appendLine(
            `[WhiteNeedle] Bonjour timeout — probing last device at ${lastHost}:${port}...`
        );

        const reachable = await tcpProbe(lastHost, port, 3000);
        if (!reachable) {
            outputChannel.appendLine(`[WhiteNeedle] Last device ${lastHost}:${port} not reachable.`);
            return;
        }
        if (deviceManager.isConnected) { return; }

        const fallbackDevice: WNDevice = {
            name: `Fallback (${lastHost})`,
            host: lastHost,
            port,
            bundleId: 'unknown',
            deviceName: lastHost,
            systemVersion: 'unknown',
            model: 'unknown',
            wnVersion: 'unknown',
            enginePort: port,
            engineType: 'jscore',
            inspectorPort: cfg.get<number>('inspectorPort', 9222),
        };

        try {
            await deviceManager.connect(fallbackDevice);
            attachBridgeListeners();
            refreshAllViews();
            outputChannel.appendLine(`[WhiteNeedle] Fallback auto-connected to ${lastHost}:${port}`);
            vscode.window.showInformationMessage(
                `WhiteNeedle: Auto-connected to ${lastHost} (Bonjour unavailable, used direct TCP)`
            );
        } catch (err: any) {
            outputChannel.appendLine(`[WhiteNeedle] Fallback connection failed: ${err.message}`);
        }
    }, fallbackDelay);

    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const onDone = (ok: boolean) => {
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => onDone(true));
        socket.once('error', () => onDone(false));
        socket.once('timeout', () => onDone(false));
        socket.connect(port, host);
    });
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
