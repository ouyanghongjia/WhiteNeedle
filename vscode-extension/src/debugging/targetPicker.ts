import type { InspectorTarget } from './webKitProxy';

/**
 * When several Inspector targets exist (e.g. JSContext "WhiteNeedle" + WKWebView),
 * we must not auto-pick by `targetTitle` — that would always select the first title
 * match (usually JSContext) and skip the QuickPick entirely.
 *
 * `preferredTitle` only affects sort order: matching titles appear first in the picker.
 */
export function orderTargetsForQuickPick(
    targets: InspectorTarget[],
    preferredTitle?: string
): InspectorTarget[] {
    const pref = preferredTitle?.trim().toLowerCase();
    if (!pref) {
        return [...targets];
    }
    return [...targets].sort((a, b) => {
        const aPref = (a.title || '').toLowerCase() === pref ? 0 : 1;
        const bPref = (b.title || '').toLowerCase() === pref ? 0 : 1;
        if (aPref !== bPref) {
            return aPref - bPref;
        }
        return 0;
    });
}
