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

/** Device `evaluate` JSON-RPC returns `{ value: string }` (JSC `toString` of result). */
function formatEvaluateResult(raw: unknown): string {
    if (raw && typeof raw === 'object' && raw !== null && 'value' in raw) {
        return String((raw as { value?: unknown }).value);
    }
    return formatResult(raw);
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await ensureConnected();
    return client.call(method, params);
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function safeRpc(
    method: string,
    params: Record<string, unknown> = {},
    format?: (raw: unknown) => string,
): Promise<ToolResult> {
    try {
        const result = await rpc(method, params);
        const text = format ? format(result) : formatResult(result);
        return { content: [{ type: 'text', text }] };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `${method} failed: ${msg}` }], isError: true };
    }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
    name: 'whiteneedle',
    version: '0.2.0',
});

// ---- connect / disconnect ----
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
        return safeRpc('getClassNames', { filter: filter ?? '' }, (raw) => {
            const classes = (raw as { classes?: string[] }).classes ?? [];
            return `Found ${classes.length} classes:\n${classes.join('\n')}`;
        });
    },
);

// ---- get_methods (matches device: instanceMethods + classMethods) ----
server.tool(
    'get_methods',
    'List Objective-C methods for a class. Device returns instanceMethods and classMethods arrays.',
    {
        className: z.string().min(1).describe('ObjC class name, e.g. NSURLSession'),
        which: z
            .enum(['instance', 'class', 'both'])
            .default('both')
            .describe('instance = -[...], class = +[...], both = both sections'),
    },
    async ({ className, which }) => {
        return safeRpc('getMethods', { className }, (raw) => {
            const result = raw as { instanceMethods?: string[]; classMethods?: string[] };
            const inst = result.instanceMethods ?? [];
            const cls = result.classMethods ?? [];
            if (which === 'instance') {
                return `-[${className}] — ${inst.length} instance methods:\n${inst.join('\n')}`;
            }
            if (which === 'class') {
                return `+[${className}] — ${cls.length} class methods:\n${cls.join('\n')}`;
            }
            return `-[${className}] — ${inst.length} instance methods:\n${inst.join('\n')}\n\n+[${className}] — ${cls.length} class methods:\n${cls.join('\n')}`;
        });
    },
);

// ---- evaluate ----
server.tool(
    'evaluate',
    'Evaluate arbitrary JavaScript on the device (ObjC.use, Interceptor, FileSystem, etc.)',
    {
        code: z.string().min(1).describe('JavaScript source'),
    },
    async ({ code }) => {
        try {
            const result = await rpc('evaluate', { code });
            return { content: [{ type: 'text', text: formatEvaluateResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Evaluation error: ${msg}` }], isError: true };
        }
    },
);

// ---- Scripts ----
server.tool(
    'load_script',
    'Load a named script; persists until unload_script.',
    {
        name: z.string().describe('Unique script name'),
        code: z.string().describe('JavaScript source'),
    },
    async ({ name, code }) => {
        try {
            const result = await rpc('loadScript', { name, code });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Load failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'unload_script',
    'Unload a script by name',
    { name: z.string().describe('Script name') },
    async ({ name }) => {
        try {
            const result = await rpc('unloadScript', { name });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Unload failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'list_scripts',
    'List loaded script names',
    {},
    async () => {
        return safeRpc('listScripts', {}, (raw) => {
            const scripts = (raw as { scripts?: string[] }).scripts ?? [];
            return scripts.length > 0 ? `Loaded scripts:\n${scripts.join('\n')}` : 'No scripts loaded';
        });
    },
);

// ---- Hooks ----
server.tool(
    'list_hooks',
    'List active ObjC and C hook descriptors (summary)',
    {},
    async () => {
        return safeRpc('listHooks', {}, (raw) => {
            const hooks = (raw as { hooks?: string[] }).hooks ?? [];
            return hooks.length > 0 ? `Active hooks (${hooks.length}):\n${hooks.join('\n')}` : 'No active hooks';
        });
    },
);

server.tool(
    'list_hooks_detailed',
    'List hooks with extra metadata from the hook engine',
    {},
    async () => safeRpc('listHooksDetailed'),
);

server.tool(
    'pause_hook',
    'Pause an active hook by selector string (e.g. -[Foo bar:])',
    { selector: z.string().describe('Hook selector / key') },
    async ({ selector }) => safeRpc('pauseHook', { selector }),
);

server.tool(
    'resume_hook',
    'Resume a paused hook',
    { selector: z.string().describe('Hook selector / key') },
    async ({ selector }) => safeRpc('resumeHook', { selector }),
);

// ---- Modules ----
server.tool(
    'list_modules',
    'List loaded frameworks / modules',
    {},
    async () => {
        return safeRpc('listModules', {}, (raw) => {
            const modules = (raw as { modules?: unknown[] }).modules ?? [];
            return `Loaded modules (${modules.length}):\n${formatResult(modules)}`;
        });
    },
);

// ---- trace_method ----
server.tool(
    'trace_method',
    'Attach Interceptor to trace calls; loads a script named trace_<sanitized>',
    {
        target: z.string().describe('Method token, e.g. -[NSURLSession dataTaskWithRequest:]'),
    },
    async ({ target }) => {
        const scriptName = `trace_${target.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const safeTarget = JSON.stringify(target);
        const code = `
(function() {
    var t = ${safeTarget};
    Interceptor.attach(t, {
        onEnter: function(self) {
            console.log('[TRACE] ' + t + ' called on: ' + self);
        },
        onLeave: function() {
            console.log('[TRACE] ' + t + ' returned');
        }
    });
})();
`;
        try {
            await rpc('loadScript', { name: scriptName, code });
            return {
                content: [{
                    type: 'text',
                    text: `Tracing ${target}. Script: ${scriptName}. Use unload_script to stop.`,
                }],
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Trace failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'rpc_call',
    'Call rpc.exports.<method> on the device',
    {
        method: z.string().describe('Export name'),
        args: z.array(z.unknown()).default([]).describe('Arguments'),
    },
    async ({ method, args }) => {
        try {
            const result = await rpc('rpcCall', { method, args });
            return { content: [{ type: 'text', text: formatResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `RPC call failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'inspect_object',
    'Evaluate an expression and return JSON description / error',
    {
        expression: z.string().describe('JS expression, e.g. ObjC.use(\'UIApplication\').invoke(\'sharedApplication\')'),
    },
    async ({ expression }) => {
        const code = `
(function() {
    try {
        var obj = eval(${JSON.stringify(expression)});
        if (!obj) return JSON.stringify({ error: 'Expression returned null' });
        var desc = obj.toString ? obj.toString() : String(obj);
        return JSON.stringify({ description: desc });
    } catch(e) {
        return JSON.stringify({ error: e.message || String(e) });
    }
})()
`;
        try {
            const result = await rpc('evaluate', { code });
            return { content: [{ type: 'text', text: formatEvaluateResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Inspect failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'heap_search',
    'Find live instances via ObjC.choose (sync); returns count and up to 10 string samples',
    {
        className: z.string().describe('ObjC class name'),
        maxSamples: z.number().int().min(1).max(100).default(10).describe('Max instances to collect'),
    },
    async ({ className, maxSamples }) => {
        const safeClass = JSON.stringify(className);
        const n = Math.floor(maxSamples);
        const code = `
(function() {
    var out = [];
    var limit = ${n};
    ObjC.choose(${safeClass}, {
        onMatch: function(inst) {
            out.push(String(inst));
            return out.length >= limit ? 'stop' : undefined;
        },
        onComplete: function() {}
    });
    return JSON.stringify({ count: out.length, samples: out.slice(0, limit) });
})()
`;
        try {
            const result = await rpc('evaluate', { code });
            return { content: [{ type: 'text', text: formatEvaluateResult(result) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Heap search failed: ${msg}` }], isError: true };
        }
    },
);

// ---- Network monitor ----
server.tool(
    'list_network_requests',
    'List captured HTTP requests (summary)',
    {},
    async () => safeRpc('listNetworkRequests'),
);

server.tool(
    'get_network_request',
    'Get one captured request by id',
    { id: z.string().describe('Request id from list_network_requests') },
    async ({ id }) => safeRpc('getNetworkRequest', { id }),
);

server.tool(
    'clear_network_requests',
    'Clear network capture buffer',
    {},
    async () => safeRpc('clearNetworkRequests'),
);

server.tool(
    'set_network_capture',
    'Enable or disable network capture',
    { enabled: z.boolean().describe('true to capture') },
    async ({ enabled }) => safeRpc('setNetworkCapture', { enabled }),
);

// ---- UI debug ----
server.tool(
    'get_view_hierarchy',
    'Snapshot UI view tree (addresses, classes, hierarchy)',
    {},
    async () => safeRpc('getViewHierarchy'),
);

server.tool(
    'get_view_controllers',
    'Snapshot view controller tree',
    {},
    async () => safeRpc('getViewControllers'),
);

server.tool(
    'get_vc_detail',
    'Details for one UIViewController by address string from get_view_controllers',
    { address: z.string().describe('Hex address string') },
    async ({ address }) => safeRpc('getVCDetail', { address }),
);

server.tool(
    'get_view_detail',
    'Details for one UIView by address from get_view_hierarchy',
    { address: z.string().describe('Hex address string') },
    async ({ address }) => safeRpc('getViewDetail', { address }),
);

server.tool(
    'set_view_property',
    'Set a KVC-compatible property on a view by address',
    {
        address: z.string(),
        key: z.string().describe('Key path / property name'),
        value: z.unknown().describe('JSON-serializable value'),
    },
    async ({ address, key, value }) => safeRpc('setViewProperty', { address, key, value: value as Record<string, unknown> }),
);

server.tool(
    'highlight_view',
    'Highlight a view by address',
    { address: z.string() },
    async ({ address }) => safeRpc('highlightView', { address }),
);

server.tool(
    'clear_highlight',
    'Remove UI highlight overlay',
    {},
    async () => safeRpc('clearHighlight'),
);

server.tool(
    'search_views',
    'Find views whose class name contains the given name',
    { className: z.string().describe('UIView subclass name, e.g. UILabel') },
    async ({ className }) => safeRpc('searchViews', { className }),
);

server.tool(
    'search_views_by_text',
    'Find views whose visible text/title/placeholder contains the query (case-insensitive). Searches UILabel.text, UIButton.title, UITextField.text/placeholder, UITextView.text, UISegmentedControl titles.',
    { text: z.string().describe('Text substring to search for, e.g. "登录" or "Submit"') },
    async ({ text }) => safeRpc('searchViewsByText', { text }),
);

server.tool(
    'get_screenshot',
    'Take window screenshot as base64 PNG (large payload)',
    {},
    async () => safeRpc('getScreenshot'),
);

// ---- Mock interceptor ----
const mockRuleShape = {
    id: z.string().optional().describe('Existing rule UUID when updating'),
    urlPattern: z.string().optional(),
    method: z.string().optional().describe('HTTP method or *'),
    mode: z.enum(['pureMock', 'rewriteResponse']).optional(),
    statusCode: z.number().optional(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
    enabled: z.boolean().optional(),
    delay: z.number().optional(),
};

server.tool(
    'list_mock_rules',
    'List HTTP mock rules',
    {},
    async () => safeRpc('listMockRules'),
);

server.tool(
    'add_mock_rule',
    'Add a mock rule (urlPattern required on device)',
    {
        urlPattern: z.string().describe('Substring, wildcard *, or regex:pattern'),
        method: z.string().optional(),
        mode: z.enum(['pureMock', 'rewriteResponse']).optional(),
        statusCode: z.number().optional(),
        responseHeaders: z.record(z.string(), z.string()).optional(),
        responseBody: z.string().optional(),
        enabled: z.boolean().optional(),
        delay: z.number().optional(),
        id: z.string().optional(),
    },
    async (params) => safeRpc('addMockRule', params as Record<string, unknown>),
);

server.tool(
    'update_mock_rule',
    'Update rule by ruleId',
    {
        ruleId: z.string(),
        ...mockRuleShape,
    },
    async ({ ruleId, ...rest }) => safeRpc('updateMockRule', { ruleId, ...rest }),
);

server.tool(
    'remove_mock_rule',
    'Remove one mock rule',
    { ruleId: z.string() },
    async ({ ruleId }) => safeRpc('removeMockRule', { ruleId }),
);

server.tool(
    'remove_all_mock_rules',
    'Clear all mock rules',
    {},
    async () => safeRpc('removeAllMockRules'),
);

server.tool(
    'enable_mock_interceptor',
    'Install NSURLProtocol mock interceptor',
    {},
    async () => safeRpc('enableMockInterceptor'),
);

server.tool(
    'disable_mock_interceptor',
    'Uninstall mock interceptor',
    {},
    async () => safeRpc('disableMockInterceptor'),
);

server.tool(
    'get_mock_interceptor_status',
    'Whether mock is installed and rule count',
    {},
    async () => safeRpc('getMockInterceptorStatus'),
);

// ---- JSContext reset ----
server.tool(
    'reset_context',
    'Reset the device JSContext (clears all hooks, variables, module cache, FPS monitors)',
    {},
    async () => safeRpc('resetContext'),
);

// ---- Installed JS modules ----
server.tool(
    'list_installed_modules',
    'List user-installed JS modules in Documents/wn_installed_modules/',
    {},
    async () => {
        return safeRpc('listInstalledJsModules', {}, (raw) => {
            const modules = (raw as { modules?: Array<{ name: string; size: number }> }).modules ?? [];
            if (modules.length === 0) return 'No installed modules';
            const lines = modules.map((m) => `${m.name} (${m.size} bytes)`);
            return `Installed modules (${modules.length}):\n${lines.join('\n')}`;
        });
    },
);

// ---- Sandbox file operations ----
server.tool(
    'write_file',
    'Write a text file to the app sandbox (Documents/ relative path)',
    {
        path: z.string().describe('Relative path under Documents/, e.g. wn_installed_modules/utils.js'),
        content: z.string().describe('File content (UTF-8 text)'),
    },
    async ({ path, content }) => safeRpc('writeFile', { path, content }),
);

server.tool(
    'mkdir',
    'Create a directory in the app sandbox (Documents/ relative path)',
    {
        path: z.string().describe('Relative path under Documents/'),
    },
    async ({ path }) => safeRpc('mkdir', { path }),
);

server.tool(
    'remove_dir',
    'Remove a file or directory in the app sandbox (Documents/ relative path)',
    {
        path: z.string().describe('Relative path under Documents/'),
    },
    async ({ path }) => safeRpc('removeDir', { path }),
);

// ---------------------------------------------------------------------------
// Resources
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

const API_REFERENCE = `# WhiteNeedle Runtime API (summary)

For full API docs use the **whiteneedle-js-api** Cursor skill: bundled copies live under \`references/api-*.md\` (self-contained; not repo \`docs/\`).

## ObjC
- \`ObjC.use('Class')\` — class proxy; \`.invoke('sel:', [args])\`
- \`ObjC.instance(ptrOrObj)\` — instance proxy (incl. hex address string)
- \`ObjC.choose('Class', { onMatch, onComplete })\` — heap scan (sync callbacks)

## Interceptor
- \`Interceptor.attach('-[C m:]', { onEnter, onLeave })\`
- \`Interceptor.replace\`, \`Interceptor.rebindSymbol\`, C hooks via native bridge

## Host MCP tools (device JSON-RPC)
Runtime exploration: connect, list_classes, get_methods, evaluate, load_script, unload_script, list_scripts, list_hooks, list_hooks_detailed, pause_hook, resume_hook, list_modules, trace_method, rpc_call, inspect_object, heap_search.

Network: list_network_requests, get_network_request, clear_network_requests, set_network_capture.

UI: get_view_hierarchy, get_view_controllers, get_vc_detail, get_view_detail, set_view_property, highlight_view, clear_highlight, search_views, search_views_by_text, get_screenshot.

Mock HTTP: list_mock_rules, add_mock_rule, update_mock_rule, remove_mock_rule, remove_all_mock_rules, enable_mock_interceptor, disable_mock_interceptor, get_mock_interceptor_status.

Context & Modules: reset_context, list_installed_modules.

Sandbox Files: write_file, mkdir, remove_dir.

Skill bundle: \`references/api-mcp-tools.md\`; monorepo mirror: \`docs/api-mcp-tools.md\`.
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
