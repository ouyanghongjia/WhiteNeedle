#!/usr/bin/env node
'use strict';

/**
 * WhiteNeedle Sidecar Bridge
 *
 * JSON-RPC over stdio bridge between VSCode extension and frida-node.
 * Handles device connection, script lifecycle, and debug protocol forwarding.
 */

const frida = require('frida');
const readline = require('readline');

let device = null;
let session = null;
let script = null;

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

function notify(method, params = {}) {
    send({ jsonrpc: '2.0', method, params });
}

function respond(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

// --- RPC Method Handlers ---

async function handleConnect({ host, port }) {
    const mgr = frida.getDeviceManager();
    device = await mgr.addRemoteDevice(`${host}:${port}`);

    const processes = await device.enumerateProcesses();
    const frontmost = processes.find(p => p.pid !== 0) || processes[0];
    if (!frontmost) {
        throw new Error('No process found on device');
    }

    session = await device.attach(frontmost.pid);
    session.detached.connect((reason) => {
        notify('detached', { reason: reason.toString() });
        session = null;
        script = null;
    });

    return {
        pid: frontmost.pid,
        name: frontmost.name,
        device: device.name,
    };
}

async function handleDisconnect() {
    if (script) {
        await script.unload().catch(() => {});
        script = null;
    }
    if (session) {
        await session.detach().catch(() => {});
        session = null;
    }
    device = null;
    return { ok: true };
}

async function handleLoadScript({ code, name, enableInspector, inspectorPort }) {
    if (!session) throw new Error('No active session');

    if (script) {
        await script.disableDebugger().catch(() => {});
        await script.unload().catch(() => {});
        script = null;
    }

    script = await session.createScript(code, { name, runtime: 'v8' });

    script.message.connect((message, data) => {
        if (message.type === 'send') {
            notify('console', {
                level: 'log',
                message: typeof message.payload === 'string'
                    ? message.payload
                    : JSON.stringify(message.payload),
            });
        } else if (message.type === 'error') {
            notify('scriptError', {
                message: message.description || 'Unknown error',
                stack: message.stack,
                lineNumber: message.lineNumber,
                fileName: message.fileName,
            });
        }
    });

    script.logHandler = (level, text) => {
        notify('console', { level, message: text });
    };

    await script.load();

    let actualInspectorPort = null;
    if (enableInspector) {
        const port = inspectorPort || 9229;
        await script.enableDebugger({ port });
        actualInspectorPort = port;
    }

    return { name, loaded: true, inspectorPort: actualInspectorPort };
}

async function handleUnloadScript() {
    if (script) {
        await script.unload();
        script = null;
    }
    return { ok: true };
}

async function handleEnableDebugger({ port }) {
    if (!script) throw new Error('No active script');
    await script.enableDebugger({ port });
    return { inspectorPort: port };
}

async function handleDisableDebugger() {
    if (script) {
        await script.disableDebugger();
    }
    return { ok: true };
}

async function handleRpcCall({ method, args }) {
    if (!script) throw new Error('No active script');
    const exports = script.exports;
    if (typeof exports[method] !== 'function') {
        throw new Error(`RPC method not found: ${method}`);
    }
    return await exports[method](...(args || []));
}

// --- Dispatch ---

const handlers = {
    connect: handleConnect,
    disconnect: handleDisconnect,
    loadScript: handleLoadScript,
    unloadScript: handleUnloadScript,
    enableDebugger: handleEnableDebugger,
    disableDebugger: handleDisableDebugger,
    rpcCall: handleRpcCall,
};

rl.on('line', async (line) => {
    let request;
    try {
        request = JSON.parse(line.trim());
    } catch {
        return;
    }

    const { id, method, params } = request;
    const handler = handlers[method];

    if (!handler) {
        respondError(id, -32601, `Method not found: ${method}`);
        return;
    }

    try {
        const result = await handler(params || {});
        respond(id, result);
    } catch (err) {
        respondError(id, -32000, err.message || String(err));
    }
});

rl.on('close', () => {
    handleDisconnect().catch(() => {});
    process.exit(0);
});

// Signal ready
notify('ready', { version: '0.1.0' });
