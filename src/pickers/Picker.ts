/**
 * Host-side contract for a picker's result source. A picker yields chunks of
 * items in response to either the initial browse (empty query) or a typed query.
 *
 * The wire protocol (resultsReset/resultsAppend/resultsReplace) is owned by
 * SearchEngine — pickers stay focused on producing items.
 */
export interface PickerSource<Item> {
    readonly id: string;

    /**
     * Stream initial results when the picker opens with no query. Omit when
     * the picker has no browse mode (e.g. grep, which requires a query).
     */
    browse?(signal: AbortSignal): AsyncIterable<Item[]>;

    /**
     * Stream results for a non-empty query. Single-shot implementations yield
     * once; streaming implementations (like grep) yield as matches arrive.
     */
    query(value: string, signal: AbortSignal): AsyncIterable<Item[]>;
}
