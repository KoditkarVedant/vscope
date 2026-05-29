// @ts-check
/// <reference lib="dom" />

/** @typedef {import('../index').PickerUI} PickerUI */

/** @type {PickerUI} */
export const filesUI = {
    id: 'files',
    buildRow(row, i, ctx) {
        const { items, query, helpers } = ctx;
        const file = /** @type {string} */ (items[i]);

        const ext = helpers.extBadge(file);
        if (ext) {
            const badge = document.createElement('span');
            badge.className = 'ext-badge';
            badge.textContent = ext;
            row.appendChild(badge);
        }

        const positions = helpers.fuzzyPositions(query, file);
        const nameStart = file.lastIndexOf('/') + 1;
        const namePosns = positions.filter((p) => p >= nameStart).map((p) => p - nameStart);
        const dirPosns  = positions.filter((p) => p < nameStart);

        const name = document.createElement('span');
        name.className = 'file-name';
        name.innerHTML = helpers.highlightChars(helpers.basename(file), namePosns);
        row.appendChild(name);

        const dir = helpers.dirPart(file);
        if (dir) {
            const d = document.createElement('span');
            d.className = 'file-dir';
            d.innerHTML = helpers.highlightChars(dir, dirPosns);
            row.appendChild(d);
        }
    },
};
