// @ts-check
/// <reference lib="dom" />

/** @typedef {import('../index').PickerUI} PickerUI */

/** @type {PickerUI} */
export const grepUI = {
    id: 'grep',
    buildRow(row, i, ctx) {
        const { items, query, helpers } = ctx;
        const m = items[i];

        const loc = document.createElement('span');
        loc.className = 'grep-loc';
        loc.textContent = `${helpers.basename(m.file)}:${m.line}`;
        row.appendChild(loc);

        const visibleText = m.text.trimStart();
        const text = document.createElement('span');
        text.className = 'grep-text';
        text.innerHTML = helpers.highlightSubstring(visibleText, query);
        row.appendChild(text);

        const dir = helpers.dirPart(m.file);
        if (dir) {
            const d = document.createElement('span');
            d.className = 'file-dir';
            d.textContent = dir;
            row.appendChild(d);
        }
    },
};
