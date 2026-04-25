#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TcpClient } from './tcpClient.js';
import { WdaClient } from './wdaClient.js';
import { Coordinator } from './coordinator.js';

const client = new TcpClient();
const coordinator = new Coordinator();

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

// =========================================================================
// WDA (WebDriverAgent) — system-level UI automation
// =========================================================================

// ---- WDA connect / disconnect ----
server.tool(
    'wda_connect',
    'Connect to WebDriverAgent (system-level UI automation). Creates a WDA session.',
    {
        host: z.string().default('127.0.0.1').describe('WDA host (localhost if iproxy running)'),
        port: z.number().default(8100).describe('WDA HTTP port'),
        bundleId: z.string().optional().describe('Optional: app bundle ID to activate'),
    },
    async ({ host, port, bundleId }) => {
        try {
            const wda = coordinator.wda;
            // Reconfigure if non-default
            if (host !== '127.0.0.1' || port !== 8100) {
                Object.assign(coordinator, { wda: new WdaClient(host, port) });
            }
            const sessionId = await coordinator.connectWDA();
            if (bundleId) {
                await coordinator.wda.activateApp(bundleId);
            }
            return { content: [{ type: 'text', text: `WDA connected (session: ${sessionId})${bundleId ? `, activated ${bundleId}` : ''}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WDA connection failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_disconnect',
    'Close the WDA session',
    {},
    async () => {
        try {
            await coordinator.wda.deleteSession();
            return { content: [{ type: 'text', text: 'WDA session closed' }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WDA disconnect failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_status',
    'Check WDA server status and readiness',
    {},
    async () => {
        try {
            const status = await coordinator.wda.status();
            return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WDA not reachable: ${msg}` }], isError: true };
        }
    },
);

// ---- WDA Element interaction ----
server.tool(
    'wda_find_element',
    'Find a UI element on screen via WDA (Accessibility). Strategies: "accessibility id", "class name", "xpath", "predicate string", "class chain".',
    {
        using: z.enum(['accessibility id', 'class name', 'xpath', 'predicate string', 'class chain']),
        value: z.string().describe('Search value matching the strategy'),
    },
    async ({ using, value }) => {
        try {
            const el = await coordinator.wda.findElement(using, value);
            return { content: [{ type: 'text', text: JSON.stringify(el) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Element not found: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_find_elements',
    'Find multiple UI elements via WDA',
    {
        using: z.enum(['accessibility id', 'class name', 'xpath', 'predicate string', 'class chain']),
        value: z.string(),
    },
    async ({ using, value }) => {
        try {
            const els = await coordinator.wda.findElements(using, value);
            return { content: [{ type: 'text', text: `Found ${els.length} elements:\n${JSON.stringify(els, null, 2)}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Find elements failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_tap',
    'Tap a UI element by accessibility label, text, or coordinates via WDA (system-level). Use this for system alerts, cross-app elements, or anything outside the target app.',
    {
        label: z.string().optional().describe('Accessibility label / visible text to tap'),
        x: z.number().optional().describe('Screen X coordinate (use with y)'),
        y: z.number().optional().describe('Screen Y coordinate (use with x)'),
        xpath: z.string().optional().describe('XPath selector'),
    },
    async ({ label, x, y, xpath }) => {
        try {
            if (label) {
                await coordinator.wda.tapByText(label);
            } else if (xpath) {
                await coordinator.wda.tapByXPath(xpath);
            } else if (x !== undefined && y !== undefined) {
                await coordinator.wda.tap(x, y);
            } else {
                return { content: [{ type: 'text', text: 'Provide label, xpath, or x+y coordinates' }], isError: true };
            }
            return { content: [{ type: 'text', text: `Tapped${label ? ` "${label}"` : xpath ? ` xpath` : ` (${x},${y})`} via WDA` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WDA tap failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_type',
    'Type text using WDA keyboard (system-level)',
    {
        text: z.string().describe('Text to type'),
    },
    async ({ text }) => {
        try {
            await coordinator.wda.typeText(text);
            return { content: [{ type: 'text', text: `Typed "${text}" via WDA` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WDA type failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_swipe',
    'Swipe gesture via WDA',
    {
        fromX: z.number(), fromY: z.number(),
        toX: z.number(), toY: z.number(),
        duration: z.number().default(0.5).describe('Swipe duration in seconds'),
    },
    async ({ fromX, fromY, toX, toY, duration }) => {
        try {
            await coordinator.wda.swipe(fromX, fromY, toX, toY, duration);
            return { content: [{ type: 'text', text: `Swiped (${fromX},${fromY}) → (${toX},${toY})` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WDA swipe failed: ${msg}` }], isError: true };
        }
    },
);

// ---- WDA Alerts ----
server.tool(
    'wda_accept_alert',
    'Accept (tap OK/Allow) on a system alert/dialog via WDA',
    {},
    async () => {
        try {
            await coordinator.wda.acceptAlert();
            return { content: [{ type: 'text', text: 'Alert accepted' }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `No alert or accept failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_dismiss_alert',
    'Dismiss (tap Cancel/Deny) on a system alert via WDA',
    {},
    async () => {
        try {
            await coordinator.wda.dismissAlert();
            return { content: [{ type: 'text', text: 'Alert dismissed' }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `No alert or dismiss failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_get_alert_text',
    'Read the text of the currently visible system alert',
    {},
    async () => {
        try {
            const text = await coordinator.wda.getAlertText();
            return { content: [{ type: 'text', text }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `No alert visible: ${msg}` }], isError: true };
        }
    },
);

// ---- WDA App lifecycle ----
server.tool(
    'wda_launch_app',
    'Launch (cold start) an app by bundle ID via WDA',
    { bundleId: z.string().describe('e.g. com.apple.Preferences') },
    async ({ bundleId }) => {
        try {
            await coordinator.wda.launchApp(bundleId);
            return { content: [{ type: 'text', text: `Launched ${bundleId}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Launch failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_activate_app',
    'Bring an app to foreground via WDA',
    { bundleId: z.string() },
    async ({ bundleId }) => {
        try {
            await coordinator.wda.activateApp(bundleId);
            return { content: [{ type: 'text', text: `Activated ${bundleId}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Activate failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_terminate_app',
    'Force-terminate an app via WDA',
    { bundleId: z.string() },
    async ({ bundleId }) => {
        try {
            await coordinator.wda.terminateApp(bundleId);
            return { content: [{ type: 'text', text: `Terminated ${bundleId}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Terminate failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_press_home',
    'Press the Home button via WDA (return to SpringBoard)',
    {},
    async () => {
        try {
            await coordinator.wda.pressHome();
            return { content: [{ type: 'text', text: 'Home pressed' }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Press home failed: ${msg}` }], isError: true };
        }
    },
);

// ---- WDA Screen ----
server.tool(
    'wda_screenshot',
    'Take a full-screen screenshot via WDA (returns base64 PNG)',
    {},
    async () => {
        try {
            const b64 = await coordinator.wda.getScreenshot();
            return { content: [{ type: 'text', text: `Screenshot captured (${b64.length} chars base64).\nData: ${b64.slice(0, 200)}...` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Screenshot failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_page_source',
    'Get the full Accessibility tree XML of the current screen via WDA',
    {},
    async () => {
        try {
            const source = await coordinator.wda.getPageSource();
            return { content: [{ type: 'text', text: source }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Page source failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'wda_device_info',
    'Get device info (model, OS version, etc.) from WDA',
    {},
    async () => {
        try {
            const info = await coordinator.wda.getDeviceInfo();
            return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Device info failed: ${msg}` }], isError: true };
        }
    },
);

// =========================================================================
// Coordinator — dual-engine tools
// =========================================================================

server.tool(
    'auto_status',
    'Show connection status of both engines (WhiteNeedle in-app + WDA system-level)',
    {},
    async () => {
        try {
            const s = await coordinator.status();
            return { content: [{ type: 'text', text: JSON.stringify(s, null, 2) }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Status check failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'auto_connect_all',
    'Connect to both WhiteNeedle and WDA simultaneously',
    {},
    async () => {
        try {
            const results = await coordinator.connectAll();
            const parts: string[] = [];
            parts.push(`WhiteNeedle: ${results.wn ? '✓ connected' : '✗ not available'}`);
            parts.push(`WDA: ${results.wda ? '✓ connected' : '✗ not available'}`);
            return { content: [{ type: 'text', text: parts.join('\n') }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Connect all failed: ${msg}` }], isError: true };
        }
    },
);

server.tool(
    'auto_tap',
    'Smart tap: routes to WhiteNeedle (in-app, fast) or WDA (system-level) automatically. Specify engine to force one.',
    {
        selector: z.string().describe('Text label / accessibility ID of the element to tap'),
        engine: z.enum(['auto', 'wn', 'wda']).default('auto').describe('Which engine: auto (smart pick), wn (in-app), wda (system)'),
    },
    async ({ selector, engine }) => {
        try {
            const result = await coordinator.tap(selector, { engine });
            return { content: [{ type: 'text', text: `Tapped "${selector}" via ${result.engine}${result.detail ? `: ${result.detail}` : ''}` }] };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `auto_tap failed: ${msg}` }], isError: true };
        }
    },
);

// ---- Installed JS modules ----
server.tool(
    'list_installed_modules',
    'List user-installed JS modules in Library/wn_installed_modules/',
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
    'Write a text file to the app sandbox (Library/ relative path)',
    {
        path: z.string().describe('Relative path under Library/, e.g. wn_installed_modules/utils.js'),
        content: z.string().describe('File content (UTF-8 text)'),
    },
    async ({ path, content }) => safeRpc('writeFile', { path, content }),
);

server.tool(
    'mkdir',
    'Create a directory in the app sandbox (Library/ relative path)',
    {
        path: z.string().describe('Relative path under Library/'),
    },
    async ({ path }) => safeRpc('mkdir', { path }),
);

server.tool(
    'remove_dir',
    'Remove a file or directory in the app sandbox (Library/ relative path)',
    {
        path: z.string().describe('Relative path under Library/'),
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

## Host MCP tools — WhiteNeedle (in-app engine)
Runtime exploration: connect, list_classes, get_methods, evaluate, load_script, unload_script, list_scripts, list_hooks, list_hooks_detailed, pause_hook, resume_hook, list_modules, trace_method, rpc_call, inspect_object, heap_search.

Network: list_network_requests, get_network_request, clear_network_requests, set_network_capture.

UI: get_view_hierarchy, get_view_controllers, get_vc_detail, get_view_detail, set_view_property, highlight_view, clear_highlight, search_views, search_views_by_text, get_screenshot.

Mock HTTP: list_mock_rules, add_mock_rule, update_mock_rule, remove_mock_rule, remove_all_mock_rules, enable_mock_interceptor, disable_mock_interceptor, get_mock_interceptor_status.

Context & Modules: reset_context, list_installed_modules.

Sandbox Files: write_file, mkdir, remove_dir.

## Host MCP tools — WDA (system-level engine)
Connection: wda_connect, wda_disconnect, wda_status.

Element interaction: wda_find_element, wda_find_elements, wda_tap, wda_type, wda_swipe.

System alerts: wda_accept_alert, wda_dismiss_alert, wda_get_alert_text.

App lifecycle: wda_launch_app, wda_activate_app, wda_terminate_app, wda_press_home.

Screen: wda_screenshot, wda_page_source, wda_device_info.

## Coordinator (dual-engine)
auto_status — show both engines' connection status.
auto_connect_all — connect to WhiteNeedle + WDA simultaneously.
auto_tap — smart tap that routes to the best engine automatically.

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
