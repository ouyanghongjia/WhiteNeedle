import { describe, expect, it } from 'vitest';
import { rewriteInspectorWebSocketToLoopback } from '../debugging/debugAdapter';

describe('rewriteInspectorWebSocketToLoopback', () => {
    it('preserves port from ios_webkit_debug_proxy target URL (multi-device)', () => {
        const u = rewriteInspectorWebSocketToLoopback(
            'ws://127.0.0.1:9223/devtools/page/2',
            9222
        );
        expect(u).toBe('ws://127.0.0.1:9223/devtools/page/2');
    });

    it('normalizes hostname to 127.0.0.1', () => {
        const u = rewriteInspectorWebSocketToLoopback(
            'ws://localhost:9223/devtools/page/1',
            9222
        );
        expect(u).toBe('ws://127.0.0.1:9223/devtools/page/1');
    });

    it('uses fallback port when URL has no port', () => {
        const u = rewriteInspectorWebSocketToLoopback('ws://localhost/devtools/page/1', 9222);
        expect(u).toBe('ws://127.0.0.1:9222/devtools/page/1');
    });
});
