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
 * Hide team snippets when local custom uses the same id (local wins).
 */
export function hideTeamOverriddenByCustom(
    team: ScriptSnippet[],
    custom: ScriptSnippet[],
): { teamSnippets: ScriptSnippet[]; warnings: string[] } {
    const warnings: string[] = [];
    const customIds = new Set(custom.map(c => c.id));
    let overridden = 0;
    const teamVisible = team.filter((t) => {
        if (customIds.has(t.id)) {
            overridden++;
            return false;
        }
        return true;
    });
    if (overridden > 0) {
        warnings.push(
            `${overridden} team snippet(s) hidden: same id exists in local custom snippets (local wins)`,
        );
    }
    return { teamSnippets: teamVisible, warnings };
}

/**
 * Built-in + team (visible) + custom, for the snippet panel.
 */
export function mergeDisplaySnippets(
    builtin: ScriptSnippet[],
    teamRaw: ScriptSnippet[],
    custom: ScriptSnippet[],
): { snippets: ScriptSnippet[]; warnings: string[] } {
    const w1 = hideTeamOverriddenByCustom(teamRaw, custom);
    return {
        snippets: [...builtin, ...w1.teamSnippets, ...custom],
        warnings: w1.warnings,
    };
}
