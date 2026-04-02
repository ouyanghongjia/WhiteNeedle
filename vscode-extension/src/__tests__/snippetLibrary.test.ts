import { describe, it, expect } from 'vitest';
import {
    BUILTIN_SNIPPETS,
    CATEGORY_LABELS,
    resolveSnippet,
    searchSnippets,
    type SnippetCategory,
} from '../snippets/snippetLibrary';

describe('snippetLibrary', () => {
    describe('BUILTIN_SNIPPETS', () => {
        it('has at least 5 snippets', () => {
            expect(BUILTIN_SNIPPETS.length).toBeGreaterThanOrEqual(5);
        });

        it('every snippet has required fields', () => {
            for (const s of BUILTIN_SNIPPETS) {
                expect(s.id).toBeTruthy();
                expect(s.name).toBeTruthy();
                expect(s.category).toBeTruthy();
                expect(s.description).toBeTruthy();
                expect(s.code).toBeTruthy();
                expect(Array.isArray(s.tags)).toBe(true);
            }
        });

        it('all snippet IDs are unique', () => {
            const ids = BUILTIN_SNIPPETS.map(s => s.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('all categories have labels', () => {
            const usedCategories = new Set(BUILTIN_SNIPPETS.map(s => s.category));
            for (const cat of usedCategories) {
                expect(CATEGORY_LABELS[cat as SnippetCategory]).toBeTruthy();
            }
        });

        it('snippets with params have valid param definitions', () => {
            for (const s of BUILTIN_SNIPPETS) {
                if (s.params && s.params.length > 0) {
                    for (const p of s.params) {
                        expect(p.name).toBeTruthy();
                        expect(p.placeholder).toBeTruthy();
                        expect(p.description).toBeTruthy();
                        expect(s.code).toContain(`{{${p.name}}}`);
                    }
                }
            }
        });
    });

    describe('resolveSnippet', () => {
        it('replaces single parameter', () => {
            const snippet = BUILTIN_SNIPPETS.find(s => s.id === 'hook-method-basic')!;
            const code = resolveSnippet(snippet, { SELECTOR: '-[UIView setFrame:]' });
            expect(code).toContain('-[UIView setFrame:]');
            expect(code).not.toContain('{{SELECTOR}}');
        });

        it('replaces multiple parameters', () => {
            const snippet = BUILTIN_SNIPPETS.find(s => s.id === 'hook-replace-retval')!;
            const code = resolveSnippet(snippet, {
                SELECTOR: '-[MyClass isVIP]',
                NEW_VALUE: 'true',
            });
            expect(code).toContain('-[MyClass isVIP]');
            expect(code).toContain('true');
            expect(code).not.toContain('{{SELECTOR}}');
            expect(code).not.toContain('{{NEW_VALUE}}');
        });

        it('leaves code unchanged with empty params', () => {
            const snippet = BUILTIN_SNIPPETS.find(s => !s.params || s.params.length === 0)!;
            const original = snippet.code;
            const code = resolveSnippet(snippet, {});
            expect(code).toBe(original);
        });

        it('replaces all occurrences of the same param', () => {
            const snippet = BUILTIN_SNIPPETS.find(s => s.id === 'hook-method-basic')!;
            const code = resolveSnippet(snippet, { SELECTOR: 'testSel' });
            const count = code.split('testSel').length - 1;
            const templateCount = snippet.code.split('{{SELECTOR}}').length - 1;
            expect(count).toBe(templateCount);
        });
    });

    describe('searchSnippets', () => {
        it('finds snippets by name keyword', () => {
            const results = searchSnippets('hook');
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(s => s.category === 'hook')).toBe(true);
        });

        it('finds snippets by tag', () => {
            const results = searchSnippets('swizzle');
            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it('finds snippets by category', () => {
            const results = searchSnippets('network');
            expect(results.length).toBeGreaterThan(0);
            expect(results.every(s =>
                s.category === 'network' ||
                s.description.toLowerCase().includes('network') ||
                s.tags.some(t => t.includes('network'))
            )).toBe(true);
        });

        it('case insensitive search', () => {
            const results1 = searchSnippets('HOOK');
            const results2 = searchSnippets('hook');
            expect(results1.length).toBe(results2.length);
        });

        it('returns empty array for non-matching query', () => {
            const results = searchSnippets('zzzznonexistent');
            expect(results).toEqual([]);
        });

        it('returns snippets for empty query (matches everything)', () => {
            const results = searchSnippets('');
            expect(results.length).toBe(BUILTIN_SNIPPETS.length);
        });
    });
});
