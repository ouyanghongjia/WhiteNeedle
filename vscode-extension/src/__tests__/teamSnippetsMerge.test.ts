import { describe, it, expect } from 'vitest';
import {
    combineTeamFiles,
    hideTeamOverriddenByCustom,
    mergeDisplaySnippets,
} from '../snippets/teamSnippetsMerge';
import type { ScriptSnippet } from '../snippets/snippetLibrary';

const b = (id: string): ScriptSnippet => ({
    id,
    name: id,
    category: 'utility',
    description: '',
    tags: [],
    code: '//builtin',
});

const t = (id: string): ScriptSnippet => ({
    id,
    name: id,
    category: 'utility',
    description: '',
    tags: ['team'],
    code: '//team',
});

describe('teamSnippetsMerge', () => {
    describe('combineTeamFiles', () => {
        it('drops team snippets whose id matches built-in', () => {
            const builtin = [b('hook-x')];
            const { teamSnippets, warnings } = combineTeamFiles(builtin, [[t('hook-x'), t('team-only')]]);
            expect(teamSnippets.map(s => s.id)).toEqual(['team-only']);
            expect(warnings.some(w => w.includes('hook-x'))).toBe(true);
        });

        it('dedupes duplicate ids across files (first wins)', () => {
            const builtin: ScriptSnippet[] = [];
            const { teamSnippets, warnings } = combineTeamFiles(builtin, [
                [t('a'), t('b')],
                [t('a'), t('c')],
            ]);
            expect(teamSnippets.map(s => s.id)).toEqual(['a', 'b', 'c']);
            expect(warnings.some(w => w.includes('duplicate'))).toBe(true);
        });
    });

    describe('hideTeamOverriddenByCustom', () => {
        it('removes team entries when custom has same id', () => {
            const { teamSnippets, warnings } = hideTeamOverriddenByCustom(
                [t('shared'), t('team-only')],
                [b('shared')],
            );
            expect(teamSnippets.map(s => s.id)).toEqual(['team-only']);
            expect(warnings.length).toBe(1);
        });
    });

    describe('mergeDisplaySnippets', () => {
        it('orders builtin then visible team then custom', () => {
            const builtin = [b('bi')];
            const teamRaw = [t('t1')];
            const custom = [b('c1')];
            const { snippets } = mergeDisplaySnippets(builtin, teamRaw, custom);
            expect(snippets.map(s => s.id)).toEqual(['bi', 't1', 'c1']);
        });
    });
});
