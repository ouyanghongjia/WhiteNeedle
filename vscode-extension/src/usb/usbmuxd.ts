/**
 * Native usbmuxd client for macOS / Linux.
 *
 * Speaks the usbmuxd binary protocol directly over the Unix domain socket
 * at /var/run/usbmuxd — no dependency on libimobiledevice or iproxy.
 *
 * Protocol overview:
 *   Header (16 bytes): length(u32le) version(u32le) type(u32le) tag(u32le)
 *   Body: binary plist (version 1) or XML plist (version 0)
 *
 * We always use version=1 (binary plist) which is what modern macOS expects.
 */

import * as net from 'net';
import { EventEmitter } from 'events';

const USBMUXD_SOCKET = '/var/run/usbmuxd';

const HEADER_SIZE = 16;

const enum MsgType {
    Result = 1,
    Connect = 2,
    Listen = 3,
    DeviceAdd = 4,
    DeviceRemove = 5,
    PairRecord = 6,
    // plist-based types
    PlistMessage = 8,
}

const enum ResultCode {
    OK = 0,
    BadCommand = 1,
    BadDevice = 2,
    ConnectionRefused = 3,
    BadVersion = 6,
}

export interface UsbDevice {
    DeviceID: number;
    Properties: {
        ConnectionSpeed: number;
        ConnectionType: string;
        DeviceID: number;
        LocationID: number;
        ProductID: number;
        SerialNumber: string;
        UDID?: string;
        USBSerialNumber?: string;
    };
}

// ---------------------------------------------------------------------------
// Minimal plist encoder / decoder (XML subset used by usbmuxd)
// ---------------------------------------------------------------------------

function encodePlist(obj: Record<string, unknown>): Buffer {
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
    ];

    function encode(value: unknown): void {
        if (typeof value === 'string') {
            lines.push(`<string>${escapeXml(value)}</string>`);
        } else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                lines.push(`<integer>${value}</integer>`);
            } else {
                lines.push(`<real>${value}</real>`);
            }
        } else if (typeof value === 'boolean') {
            lines.push(value ? '<true/>' : '<false/>');
        } else if (Array.isArray(value)) {
            lines.push('<array>');
            for (const item of value) { encode(item); }
            lines.push('</array>');
        } else if (value && typeof value === 'object') {
            lines.push('<dict>');
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                lines.push(`<key>${escapeXml(k)}</key>`);
                encode(v);
            }
            lines.push('</dict>');
        }
    }

    encode(obj);
    lines.push('</plist>');
    return Buffer.from(lines.join('\n'), 'utf8');
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodePlist(buf: Buffer): any {
    const xml = buf.toString('utf8');
    return parsePlistXml(xml);
}

function parsePlistXml(xml: string): any {
    let pos = 0;

    function skipWs(): void {
        while (pos < xml.length && /\s/.test(xml[pos])) { pos++; }
    }

    function readTag(): { name: string; selfClose: boolean; close: boolean } | null {
        skipWs();
        if (pos >= xml.length || xml[pos] !== '<') { return null; }
        pos++; // skip <

        // skip processing instructions and doctype
        if (xml[pos] === '?') {
            const end = xml.indexOf('?>', pos);
            pos = end >= 0 ? end + 2 : xml.length;
            return readTag();
        }
        if (xml[pos] === '!') {
            // skip doctype and comments
            if (xml.substring(pos, pos + 2) === '!-') {
                const end = xml.indexOf('-->', pos);
                pos = end >= 0 ? end + 3 : xml.length;
            } else {
                const end = xml.indexOf('>', pos);
                pos = end >= 0 ? end + 1 : xml.length;
            }
            return readTag();
        }

        const close = xml[pos] === '/';
        if (close) { pos++; }

        let name = '';
        while (pos < xml.length && /[a-zA-Z0-9_-]/.test(xml[pos])) {
            name += xml[pos++];
        }

        // skip attributes
        while (pos < xml.length && xml[pos] !== '>' && xml[pos] !== '/') { pos++; }

        const selfClose = xml[pos] === '/';
        if (selfClose) { pos++; }
        if (pos < xml.length && xml[pos] === '>') { pos++; }

        return { name, selfClose, close };
    }

    function readTextUntil(endTag: string): string {
        const end = xml.indexOf(`</${endTag}>`, pos);
        if (end < 0) { return ''; }
        const text = xml.substring(pos, end);
        pos = end + endTag.length + 3; // skip </tag>
        return text;
    }

    function parseValue(): any {
        const tag = readTag();
        if (!tag) { return undefined; }

        switch (tag.name) {
            case 'plist':
                return parseValue();
            case 'dict': {
                if (tag.selfClose) { return {}; }
                const obj: Record<string, any> = {};
                while (true) {
                    skipWs();
                    if (pos < xml.length && xml.substring(pos, pos + 7) === '</dict>') {
                        pos += 7;
                        break;
                    }
                    const keyTag = readTag();
                    if (!keyTag || keyTag.name !== 'key') { break; }
                    const key = readTextUntil('key');
                    obj[key] = parseValue();
                }
                return obj;
            }
            case 'array': {
                if (tag.selfClose) { return []; }
                const arr: any[] = [];
                while (true) {
                    skipWs();
                    if (pos < xml.length && xml.substring(pos, pos + 8) === '</array>') {
                        pos += 8;
                        break;
                    }
                    const val = parseValue();
                    if (val !== undefined) { arr.push(val); }
                    else { break; }
                }
                return arr;
            }
            case 'string':
                return tag.selfClose ? '' : unescapeXml(readTextUntil('string'));
            case 'integer':
                return tag.selfClose ? 0 : parseInt(readTextUntil('integer'), 10);
            case 'real':
                return tag.selfClose ? 0 : parseFloat(readTextUntil('real'));
            case 'true':
                return true;
            case 'false':
                return false;
            case 'data':
                return tag.selfClose ? '' : readTextUntil('data').trim();
            case 'date':
                return tag.selfClose ? '' : readTextUntil('date');
            default:
                return undefined;
        }
    }

    return parseValue();
}

function unescapeXml(s: string): string {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Low-level message framing
// ---------------------------------------------------------------------------

function buildMessage(type: MsgType, tag: number, payload: Buffer): Buffer {
    const totalLength = HEADER_SIZE + payload.length;
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32LE(totalLength, 0);
    header.writeUInt32LE(1, 4);   // version = 1 (plist)
    header.writeUInt32LE(type, 8);
    header.writeUInt32LE(tag, 12);
    return Buffer.concat([header, payload]);
}

function buildPlistMessage(tag: number, body: Record<string, unknown>): Buffer {
    const payload = encodePlist(body);
    return buildMessage(MsgType.PlistMessage, tag, payload);
}

interface ParsedMessage {
    length: number;
    version: number;
    type: number;
    tag: number;
    payload: any;
}

function parseMessage(buf: Buffer): ParsedMessage | null {
    if (buf.length < HEADER_SIZE) { return null; }
    const length = buf.readUInt32LE(0);
    if (buf.length < length) { return null; }

    const version = buf.readUInt32LE(4);
    const type = buf.readUInt32LE(8);
    const tag = buf.readUInt32LE(12);
    const payloadBuf = buf.subarray(HEADER_SIZE, length);

    let payload: any = null;
    if (payloadBuf.length > 0) {
        try {
            payload = decodePlist(payloadBuf);
        } catch {
            payload = payloadBuf;
        }
    }

    return { length, version, type, tag, payload };
}

// ---------------------------------------------------------------------------
// UsbmuxdClient — high-level API
// ---------------------------------------------------------------------------

export class UsbmuxdClient extends EventEmitter {
    private socket: net.Socket | null = null;
    private readBuffer: Buffer = Buffer.alloc(0);
    private nextTag = 1;
    private pendingCallbacks = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    private _listening = false;

    /**
     * List all currently connected USB devices.
     * Opens a transient connection, queries, then closes.
     */
    async listDevices(): Promise<UsbDevice[]> {
        const sock = await this.openSocket();
        const tag = this.nextTag++;

        return new Promise<UsbDevice[]>((resolve, reject) => {
            let buf = Buffer.alloc(0);

            sock.on('data', (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                const msg = parseMessage(buf);
                if (!msg) { return; }
                buf = buf.subarray(msg.length);
                sock.destroy();

                if (msg.payload?.DeviceList) {
                    resolve(msg.payload.DeviceList as UsbDevice[]);
                } else if (msg.payload?.MessageType === 'Result' && msg.payload?.Number === 0) {
                    resolve([]);
                } else {
                    resolve(msg.payload?.DeviceList || []);
                }
            });

            sock.on('error', (err) => reject(err));
            sock.on('close', () => {
                // if we got here without resolving, there are no devices
            });

            const pkt = buildPlistMessage(tag, {
                MessageType: 'ListDevices',
                ClientVersionString: 'WhiteNeedle',
                ProgName: 'WhiteNeedle',
            });
            sock.write(pkt);
        });
    }

    /**
     * Start listening for device attach/detach events.
     * Emits 'attached' (UsbDevice) and 'detached' (deviceId: number).
     */
    async startListening(): Promise<void> {
        if (this._listening) { return; }

        this.socket = await this.openSocket();
        this._listening = true;
        this.readBuffer = Buffer.alloc(0);

        this.socket.on('data', (chunk) => {
            this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
            this.drainMessages();
        });

        this.socket.on('error', (err) => {
            this._listening = false;
            this.emit('error', err);
        });

        this.socket.on('close', () => {
            this._listening = false;
            this.emit('closed');
        });

        const tag = this.nextTag++;
        const pkt = buildPlistMessage(tag, {
            MessageType: 'Listen',
            ClientVersionString: 'WhiteNeedle',
            ProgName: 'WhiteNeedle',
        });
        this.socket.write(pkt);
    }

    stopListening(): void {
        this._listening = false;
        this.socket?.destroy();
        this.socket = null;
    }

    get isListening(): boolean {
        return this._listening;
    }

    /**
     * Create a TCP tunnel to a specific device+port.
     * Returns a connected net.Socket that speaks directly to the device port.
     */
    async connect(deviceId: number, port: number): Promise<net.Socket> {
        const sock = await this.openSocket();
        const tag = this.nextTag++;

        return new Promise<net.Socket>((resolve, reject) => {
            let buf = Buffer.alloc(0);
            let settled = false;

            sock.on('data', (chunk) => {
                if (settled) { return; }
                buf = Buffer.concat([buf, chunk]);
                const msg = parseMessage(buf);
                if (!msg) { return; }

                settled = true;
                if (msg.payload?.MessageType === 'Result' && msg.payload?.Number === 0) {
                    // Remove all listeners — the socket is now a raw TCP tunnel
                    sock.removeAllListeners('data');
                    sock.removeAllListeners('error');

                    // Push back any extra bytes that arrived after the response
                    const leftover = buf.subarray(msg.length);
                    if (leftover.length > 0) {
                        sock.unshift(leftover);
                    }
                    resolve(sock);
                } else {
                    const code = msg.payload?.Number ?? -1;
                    sock.destroy();
                    reject(new Error(`usbmuxd Connect failed (code=${code})`));
                }
            });

            sock.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            });

            // usbmuxd expects port in network byte order (big-endian) as an integer
            const portBE = ((port & 0xFF) << 8) | ((port >> 8) & 0xFF);

            const pkt = buildPlistMessage(tag, {
                MessageType: 'Connect',
                DeviceID: deviceId,
                PortNumber: portBE,
                ClientVersionString: 'WhiteNeedle',
                ProgName: 'WhiteNeedle',
            });
            sock.write(pkt);
        });
    }

    private drainMessages(): void {
        while (true) {
            const msg = parseMessage(this.readBuffer);
            if (!msg) { break; }
            this.readBuffer = this.readBuffer.subarray(msg.length);
            this.handleMessage(msg);
        }
    }

    private handleMessage(msg: ParsedMessage): void {
        const payload = msg.payload;
        if (!payload) { return; }

        // Listen response (Result OK)
        if (payload.MessageType === 'Result') {
            if (payload.Number !== 0) {
                this.emit('error', new Error(`usbmuxd Listen failed: code=${payload.Number}`));
            }
            return;
        }

        if (payload.MessageType === 'Attached') {
            this.emit('attached', payload as UsbDevice);
        } else if (payload.MessageType === 'Detached') {
            this.emit('detached', payload.DeviceID as number);
        }
    }

    private openSocket(): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const sock = net.createConnection({ path: USBMUXD_SOCKET });
            sock.once('connect', () => {
                sock.removeAllListeners('error');
                resolve(sock);
            });
            sock.once('error', (err) => {
                reject(new Error(
                    `Cannot connect to usbmuxd (${USBMUXD_SOCKET}): ${err.message}. ` +
                    'Make sure an iOS device is connected or Xcode is installed.'
                ));
            });
        });
    }
}
