import * as vscode from 'vscode';
import { DeviceManager, ConnectionState } from '../device/deviceManager';

/**
 * Binds DeviceManager connection state to a webview panel,
 * sending `{ command: 'connectionState', state }` messages on change.
 * Returns a Disposable for cleanup.
 */
export function bindConnectionState(
    panel: vscode.WebviewPanel,
    deviceManager: DeviceManager,
    disposables: vscode.Disposable[]
): void {
    const sendState = (state: ConnectionState) => {
        try {
            panel.webview.postMessage({ command: 'connectionState', state });
        } catch {
            // panel may already be disposed
        }
    };

    const listener = (state: ConnectionState) => sendState(state);
    deviceManager.on('stateChanged', listener);
    disposables.push(new vscode.Disposable(() => {
        deviceManager.removeListener('stateChanged', listener);
    }));

    sendState(deviceManager.state);
}

/** Shared CSS for the connection overlay injected into webview HTML. */
export const OVERLAY_CSS = `
.wn-offline-overlay {
    display: none;
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(3px);
    align-items: center; justify-content: center;
    flex-direction: column; gap: 8px;
    color: var(--vscode-editor-foreground, #ccc);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 14px;
}
.wn-offline-overlay.visible { display: flex; }
.wn-offline-icon { font-size: 36px; opacity: 0.7; }
.wn-offline-text { opacity: 0.9; }
.wn-offline-sub { font-size: 12px; opacity: 0.6; }
@keyframes wn-spin { to { transform: rotate(360deg); } }
.wn-reconnecting .wn-offline-icon { animation: wn-spin 1.5s linear infinite; }
`;

/** Shared HTML for the overlay element. */
export const OVERLAY_HTML = `
<div class="wn-offline-overlay" id="wnOfflineOverlay">
    <span class="wn-offline-icon" id="wnOfflineIcon">⚡</span>
    <span class="wn-offline-text" id="wnOfflineText">Device Disconnected</span>
    <span class="wn-offline-sub" id="wnOfflineSub">Waiting for connection...</span>
</div>
`;

/**
 * Shared JS snippet (to be injected inside a <script> tag) that handles
 * `connectionState` messages and toggles the overlay.
 */
export const OVERLAY_JS = `
(function() {
    var overlay = document.getElementById('wnOfflineOverlay');
    var icon = document.getElementById('wnOfflineIcon');
    var text = document.getElementById('wnOfflineText');
    var sub = document.getElementById('wnOfflineSub');
    if (!overlay) return;

    function updateOverlay(state) {
        if (state === 'connected') {
            overlay.classList.remove('visible', 'wn-reconnecting');
        } else if (state === 'reconnecting') {
            overlay.classList.add('visible', 'wn-reconnecting');
            icon.textContent = '⟳';
            text.textContent = 'Reconnecting...';
            sub.textContent = 'Attempting to restore connection';
        } else if (state === 'connecting') {
            overlay.classList.add('visible');
            overlay.classList.remove('wn-reconnecting');
            icon.textContent = '⟳';
            text.textContent = 'Connecting...';
            sub.textContent = '';
        } else {
            overlay.classList.add('visible');
            overlay.classList.remove('wn-reconnecting');
            icon.textContent = '⚡';
            text.textContent = 'Device Disconnected';
            sub.textContent = 'Open a device connection to use this panel';
        }
    }

    window.addEventListener('message', function(event) {
        if (event.data && event.data.command === 'connectionState') {
            updateOverlay(event.data.state);
        }
    });
})();
`;
