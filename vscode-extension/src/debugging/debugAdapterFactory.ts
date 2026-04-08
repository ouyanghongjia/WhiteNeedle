import * as vscode from 'vscode';
import * as net from 'net';
import { WhiteNeedleDebugSession } from './debugAdapter';

/**
 * Provides a DebugAdapterDescriptor that runs the debug adapter inline
 * (in the extension host process) for simplicity.
 */
export class WhiteNeedleDebugAdapterFactory
    implements vscode.DebugAdapterDescriptorFactory
{
    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(
            new WhiteNeedleDebugSession() as any
        );
    }
}

/**
 * Provides initial debug configurations and resolves them
 * before a debug session starts.
 */
export class WhiteNeedleConfigurationProvider
    implements vscode.DebugConfigurationProvider
{
    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        const ws = vscode.workspace.getConfiguration('whiteneedle');

        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'javascript') {
                config.type = 'whiteneedle';
                config.name = 'WhiteNeedle: Debug Script';
                config.request = 'launch';
                config.script = '${file}';
            }
        }

        if (config.host === undefined || config.host === null || String(config.host).trim() === '') {
            config.host = ws.get<string>('deviceHost') || '127.0.0.1';
        }

        if (config.inspectorPort === undefined || config.inspectorPort === null || config.inspectorPort === '') {
            config.inspectorPort = 9222;
        } else {
            const n = Number(config.inspectorPort);
            config.inspectorPort = Number.isFinite(n) ? n : 9222;
        }

        const launchUdid =
            config.webkitDeviceUdid !== undefined &&
            config.webkitDeviceUdid !== null &&
            String(config.webkitDeviceUdid).trim() !== ''
                ? String(config.webkitDeviceUdid).trim()
                : '';
        if (!launchUdid) {
            const settingUdid = ws.get<string>('webkitDeviceUdid')?.trim() ?? '';
            if (settingUdid) {
                config.webkitDeviceUdid = settingUdid;
            }
        }

        return config;
    }

    provideDebugConfigurations(
        _folder: vscode.WorkspaceFolder | undefined,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [
            {
                type: 'whiteneedle',
                request: 'launch',
                name: 'WhiteNeedle: Debug Script',
                host: '127.0.0.1',
                inspectorPort: 9222,
                script: '${file}',
            },
        ];
    }
}
