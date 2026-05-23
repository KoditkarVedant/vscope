import { streamFiles } from './finders/files';
import { fuzzyFiles } from './finders/fuzzyFiles';
import { runGrep } from './finders/text';
import type { GrepMatch } from './messages';
import { logError } from './logger';
import type { PanelMode, ToWebviewMessage } from './messages';

export class SearchEngine {
    private _mode:        PanelMode;
    private _queryId      = 0;
    private _activeAbort: AbortController | null = null;
    private _references:  GrepMatch[] = [];

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void,
        initialMode: PanelMode
    ) {
        this._mode = initialMode;
    }

    get mode(): PanelMode { return this._mode; }

    startBrowse(): void {
        this._cancelActive();
        const ctrl = new AbortController();
        this._activeAbort = ctrl;
        const qid = ++this._queryId;

        this._post({ type: 'resultsReset', queryId: qid, mode: 'files', query: '', filtered: false, total: 0 });
        void this._streamBrowse(qid, ctrl.signal);
    }

    setMode(mode: PanelMode): void {
        this._mode = mode;
        this._cancelActive();

        if (mode === 'files') {
            this.startBrowse();
        } else if (mode === 'grep') {
            this._post({ type: 'resultsReset', queryId: ++this._queryId, mode: 'grep', query: '', filtered: false, total: 0 });
        }
        // 'references' mode is initialized by loadReferences() — no reset here.
    }

    /**
     * Show the loading spinner before the (async) LSP call begins.
     */
    beginReferencesLoading(): void {
        const qid = ++this._queryId;
        this._post({ type: 'resultsReset', queryId: qid, mode: 'references', query: '', filtered: true, total: 0 });
    }

    /**
     * Populate the in-memory references list and display it. Called once per panel,
     * after LSP returns. Subsequent queries filter this list client-side.
     */
    loadReferences(matches: GrepMatch[]): void {
        this._references = matches;
        const qid = ++this._queryId;
        this._post({ type: 'resultsReset', queryId: qid, mode: 'references', query: '', filtered: false, total: matches.length });
        if (matches.length > 0) {
            this._post({ type: 'resultsAppend', queryId: qid, mode: 'references', items: matches, total: matches.length });
        }
        this._post({ type: 'resultsDone', queryId: qid });
    }

    async handleQuery(value: string): Promise<void> {
        this._cancelActive();
        const ctrl = new AbortController();
        this._activeAbort = ctrl;
        const { signal } = ctrl;
        const qid = ++this._queryId;

        if (this._mode === 'grep') {
            await this._runGrep(value, qid, signal);
            return;
        }

        if (this._mode === 'references') {
            this._filterReferences(value, qid);
            return;
        }

        if (!value.trim()) {
            void this._streamBrowse(qid, signal);
            return;
        }

        await this._runFuzzyFiles(value, qid, signal);
    }

    cancelPending(): void {
        this._cancelActive();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _cancelActive(): void {
        this._activeAbort?.abort();
        this._activeAbort = null;
    }

    private async _streamBrowse(qid: number, signal: AbortSignal): Promise<void> {
        this._post({ type: 'resultsReset', queryId: qid, mode: 'files', query: '', filtered: false, total: 0 });
        let total = 0;
        try {
            for await (const chunk of streamFiles(this._workspaceRoot, signal)) {
                if (signal.aborted || qid !== this._queryId) return;
                total += chunk.length;
                this._post({ type: 'resultsAppend', queryId: qid, mode: 'files', items: chunk, total });
            }
        } catch (err) {
            logError('streamBrowse', err);
        }
    }

    private async _runFuzzyFiles(value: string, qid: number, signal: AbortSignal): Promise<void> {
        this._post({ type: 'resultsLoading', queryId: qid, query: value });

        const items = await fuzzyFiles(this._workspaceRoot, value, signal);
        if (signal.aborted || qid !== this._queryId) return;

        this._post({ type: 'resultsReplace', queryId: qid, mode: 'files', items, total: items.length });
    }

    private _filterReferences(value: string, qid: number): void {
        // Webview gates resultsReplace on queryId matching its lastQueryId; emit
        // resultsLoading first so the qid lands before the replace arrives.
        this._post({ type: 'resultsLoading', queryId: qid, query: value });
        const total = this._references.length;
        const items = value
            ? this._references.filter((m) => fuzzyMatch(value, `${m.file}:${m.text}`))
            : this._references;
        this._post({
            type: 'resultsReplace',
            queryId: qid,
            mode: 'references',
            items,
            total,
        });
    }

    private async _runGrep(value: string, qid: number, signal: AbortSignal): Promise<void> {
        this._post({ type: 'resultsReset', queryId: qid, mode: 'grep', query: value, filtered: !!value, total: 0 });
        if (!value) return;

        try {
            let total = 0;
            for await (const matches of runGrep(value, this._workspaceRoot, signal)) {
                if (signal.aborted || qid !== this._queryId) return;
                total += matches.length;
                this._post({ type: 'resultsAppend', queryId: qid, mode: 'grep', items: matches, total });
            }
        } catch (err) {
            logError('runGrep', err);
        } finally {
            if (!signal.aborted && qid === this._queryId) {
                this._post({ type: 'resultsDone', queryId: qid });
            }
        }
    }
}

// Subsequence match — characters of needle must appear in haystack in order
// (case-insensitive). Same ranking signal users get from fzf without spawning a process.
function fuzzyMatch(needle: string, haystack: string): boolean {
    const n = needle.toLowerCase();
    const h = haystack.toLowerCase();
    let i = 0;
    for (let j = 0; j < h.length && i < n.length; j++) {
        if (h[j] === n[i]) i++;
    }
    return i === n.length;
}
