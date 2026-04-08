import { ChildProcess, spawn } from 'child_process';
import * as http from 'http';

export interface InspectorTarget {
    devtoolsFrontendUrl: string;
    faviconUrl: string;
    thumbnailUrl: string;
    title: string;
    url: string;
    webSocketDebuggerUrl: string;
    appId?: string;
}

/**
 * Manages an ios_webkit_debug_proxy child process.
 *
 * ios_webkit_debug_proxy connects to the system's com.apple.webinspector
 * lockdown service over USB and exposes all debuggable targets (WKWebView
 * pages, JSContext instances) via HTTP /json + WebSocket — the same
 * protocol Chrome DevTools and VS Code understand.
 *
 * Port layout (default):
 *   9221 — device listing
 *   9222 — first connected device's targets
 */
export class WebKitProxy {
    private process: ChildProcess | null = null;
    private _devicePort = 9222;

    get devicePort(): number {
        return this._devicePort;
    }

    get isRunning(): boolean {
        return this.process !== null;
    }

    async start(devicePort = 9222): Promise<void> {
        if (this.process) return;
        this._devicePort = devicePort;

        const alreadyRunning = await this.fetchTargets(devicePort).then(() => true).catch(() => false);
        if (alreadyRunning) {
            return;
        }

        return new Promise((resolve, reject) => {
            const proc = spawn('ios_webkit_debug_proxy', [
                '-F',
                '-c', `null:9221,:${devicePort}-${devicePort + 100}`,
            ]);

            this.process = proc;
            let settled = false;

            const settle = (fn: () => void) => {
                if (!settled) {
                    settled = true;
                    fn();
                }
            };

            const onOutput = (data: Buffer) => {
                const str = data.toString();
                if (/Listing|Connected|attached/i.test(str)) {
                    settle(() => resolve());
                }
            };

            proc.stdout?.on('data', onOutput);
            proc.stderr?.on('data', onOutput);

            proc.on('error', (err) => {
                this.process = null;
                settle(() =>
                    reject(
                        new Error(
                            `ios_webkit_debug_proxy 启动失败: ${err.message}\n` +
                            '请先安装: brew install ios-webkit-debug-proxy'
                        )
                    )
                );
            });

            proc.on('exit', (code) => {
                this.process = null;
                if (!settled && code !== 0) {
                    settle(() =>
                        reject(
                            new Error(
                                `ios_webkit_debug_proxy 退出 (code=${code})。` +
                                '请确认 iPhone 已通过 USB 连接，且 Safari > Web Inspector 已开启。'
                            )
                        )
                    );
                }
            });

            setTimeout(() => settle(() => resolve()), 3000);
        });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    async fetchTargets(port?: number): Promise<InspectorTarget[]> {
        const p = port ?? this._devicePort;
        const jsonUrl = `http://127.0.0.1:${p}/json`;

        return new Promise((resolve, reject) => {
            const req = http.get(jsonUrl, (res) => {
                let body = '';
                res.on('data', (chunk: string) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`GET ${jsonUrl} → HTTP ${res.statusCode}`));
                        return;
                    }
                    try {
                        const targets = JSON.parse(body);
                        if (!Array.isArray(targets)) {
                            reject(new Error(`${jsonUrl} 未返回 JSON 数组`));
                            return;
                        }
                        resolve(targets as InspectorTarget[]);
                    } catch {
                        reject(new Error(`${jsonUrl} 的响应不是合法 JSON`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`无法访问 ${jsonUrl}（${err.message}）`));
            });

            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error(`访问 ${jsonUrl} 超时`));
            });
        });
    }
}
