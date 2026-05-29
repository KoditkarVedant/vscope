/**
 * Host-side contract for a picker's result source. A picker may expose any
 * combination of three production modes:
 *
 *  - `browse` streams initial results when the picker opens with no query
 *    (files mode walks the workspace).
 *  - `query` streams results for a typed value (files filters via fzf, grep
 *    runs ripgrep).
 *  - `load`  produces a one-shot snapshot from an external context such as
 *    the LSP (references loads once, then the webview filters in-memory).
 *
 * The wire protocol (resultsReset/resultsAppend/resultsReplace) is owned by
 * SearchEngine — pickers stay focused on producing items.
 */
export interface PickerSource<Item, LoadCtx = void> {
    readonly id: string;

    browse?(signal: AbortSignal): AsyncIterable<Item[]>;

    query?(value: string, signal: AbortSignal): AsyncIterable<Item[]>;

    load?(ctx: LoadCtx, signal: AbortSignal): Promise<Item[]>;
}
