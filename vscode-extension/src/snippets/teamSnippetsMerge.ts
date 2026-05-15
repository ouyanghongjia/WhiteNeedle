import type { ScriptSnippet } from './snippetLibrary';

/**
 * Combine team JSON files: skip ids that conflict with built-in, dedupe by id across files (first wins).
 */
export function combineTeamFiles(
    builtin: ScriptSnippet[],
    teamByFile: ScriptSnippet[][],
): { teamSnippets: ScriptSnippet[]; warnings: string[] } {
    const warnings: string[] = [];
    const builtinIds = new Set(builtin.map(s => s.id));
    const seenTeamIds = new Set<string>();
    const teamOut: ScriptSnippet[] = [];

    for (const fileSnippets of teamByFile) {
        for (const s of fileSnippets) {
            if (builtinIds.has(s.id)) {
                warnings.push(
                    `Skipped team snippet "${s.name}" (id: ${s.id}): conflicts with built-in`,
                );
                continue;
            }
            if (seenTeamIds.has(s.id)) {
                warnings.push(
                    `Skipped duplicate team snippet id "${s.id}" (${s.name}) from a later workspace file`,
                );
                continue;
            }
            seenTeamIds.add(s.id);
            teamOut.push(s);
        }
    }

    return { teamSnippets: teamOut, warnings };
}

/**
 * Hide lower-priority snippets when a higher-priority source uses the same id.
 */
function hideOverriddenSnippets(
    lower: ScriptSnippet[],
    higherIds: Set<string>,
): ScriptSnippet[] {
    return lower.filter((s) => !higherIds.has(s.id));
}

/**
 * Built-in + team (visible) + personal (visible) + custom, for the snippet panel.
 * Priority: custom > personal > team > builtin (higher overrides lower on same id).
 */
export function mergeDisplaySnippets(
    builtin: ScriptSnippet[],
    teamRaw: ScriptSnippet[],
    personalRaw: ScriptSnippet[],
    custom: ScriptSnippet[],
): { snippets: ScriptSnippet[]; warnings: string[] } {
    const warnings: string[] = [];
    const customIds = new Set(custom.map(c => c.id));
    const personalIds = new Set(personalRaw.map(p => p.id));

    const teamVisible = hideOverriddenSnippets(teamRaw, new Set([...customIds, ...personalIds]));
    const personalVisible = hideOverriddenSnippets(personalRaw, customIds);

    const hiddenTeam = teamRaw.length - teamVisible.length;
    const hiddenPersonal = personalRaw.length - personalVisible.length;
    if (hiddenTeam > 0) {
        warnings.push(`${hiddenTeam} team snippet(s) hidden: same id exists in personal/custom snippets`);
    }
    if (hiddenPersonal > 0) {
        warnings.push(`${hiddenPersonal} personal snippet(s) hidden: same id exists in custom snippets`);
    }

    return {
        snippets: [...builtin, ...teamVisible, ...personalVisible, ...custom],
        warnings,
    };
}

/** @deprecated Use the 4-arg mergeDisplaySnippets. */
export function hideTeamOverriddenByCustom(
    team: ScriptSnippet[],
    custom: ScriptSnippet[],
): { teamSnippets: ScriptSnippet[]; warnings: string[] } {
    const customIds = new Set(custom.map(c => c.id));
    const teamVisible = hideOverriddenSnippets(team, customIds);
    const overridden = team.length - teamVisible.length;
    const warnings: string[] = [];
    if (overridden > 0) {
        warnings.push(`${overridden} team snippet(s) hidden: same id exists in local custom snippets (local wins)`);
    }
    return { teamSnippets: teamVisible, warnings };
}
