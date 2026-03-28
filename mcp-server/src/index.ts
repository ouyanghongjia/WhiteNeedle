#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TcpClient } from './tcpClient.js';

const client = new TcpClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureConnected(host?: string, port?: number): Promise<void> {
    if (client.isConnected) return;
    const h = host ?? process.env['WN_HOST'] ?? '127.0.0.1';
    const p = port ?? Number(process.env['WN_PORT'] ?? '27042');
    await client.connect(h, p);
}

function formatResult(data: unknown): string {
    if (typeof data === 'string') return data;
    return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
    name: 'whiteneedle',
    version: '0.1.0',
});

// ---- connect ----
server.tool(
    'connect',
    'Connect to a WhiteNeedle-enabled iOS device over TCP',
    {
        host: z.string().default('127.0.0.1').describe('Device IP address'),
        port: z.number().default(27042).describe('WhiteNeedle engine port'),
    },
    async ({ host, port }) => {
        try {
            await client.connect(host, port);
            return { content: [{ type: 'text', text: `Connected to ${host}:${port}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Connection failed: ${msg}` }], isError: true };
        }
    },
);

// ---- disconnect ----
server.tool(
    'disconnect',
    'Disconnect from the WhiteNeedle device',
    {},
    async () => {
        client.disconnect();
        return { content: [{ type: 'text', text: 'Disconnected' }] };
    },
);

// ---- list_classes ----
server.tool(
    'list_classes',
    'List all Objective-C classes loaded in the target process. Use filter to narrow down.',
    {
        filter: z.string().optional().describe('Prefix or substring filter for class names'),
    },
    async ({ filter }) => {
        await ensureConnected();
        const result = await client.call('getClassNames', { filter: filter ?? '' }) as { classes: string[] };
        const classes = result.classes ?? [];
        return {
            content: [{
                type: 'text',
                text: `Found ${classes.length} classes:\n${classes.join('\n')}`,
            }],
        };
    },
);

// ---- get_methods ----
server.tool(
    'get_methods',
    'Get all methods of a given Objective-C class',
    {
        className: z.string().describe('The ObjC class name, e.g. NSURLSession'),
        instanceMethods: z.boolean().default(true).describe('List instance methods (true) or class methods (false)'),
    },
    async ({ className, instanceMethods }) => {
        await ensureConnected();
        const result = await client.call('getMethods', { className, instance: instanceMethods }) as { methods: string[] };
        const methods = result.methods ?? [];
        const prefix = instanceMethods ? '-' : '+';
        return {
            content: [{
                type: 'text',
                text: `${prefix}[${className}] — ${methods.length} methods:\n${methods.join('\n')}`,
            }],
        };
    },
);

// ---- evaluate ----
server.tool(
    'evaluate',
    'Evaluate arbitrary JavaScript code on the device. Has full access to WhiteNeedle APIs (ObjC.use, Interceptor, etc.)',
    {
        code: z.string().describe('JavaScript code to evaluate on the device'),
    },
    async ({ code }) => {
        await ensureConnected();
        try {
            const result = await client.call('evaluate', { code });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Evaluation error: ${msg}` }], isError: true };
        }
    },
);

// ---- load_script ----
server.tool(
    'load_script',
    'Load a named JavaScript script onto the device. The script persists until unloaded.',
    {
        name: z.string().describe('Unique script name'),
        code: z.string().describe('JavaScript source code'),
    },
    async ({ name, code }) => {
        await ensureConnected();
        try {
            const result = await client.call('loadScript', { name, code });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Load failed: ${msg}` }], isError: true };
        }
    },
);

// ---- unload_script ----
server.tool(
    'unload_script',
    'Unload a previously loaded script from the device',
    {
        name: z.string().describe('Script name to unload'),
    },
    async ({ name }) => {
        await ensureConnected();
        try {
            const result = await client.call('unloadScript', { name });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Unload failed: ${msg}` }], isError: true };
        }
    },
);

// ---- list_scripts ----
server.tool(
    'list_scripts',
    'List all currently loaded scripts on the device',
    {},
    async () => {
        await ensureConnected();
        const result = await client.call('listScripts', {}) as { scripts: string[] };
        const scripts = result.scripts ?? [];
        return {
            content: [{
                type: 'text',
                text: scripts.length > 0
                    ? `Loaded scripts:\n${scripts.join('\n')}`
                    : 'No scripts loaded',
            }],
        };
    },
);

// ---- list_hooks ----
server.tool(
    'list_hooks',
    'List all active ObjC method hooks and C function hooks on the device',
    {},
    async () => {
        await ensureConnected();
        const result = await client.call('listHooks', {}) as { hooks: string[] };
        const hooks = result.hooks ?? [];
        return {
            content: [{
                type: 'text',
                text: hooks.length > 0
                    ? `Active hooks (${hooks.length}):\n${hooks.join('\n')}`
                    : 'No active hooks',
            }],
        };
    },
);

// ---- list_modules ----
server.tool(
    'list_modules',
    'List all loaded dynamic libraries/modules in the target process',
    {},
    async () => {
        await ensureConnected();
        const result = await client.call('listModules', {}) as { modules: unknown[] };
        const modules = result.modules ?? [];
        return {
            content: [{
                type: 'text',
                text: `Loaded modules (${modules.length}):\n${formatResult(modules)}`,
            }],
        };
    },
);

// ---- trace_method ----
server.tool(
    'trace_method',
    'Hook an ObjC method and trace its calls. Returns a script name you can use to unload later.',
    {
        target: z.string().describe('Method selector, e.g. -[NSURLSession dataTaskWithRequest:]'),
    },
    async ({ target }) => {
        await ensureConnected();
        const scriptName = `trace_${target.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const code = `
Interceptor.attach('${target}', {
    onEnter: function(self) {
        console.log('[TRACE] ${target} called on: ' + self);
    },
    onLeave: function() {
        console.log('[TRACE] ${target} returned');
    }
});
`;
        try {
            await client.call('loadScript', { name: scriptName, code });
            return {
                content: [{
                    type: 'text',
                    text: `Tracing ${target}. Script name: ${scriptName}\nUse unload_script to stop.`,
                }],
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Trace failed: ${msg}` }], isError: true };
        }
    },
);

// ---- rpc_call ----
server.tool(
    'rpc_call',
    'Call an exported RPC function defined in a loaded script via rpc.exports',
    {
        method: z.string().describe('RPC export name'),
        args: z.array(z.unknown()).default([]).describe('Arguments to pass'),
    },
    async ({ method, args }) => {
        await ensureConnected();
        try {
            const result = await client.call('rpcCall', { method, args });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `RPC call failed: ${msg}` }], isError: true };
        }
    },
);

// ---- inspect_object ----
server.tool(
    'inspect_object',
    'Inspect an ObjC object by evaluating code that queries its properties and methods',
    {
        expression: z.string().describe('An ObjC expression to inspect, e.g. "ObjC.use(\'UIApplication\').invoke(\'sharedApplication\')"'),
    },
    async ({ expression }) => {
        await ensureConnected();
        const code = `
(function() {
    var obj = ${expression};
    if (!obj) return JSON.stringify({ error: 'Expression returned null' });
    var desc = obj.toString ? obj.toString() : String(obj);
    return JSON.stringify({ description: desc });
})()
`;
        try {
            const result = await client.call('evaluate', { code });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Inspect failed: ${msg}` }], isError: true };
        }
    },
);

// ---- heap_search ----
server.tool(
    'heap_search',
    'Search the heap for live instances of a given ObjC class',
    {
        className: z.string().describe('ObjC class name to search for'),
    },
    async ({ className }) => {
        await ensureConnected();
        const code = `
(function() {
    var instances = ObjC.chooseSync('${className}');
    return JSON.stringify({
        count: instances.length,
        samples: instances.slice(0, 10).map(function(i) { return String(i); })
    });
})()
`;
        try {
            const result = await client.call('evaluate', { code });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Heap search failed: ${msg}` }], isError: true };
        }
    },
);

// ---------------------------------------------------------------------------
// Resources — provide API reference for script authoring
// ---------------------------------------------------------------------------

server.resource(
    'api_reference',
    'whiteneedle://api-reference',
    async (uri) => ({
        contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: API_REFERENCE,
        }],
    }),
);

const API_REFERENCE = `# WhiteNeedle Runtime API Reference

## ObjC Bridge
- \`ObjC.use('ClassName')\` — Get class proxy, call class methods via \`.invoke('method', [args])\`
- \`ObjC.use('ClassName').invoke('alloc').invoke('init')\` — Instantiate an ObjC object
- \`ObjC.instance(obj)\` — Wrap a native object as an instance proxy
- \`ObjC.classes\` — Object with all loaded class names as keys
- \`ObjC.choose('ClassName', { onMatch, onComplete })\` — Find live instances on the heap

## Interceptor (Method Hooking)
- \`Interceptor.attach('-[Class method:]', { onEnter(self){}, onLeave(){} })\` — Hook ObjC method
- \`Interceptor.replace('-[Class method:]', function(self){ ... })\` — Replace method implementation
- \`Interceptor.rebindSymbol('open', newAddress)\` — Rebind C function via fishhook
- \`Interceptor.hookCFunction('symbolName', replacementAddress)\` — Hook C function

## Class Definition
- \`ObjC.define({ name, super, protocols, methods })\` — Create new ObjC class at runtime
- \`ObjC.delegate({ protocols, methods })\` — Create delegate object

## Structs & Pointers
- \`$struct('CGRect', [['x','d'],['y','d'],['width','d'],['height','d']])\` — Define a C struct
- \`$pointer(address)\` — Read/write memory: \`.readU8()\`, \`.writeU32(value)\`, \`.readUtf8String(len)\`

## Modules
- \`Module.findExportByName('libSystem.B.dylib', 'open')\` — Find exported symbol address
- \`Module.enumerateModules()\` — List all loaded dylibs

## Debug
- \`Debug.breakpoint()\` — Trigger debugger breakpoint
- \`Debug.log(msg)\`, \`Debug.trace()\` — Debug logging
- \`Debug.time(label)\` / \`Debug.timeEnd(label)\` — Performance timing
- \`Debug.heapSize()\` — Get process memory usage

## Module System
- \`require('moduleName')\` — CommonJS-style module loading
- \`module.exports = { ... }\` — Export from a module

## RPC Exports
- \`rpc.exports = { myFunc() { return 42; } }\` — Expose functions callable from host
`;

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('WhiteNeedle MCP server started (stdio)\n');
}

main().catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
});
