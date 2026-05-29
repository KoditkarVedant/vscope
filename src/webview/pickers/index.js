// @ts-check
/// <reference lib="dom" />

import { filesUI } from './files/ui';

/**
 * Per-picker helpers passed from main.js into each UI. Each UI uses only the
 * subset it needs — keeping helpers in main.js avoids a parallel module tree
 * during this incremental migration.
 *
 * @typedef {Object} PickerUIHelpers
 * @property {(s: string) => string} escHtml
 * @property {(s: string, positions: number[]) => string} highlightChars
 * @property {(query: string, str: string) => number[]} fuzzyPositions
 * @property {(p: string) => string} basename
 * @property {(p: string) => string} dirPart
 * @property {(p: string) => string} extBadge
 */

/**
 * Visual contract for a picker on the webview side. The host yields items,
 * the PickerUI turns each item into a row at the requested index.
 *
 * @typedef {Object} PickerUI
 * @property {'files' | 'grep' | 'references'} id
 * @property {(row: HTMLElement, i: number, ctx: PickerUIRenderCtx) => void} buildRow
 */

/**
 * @typedef {Object} PickerUIRenderCtx
 * @property {any[]} items
 * @property {string} query
 * @property {PickerUIHelpers} helpers
 */

/** @type {Record<string, PickerUI>} */
export const pickerUIRegistry = {
    files: filesUI,
    // grep and references will join this registry in follow-up commits.
};
