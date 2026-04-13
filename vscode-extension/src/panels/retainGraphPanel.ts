import * as vscode from 'vscode';
import { DeviceManager } from '../device/deviceManager';
import { bindConnectionState } from './connectionOverlay';
import { getRetainGraphHtml } from './retainGraphHtml';

export class RetainGraphPanel {
    public static currentPanel: RetainGraphPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly deviceManager: DeviceManager;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager
    ): void {
        if (RetainGraphPanel.currentPanel) {
            RetainGraphPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'whiteneedleRetainGraph',
            'Retain Graph',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );
        RetainGraphPanel.currentPanel = new RetainGraphPanel(panel, extensionUri, deviceManager);
    }

    public static createOrShowAt(
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager,
        address: string
    ): void {
        RetainGraphPanel.createOrShow(extensionUri, deviceManager);
        if (RetainGraphPanel.currentPanel && address) {
            RetainGraphPanel.currentPanel.postMessage({ command: 'setAddress', address });
        }
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        deviceManager: DeviceManager
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.deviceManager = deviceManager;

        this.panel.webview.html = getRetainGraphHtml(this.panel.webview, extensionUri);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        bindConnectionState(this.panel, this.deviceManager, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'buildGraph':
                        await this.buildGraph(msg.address, msg.maxNodes, msg.maxDepth);
                        break;
                    case 'expandNode':
                        await this.expandNode(msg.address);
                        break;
                    case 'getNodeDetail':
                        await this.getNodeDetail(msg.address);
                        break;
                    case 'exportGraph':
                        await this.exportGraph(msg.data);
                        break;
                }
            },
            null,
            this.disposables
        );

        this.checkAvailability();
    }

    private async checkAvailability(): Promise<void> {
        try {
            const result = await this.deviceManager.evaluate(
                'typeof RefGraph !== "undefined" && RefGraph.isAvailable()'
            );
            if (result !== true && result !== 'true') {
                this.postMessage({
                    command: 'error',
                    text: 'RefGraph module is not available. Rebuild WhiteNeedle.framework with WN_REFGRAPH=1.',
                });
            }
        } catch {
            // Device not connected yet; overlay will show
        }
    }

    private async evalJS(code: string): Promise<any> {
        if (!this.deviceManager.isConnected) {
            this.postMessage({ command: 'error', text: 'Not connected to a device.' });
            return null;
        }
        try {
            return await this.deviceManager.evaluate(code);
        } catch (err: any) {
            this.postMessage({ command: 'error', text: err.message });
            return null;
        }
    }

    private async buildGraph(address: string, maxNodes: number = 200, maxDepth: number = 15): Promise<void> {
        const escaped = address.replace(/"/g, '\\"');
        const result = await this.evalJS(
            `JSON.stringify(RefGraph.buildGraph("${escaped}", ${maxNodes}, ${maxDepth}))`
        );
        if (!result) { return; }
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'graphData', data: parsed });
        } catch {
            this.postMessage({ command: 'error', text: 'Failed to parse graph data' });
        }
    }

    private async expandNode(address: string): Promise<void> {
        const escaped = address.replace(/"/g, '\\"');
        const result = await this.evalJS(
            `JSON.stringify(RefGraph.expandNode("${escaped}"))`
        );
        if (!result) { return; }
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'nodeExpanded', address, refs: parsed });
        } catch {
            this.postMessage({ command: 'nodeExpanded', address, refs: [] });
        }
    }

    private async getNodeDetail(address: string): Promise<void> {
        const escaped = address.replace(/"/g, '\\"');
        const result = await this.evalJS(
            `JSON.stringify(RefGraph.getNodeDetail("${escaped}"))`
        );
        if (!result) { return; }
        try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            this.postMessage({ command: 'nodeDetail', data: parsed });
        } catch {
            this.postMessage({ command: 'nodeDetail', data: {} });
        }
    }

    private async exportGraph(data?: any): Promise<void> {
        const exportData = data || { nodes: [], edges: [], cycles: [] };
        const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(exportData, null, 2),
            language: 'json',
        });
        vscode.window.showTextDocument(doc);
    }

    private postMessage(msg: any): void {
        this.panel.webview.postMessage(msg);
    }

    public dispose(): void {
        RetainGraphPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
