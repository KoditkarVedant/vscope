// @ts-check
/// <reference lib="dom" />

import { fzyMatch } from '../../../algos/fzy';

/** @typedef {import('../index').PickerUI} PickerUI */

/**
 * Distribute haystack-space match positions onto the three displayed spans of
 * a references row: basename (loc), visible text, and dir.
 *
 * @param {number[]} positions
 * @param {{ file: string, text: string }} m
 */
function splitRefDisplayPositions(positions, m) {
    if (!positions || !positions.length) return { loc: [], text: [], dir: [] };
    const nameStart = m.file.lastIndexOf('/') + 1;
    const fileLen = m.file.length;
    const textStart = fileLen + 1; // skip the ':' separator
    const visibleText = m.text.trimStart();
    const trimOffset = m.text.length - visibleText.length;

    const loc = [];
    const text = [];
    const dir = [];
    for (const p of positions) {
        if (p < nameStart) {
            // Drop the path separator at nameStart-1 — not part of the dir span.
            if (p < nameStart - 1) dir.push(p);
        } else if (p < fileLen) {
            loc.push(p - nameStart);
        } else if (p > fileLen) {
            const tp = p - textStart - trimOffset;
            if (tp >= 0 && tp < visibleText.length) text.push(tp);
        }
    }
    return { loc, text, dir };
}

/** @type {PickerUI} */
export const referencesUI = {
    id: 'references',

    /**
     * In-webview filter against the full snapshot. Returns the matched items
     * plus aligned per-item positions. Implements prefix-narrowing: if the new
     * query extends the previous one, we filter against the already-narrowed
     * list instead of re-scanning the snapshot.
     *
     * @param {string} query
     * @param {any[]} all
     * @param {{ query: string, items: any[] }} prev
     * @returns {{ items: any[], positions: number[][], query: string }}
     */
    filter(query, all, prev) {
        if (!query) {
            return { items: all.slice(), positions: [], query: '' };
        }
        const extending = prev.query && query.toLowerCase().startsWith(prev.query.toLowerCase());
        const source = extending ? prev.items : all;
        const scored = [];
        for (const m of source) {
            const r = fzyMatch(query, `${m.file}:${m.text}`);
            if (r.matched) scored.push({ m, score: r.score, positions: r.positions });
        }
        scored.sort((a, b) => b.score - a.score);
        return {
            items: scored.map((s) => s.m),
            positions: scored.map((s) => s.positions),
            query,
        };
    },

    buildRow(row, i, ctx) {
        const { items, helpers } = ctx;
        const positions = /** @type {number[][] | null} */ (ctx.meta);
        const m = items[i];
        const refPos = splitRefDisplayPositions(positions?.[i] ?? [], m);

        const loc = document.createElement('span');
        loc.className = 'grep-loc';
        loc.innerHTML = helpers.highlightChars(`${helpers.basename(m.file)}:${m.line}`, refPos.loc);
        row.appendChild(loc);

        const visibleText = m.text.trimStart();
        const text = document.createElement('span');
        text.className = 'grep-text';
        text.innerHTML = helpers.highlightChars(visibleText, refPos.text);
        row.appendChild(text);

        const dir = helpers.dirPart(m.file);
        if (dir) {
            const d = document.createElement('span');
            d.className = 'file-dir';
            d.innerHTML = helpers.highlightChars(dir, refPos.dir);
            row.appendChild(d);
        }
    },
};
