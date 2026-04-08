import { describe, expect, it } from 'vitest';
import { orderTargetsForQuickPick } from '../debugging/targetPicker';
import type { InspectorTarget } from '../debugging/webKitProxy';

function t(partial: Partial<InspectorTarget> & { title: string }): InspectorTarget {
    return {
        devtoolsFrontendUrl: '',
        faviconUrl: '',
        thumbnailUrl: '',
        title: partial.title,
        url: partial.url ?? '',
        webSocketDebuggerUrl: partial.webSocketDebuggerUrl ?? 'ws://127.0.0.1:9222/devtools/page/1',
        appId: partial.appId,
    };
}

describe('orderTargetsForQuickPick', () => {
    it('puts preferred title first when multiple targets', () => {
        const targets = [
            t({ title: 'WN WKWebView Test', url: 'about:blank', webSocketDebuggerUrl: 'ws://x/page/2' }),
            t({ title: 'WhiteNeedle', webSocketDebuggerUrl: 'ws://x/page/1' }),
        ];
        const ordered = orderTargetsForQuickPick(targets, 'WhiteNeedle');
        expect(ordered.map((x) => x.title)).toEqual(['WhiteNeedle', 'WN WKWebView Test']);
    });

    it('leaves order unchanged when no preferred title', () => {
        const targets = [
            t({ title: 'A' }),
            t({ title: 'B' }),
        ];
        expect(orderTargetsForQuickPick(targets)).toEqual(targets);
    });

    it('is stable for non-matching preferred title', () => {
        const targets = [t({ title: 'A' }), t({ title: 'B' })];
        const ordered = orderTargetsForQuickPick(targets, 'Z');
        expect(ordered.map((x) => x.title)).toEqual(['A', 'B']);
    });
});
