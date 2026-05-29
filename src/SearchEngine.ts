import { runGrep } from './finders/text';
import type { GrepMatch } from './messages';
import { logError } from './logger';
import type { PanelMode, ToWebviewMessage } from './messages';
import { createPickerRegistry, type PickerRegistry } from './pickers';

export class SearchEngine {
    private _mode:        PanelMode;
    private _queryId      = 0;
    private _activeAbort: AbortController | null = null;
    private readonly _registry: PickerRegistry;

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void,
        initialMode: PanelMode
    ) {
        this._mode = initialMode;
        this._registry = createPickerRegistry(_workspaceRoot);
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
     * Stream the references snapshot to the webview, which owns the per-keystroke
     * filter from this point on. The host stays out of the loop until the panel closes.
     */
    loadReferences(matches: GrepMatch[]): void {
        const qid = ++this._queryId;
        this._post({ type: 'resultsReset', queryId: qid, mode: 'references', query: '', filtered: false, total: matches.length });
        if (matches.length > 0) {
            this._post({ type: 'resultsAppend', queryId: qid, mode: 'references', items: matches, total: matches.length });
        }
        this._post({ type: 'resultsDone', queryId: qid });
    }

    async handleQuery(value: string): Promise<void> {
        // References mode filters in the webview against an in-memory snapshot —
        // matches the architecture of telescope.nvim and code-telescope. No host work.
        if (this._mode === 'references') return;

        this._cancelActive();
        const ctrl = new AbortController();
        this._activeAbort = ctrl;
        const { signal } = ctrl;
        const qid = ++this._queryId;

        if (this._mode === 'grep') {
            await this._runGrep(value, qid, signal);
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
        const source = this._registry.files;
        if (!source.browse) return;
        let total = 0;
        try {
            for await (const chunk of source.browse(signal)) {
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

        let items: string[] = [];
        try {
            for await (const chunk of this._registry.files.query(value, signal)) {
                if (signal.aborted || qid !== this._queryId) return;
                items = chunk;
            }
        } catch (err) {
            logError('runFuzzyFiles', err);
            return;
        }
        if (signal.aborted || qid !== this._queryId) return;

        this._post({ type: 'resultsReplace', queryId: qid, mode: 'files', items, total: items.length });
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
