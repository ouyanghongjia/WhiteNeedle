/**
 * Coordinator — routes commands to WhiteNeedle (in-app) or WDA (system-level).
 *
 * It does NOT own complex logic. It's a thin router:
 *   - "Is this an in-app operation?" → WhiteNeedle
 *   - "Is this a system/cross-app operation?" → WDA
 *
 * The test script (or MCP caller) decides ordering; the coordinator just
 * decides *who* executes each command.
 */

import { TcpClient } from './tcpClient.js';
import { WdaClient } from './wdaClient.js';

export type Engine = 'wn' | 'wda' | 'auto';

export interface CoordinatorConfig {
    wn?: { host: string; port: number };
    wda?: { host: string; port: number };
}

export class Coordinator {
    readonly wn: TcpClient;
    readonly wda: WdaClient;

    private wnHost: string;
    private wnPort: number;
    private wdaHost: string;
    private wdaPort: number;

    constructor(config?: CoordinatorConfig) {
        this.wnHost = config?.wn?.host ?? process.env['WN_HOST'] ?? '127.0.0.1';
        this.wnPort = config?.wn?.port ?? Number(process.env['WN_PORT'] ?? '27042');
        this.wdaHost = config?.wda?.host ?? process.env['WDA_HOST'] ?? '127.0.0.1';
        this.wdaPort = config?.wda?.port ?? Number(process.env['WDA_PORT'] ?? '8100');

        this.wn = new TcpClient();
        this.wda = new WdaClient(this.wdaHost, this.wdaPort);
    }

    // ------------------------------------------------------------------
    // Connection management
    // ------------------------------------------------------------------

    async connectWN(): Promise<void> {
        if (!this.wn.isConnected) {
            await this.wn.connect(this.wnHost, this.wnPort);
        }
    }

    async connectWDA(): Promise<string> {
        if (!this.wda.isSessionActive) {
            await this.wda.createSession();
        }
        return 'connected';
    }

    async connectAll(): Promise<{ wn: boolean; wda: boolean }> {
        const results = { wn: false, wda: false };

        try {
            await this.connectWN();
            results.wn = true;
        } catch { /* WN not available */ }

        try {
            await this.connectWDA();
            results.wda = true;
        } catch { /* WDA not available */ }

        return results;
    }

    async disconnectAll(): Promise<void> {
        try { this.wn.disconnect(); } catch { /* ignore */ }
        try { await this.wda.deleteSession(); } catch { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    get wnConnected(): boolean {
        return this.wn.isConnected;
    }

    get wdaConnected(): boolean {
        return this.wda.isSessionActive;
    }

    async status(): Promise<{
        wn: { connected: boolean; host: string; port: number };
        wda: { connected: boolean; host: string; port: number; ready?: boolean };
    }> {
        let wdaReady: boolean | undefined;
        if (this.wda.isSessionActive) {
            try {
                const s = await this.wda.status();
                wdaReady = s.ready;
            } catch { wdaReady = false; }
        }

        return {
            wn: {
                connected: this.wn.isConnected,
                host: this.wnHost,
                port: this.wnPort,
            },
            wda: {
                connected: this.wda.isSessionActive,
                host: this.wdaHost,
                port: this.wdaPort,
                ready: wdaReady,
            },
        };
    }

    // ------------------------------------------------------------------
    // Smart tap — the "auto" router
    // ------------------------------------------------------------------

    /**
     * Tap an element by text/label. Routes to the best engine:
     *   - If WN is connected, use WN (faster, in-process).
     *   - If only WDA is connected, use WDA.
     *   - If engine is explicitly specified, use that.
     */
    async tap(
        selector: string,
        options?: { engine?: Engine; timeout?: number },
    ): Promise<{ engine: Engine; success: boolean; detail?: string }> {
        const engine = options?.engine ?? 'auto';
        const chosen = this.resolveEngine(engine);

        if (chosen === 'wn') {
            await this.connectWN();
            const code = `
(function() {
    var auto = require('wn-auto');
    var result = auto.tapByText(${JSON.stringify(selector)});
    return JSON.stringify(result);
})()`;
            const result = await this.wn.call('evaluate', { code });
            return { engine: 'wn', success: true, detail: String(result) };
        } else {
            await this.connectWDA();
            await this.wda.tapByText(selector);
            return { engine: 'wda', success: true };
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private resolveEngine(preference: Engine): 'wn' | 'wda' {
        if (preference === 'wn') return 'wn';
        if (preference === 'wda') return 'wda';

        // auto: prefer WN when connected (faster, in-process)
        if (this.wn.isConnected) return 'wn';
        if (this.wda.isSessionActive) return 'wda';

        // neither connected — default to WN (will attempt connection)
        return 'wn';
    }
}
