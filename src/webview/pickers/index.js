// @ts-check
/// <reference lib="dom" />

import { filesUI } from './files/ui';
import { grepUI } from './grep/ui';
import { referencesUI } from './references/ui';

/**
 * Per-picker helpers passed from main.js into each UI. Each UI uses only the
 * subset it needs — keeping helpers in main.js avoids a parallel module tree
 * during this incremental migration.
 *
 * @typedef {Object} PickerUIHelpers
 * @property {(s: string) => string} escHtml
 * @property {(s: string, positions: number[]) => string} highlightChars
 * @property {(s: string, query: string) => string} highlightSubstring
 * @property {(query: string, str: string) => number[]} fuzzyPositions
 * @property {(p: string) => string} basename
 * @property {(p: string) => string} dirPart
 * @property {(p: string) => string} extBadge
 */

/**
 * Visual contract for a picker on the webview side. The host yields items,
 * the PickerUI turns each item into a row at the requested index. Optional
 * `filter` keeps per-keystroke work entirely in the webview when the host
 * has already shipped a full snapshot (references mode).
 *
 * @typedef {Object} PickerUI
 * @property {'files' | 'grep' | 'references'} id
 * @property {(row: HTMLElement, i: number, ctx: PickerUIRenderCtx) => void} buildRow
 * @property {(query: string, all: any[], prev: { query: string, items: any[] }) => { items: any[], positions?: number[][], query: string }} [filter]
 */

/**
 * @typedef {Object} PickerUIRenderCtx
 * @property {any[]} items
 * @property {string} query
 * @property {PickerUIHelpers} helpers
 * @property {any} [meta] Picker-specific per-render data (e.g. references positions).
 */

/** @type {Record<string, PickerUI>} */
export const pickerUIRegistry = {
    files:      filesUI,
    grep:       grepUI,
    references: referencesUI,
};
