// @ts-expect-error - JS module with JSDoc types, no .d.ts shipped
import { referencesUI as referencesUIRaw } from '../webview/pickers/references/ui.js';
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

interface RefMatch {
    file: string;
    line: number;
    col: number;
    length: number;
    text: string;
}

interface FilterResult {
    items: RefMatch[];
    positions?: number[][];
    query: string;
}

const referencesUI = referencesUIRaw as {
    filter(query: string, all: RefMatch[], prev: { query: string; items: RefMatch[] }): FilterResult;
};

function mk(file: string, line: number, text: string): RefMatch {
    return { file, line, col: 1, length: 0, text };
}

const SNAPSHOT: RefMatch[] = [
    mk('src/extension.ts',                10, 'export function activate() {}'),
    mk('src/pickers/files/host.ts',       12, 'export function createFilesPicker() {}'),
    mk('src/pickers/grep/host.ts',         8, 'export function createGrepPicker() {}'),
    mk('src/pickers/references/host.ts',   9, 'export function createReferencesPicker() {}'),
    mk('src/finders/text.ts',             10, 'export async function* runGrep() {}'),
    mk('src/finders/files.ts',             7, 'export async function* streamFiles() {}'),
    mk('src/SearchEngine.ts',             45, 'async runReferences(ctx) {}'),
];

const EMPTY_PREV = { query: '', items: [] as RefMatch[] };

describe('referencesUI.filter - degenerate inputs', () => {
    test('empty query returns the full snapshot in original order', () => {
        const r = referencesUI.filter('', SNAPSHOT, EMPTY_PREV);
        assert.equal(r.items.length, SNAPSHOT.length);
        for (let i = 0; i < SNAPSHOT.length; i++) {
            assert.equal(r.items[i], SNAPSHOT[i], `item ${i} changed identity`);
        }
        assert.equal(r.query, '');
    });

    test('empty query produces no positions', () => {
        const r = referencesUI.filter('', SNAPSHOT, EMPTY_PREV);
        // Either positions is undefined, empty array, or omitted entirely — all fine.
        assert.ok(!r.positions || r.positions.length === 0, 'expected no positions');
    });

    test('query with no possible matches returns an empty list', () => {
        const r = referencesUI.filter('zzqxw', SNAPSHOT, EMPTY_PREV);
        assert.equal(r.items.length, 0);
        assert.equal(r.query, 'zzqxw');
    });

    test('returned query field echoes the input query', () => {
        const r = referencesUI.filter('runGrep', SNAPSHOT, EMPTY_PREV);
        assert.equal(r.query, 'runGrep');
    });
});

describe('referencesUI.filter - match correctness', () => {
    test('only items whose `file:text` haystack matches as a subsequence are kept', () => {
        const r = referencesUI.filter('createGrep', SNAPSHOT, EMPTY_PREV);
        assert.ok(r.items.length >= 1, 'expected at least one match');
        for (const m of r.items) {
            const hay = `${m.file}:${m.text}`.toLowerCase();
            let j = 0;
            for (const ch of 'creategrep') {
                j = hay.indexOf(ch, j);
                assert.notEqual(j, -1, `char "${ch}" not in haystack "${hay}"`);
                j++;
            }
        }
    });

    test('positions array is aligned with items: length matches and each entry has needle.length chars', () => {
        const query = 'host';
        const r = referencesUI.filter(query, SNAPSHOT, EMPTY_PREV);
        assert.ok(r.positions, 'expected positions');
        assert.equal(r.positions!.length, r.items.length);
        for (let i = 0; i < r.items.length; i++) {
            const haystack = `${r.items[i].file}:${r.items[i].text}`;
            const positions: number[] = r.positions![i];
            assert.equal(positions.length, query.length, `row ${i}: position count != needle length`);
            // Strictly increasing.
            for (let k = 1; k < positions.length; k++) {
                assert.ok(positions[k] > positions[k - 1], 'positions not strictly increasing');
            }
            // Characters at the reported positions spell the needle (case-insensitive).
            const spelled = positions.map((p) => haystack[p].toLowerCase()).join('');
            assert.equal(spelled, query.toLowerCase());
        }
    });

    test('results are sorted by descending score (best matches first)', () => {
        // 'host' is a stronger match against /host.ts paths than against accidental hits.
        // We don't assert the exact ranking, just that the strongest hit (a host.ts file)
        // comes out before any non-host.ts hit.
        const r = referencesUI.filter('host', SNAPSHOT, EMPTY_PREV);
        const firstNonHost = r.items.findIndex((m) => !m.file.includes('/host.ts'));
        const lastHost     = r.items.map((m, i) => [m, i] as const)
            .filter(([m]) => m.file.includes('/host.ts'))
            .map(([, i]) => i)
            .pop();
        if (firstNonHost !== -1 && lastHost !== undefined) {
            assert.ok(lastHost < firstNonHost, 'expected all host.ts matches to rank above non-host.ts');
        }
    });
});

describe('referencesUI.filter - prefix narrowing', () => {
    test('returned items match what a fresh filter against the full snapshot returns', () => {
        // First keystroke
        const r1 = referencesUI.filter('cre', SNAPSHOT, EMPTY_PREV);
        // Second keystroke — extends the first
        const narrowed = referencesUI.filter('creat', r1.items, { query: r1.query, items: r1.items });
        const fresh    = referencesUI.filter('creat', SNAPSHOT, EMPTY_PREV);

        assert.equal(narrowed.items.length, fresh.items.length, 'item count diverged');
        const narrowedFiles = narrowed.items.map((m) => m.file).sort();
        const freshFiles    = fresh.items.map((m) => m.file).sort();
        assert.deepEqual(narrowedFiles, freshFiles, 'item identities diverged');
    });

    test('extending query reuses identity of items from prev (proves the fast path ran)', () => {
        const r1 = referencesUI.filter('cre', SNAPSHOT, EMPTY_PREV);
        // Hand prev a sentinel array we control — the fast path should pull items from
        // it (extending=true), not from the unrelated `all` we pass.
        const irrelevantAll: RefMatch[] = [];
        const narrowed = referencesUI.filter('creat', irrelevantAll, { query: 'cre', items: r1.items });
        // Every returned item must have come from r1.items, not from `irrelevantAll`
        // (which is empty and would yield zero matches if it were the source).
        for (const m of narrowed.items) {
            assert.ok(r1.items.includes(m), 'narrowed item not from prev.items');
        }
        assert.ok(narrowed.items.length > 0, 'expected non-empty result via prefix narrowing');
    });

    test('non-extending query falls back to the full snapshot', () => {
        // prev was filtering for 'cre'; new query 'runGrep' does not start with 'cre'.
        const r1 = referencesUI.filter('cre', SNAPSHOT, EMPTY_PREV);
        const switched = referencesUI.filter('runGrep', SNAPSHOT, { query: 'cre', items: r1.items });
        const fresh    = referencesUI.filter('runGrep', SNAPSHOT, EMPTY_PREV);
        assert.equal(switched.items.length, fresh.items.length, 'fallback produced wrong count');
        // The runGrep matches probably wouldn't survive the 'cre'-narrowed list — that's
        // the bug we're guarding against (silently dropping matches when user backspaces
        // and types something different).
        assert.ok(switched.items.some((m) => m.file === 'src/finders/text.ts'),
            'expected runGrep match from text.ts');
    });

    test('case-insensitive prefix detection', () => {
        const r1 = referencesUI.filter('Cre', SNAPSHOT, EMPTY_PREV);
        const narrowed = referencesUI.filter('CREAT', [], { query: 'Cre', items: r1.items });
        // If prefix detection were case-sensitive, 'CREAT' would not extend 'Cre' and
        // the filter would fall back to `all` (empty), producing zero matches.
        assert.ok(narrowed.items.length > 0, 'expected case-insensitive prefix narrowing');
    });
});
