import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';

/**
 * Manages an iproxy USB tunnel between Mac and iOS device.
 *
 * iproxy (from libimobiledevice) forwards a local TCP port to the device
 * port over the USB connection, bypassing Wi-Fi entirely. This is the same
 * mechanism Safari Web Inspector uses.
 */
export class USBTunnel {
    private process: ChildProcess | null = null;
    private _localPort: number;
    private _remotePort: number;

    constructor(localPort: number, remotePort: number) {
        this._localPort = localPort;
        this._remotePort = remotePort;
    }

    get localPort(): number {
        return this._localPort;
    }

    get isRunning(): boolean {
        return this.process !== null;
    }

    /**
     * Start iproxy tunnel. Resolves when the tunnel is ready to accept
     * connections, or rejects if iproxy is not installed / fails.
     */
    async start(): Promise<void> {
        if (this.process) return;

        if (await this.isPortOpen(this._localPort)) {
            return;
        }

        return new Promise((resolve, reject) => {
            const proc = spawn('iproxy', [
                String(this._localPort),
                String(this._remotePort),
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
                if (/waiting|listen|Creating/i.test(str)) {
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
                            `iproxy 启动失败: ${err.message}\n` +
                                '请先安装: brew install libimobiledevice'
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
                                `iproxy 退出 (code=${code})。请确认 iPhone 已通过 USB 连接。`
                            )
                        )
                    );
                }
            });

            setTimeout(() => settle(() => resolve()), 2000);
        });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    private isPortOpen(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const sock = net.createConnection({ port, host: '127.0.0.1' });
            sock.once('connect', () => {
                sock.destroy();
                resolve(true);
            });
            sock.once('error', () => resolve(false));
            sock.setTimeout(500, () => {
                sock.destroy();
                resolve(false);
            });
        });
    }
}
