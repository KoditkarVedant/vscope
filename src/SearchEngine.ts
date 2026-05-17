import { streamFiles } from './finders/files';
import { fuzzyFiles } from './finders/fuzzyFiles';
import { runGrep } from './finders/text';
import type { PanelMode, ToWebviewMessage } from './messages';

export class SearchEngine {
    private _mode:        PanelMode;
    private _queryId      = 0;
    private _activeAbort: AbortController | null = null;

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
        } else {
            this._post({ type: 'resultsReset', queryId: ++this._queryId, mode: 'grep', query: '', filtered: false, total: 0 });
        }
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
        } catch {
            // rg not available — findFiles fallback inside streamFiles handles it
        }
    }

    private async _runFuzzyFiles(value: string, qid: number, signal: AbortSignal): Promise<void> {
        this._post({ type: 'resultsLoading', queryId: qid, query: value });

        const items = await fuzzyFiles(this._workspaceRoot, value, signal);
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
        } catch {
            // rg errors handled silently
        }
    }
}
