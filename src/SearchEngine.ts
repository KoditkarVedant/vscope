import { chunkArray } from './finders/chunker';
import { streamFiles } from './finders/files';
import { runGrep } from './finders/text';
import { filterWithFzf } from './fzfProcess';
import type { PanelMode, ToWebviewMessage } from './messages';

const BROWSE_CHUNK_SIZE = 5000;

export class SearchEngine {
    private _files: string[] = [];
    private _filesLoaded = false;
    private _filesLoadAbort = new AbortController();
    private _currentQuery = '';
    private _queryId = 0;
    private _queryAbort: AbortController | null = null;
    private _mode: PanelMode;

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void,
        initialMode: PanelMode
    ) {
        this._mode = initialMode;
    }

    get mode(): PanelMode { return this._mode; }
    get files(): string[] { return this._files; }

    async loadFiles(): Promise<void> {
        const signal = this._filesLoadAbort.signal;
        if (this._mode === 'files' && !this._currentQuery) {
            this._post({
                type: 'resultsReset',
                queryId: this._queryId,
                mode: 'files',
                query: '',
                filtered: false,
                total: this._files.length,
            });
        }
        try {
            for await (const chunk of streamFiles(this._workspaceRoot, signal)) {
                if (signal.aborted) return;
                this._files.push(...chunk);
                // Only forward chunks if the user is currently looking at the browse view.
                // After a query+clear cycle, queryId advances; we attach to whatever's current.
                if (this._mode === 'files' && !this._currentQuery) {
                    this._post({
                        type: 'resultsAppend',
                        queryId: this._queryId,
                        mode: 'files',
                        items: chunk,
                        total: this._files.length,
                    });
                }
            }
        } finally {
            this._filesLoaded = true;
        }
    }

    setMode(mode: PanelMode): void {
        this._mode = mode;
        this._currentQuery = '';
        this._queryAbort?.abort();
        this._queryAbort = null;
        if (mode === 'files') {
            void this._startBrowse();
        } else {
            this._post({
                type: 'resultsReset',
                queryId: ++this._queryId,
                mode: 'grep',
                query: '',
                filtered: false,
                total: 0,
            });
        }
    }

    async handleQuery(value: string): Promise<void> {
        this._currentQuery = value;
        this._queryAbort?.abort();
        this._queryAbort = new AbortController();
        const signal = this._queryAbort.signal;
        const qid = ++this._queryId;

        if (this._mode === 'grep') {
            this._post({
                type: 'resultsReset',
                queryId: qid,
                mode: 'grep',
                query: value,
                filtered: !!value,
                total: 0,
            });
            if (!value) return;
            try {
                let total = 0;
                for await (const matches of runGrep(value, this._workspaceRoot, signal)) {
                    if (signal.aborted || qid !== this._queryId) return;
                    total += matches.length;
                    this._post({
                        type: 'resultsAppend',
                        queryId: qid,
                        mode: 'grep',
                        items: matches,
                        total,
                    });
                }
            } catch {
                // rg errors / aborts handled silently
            }
            return;
        }

        // files mode
        if (!value) {
            await this._startBrowse(qid);
            return;
        }

        this._post({
            type: 'resultsReset',
            queryId: qid,
            mode: 'files',
            query: value,
            filtered: true,
            total: this._files.length,
        });

        const results = await filterWithFzf(value, this._files, signal);
        if (signal.aborted || qid !== this._queryId) return;
        if (results.length > 0) {
            this._post({
                type: 'resultsAppend',
                queryId: qid,
                mode: 'files',
                items: results,
                total: this._files.length,
            });
        }
    }

    cancelPending(): void {
        this._queryAbort?.abort();
        this._queryAbort = null;
        this._filesLoadAbort.abort();
    }

    private async _startBrowse(reuseQid?: number): Promise<void> {
        const qid = reuseQid ?? ++this._queryId;
        const total = this._files.length;
        this._post({
            type: 'resultsReset',
            queryId: qid,
            mode: 'files',
            query: '',
            filtered: false,
            total,
        });
        if (total === 0) return;
        // Re-emit cached files via chunker so we yield to the event loop between chunks.
        // Keeps the webview responsive to key events while bursts of appends are processed.
        for await (const items of chunkArray(this._files, BROWSE_CHUNK_SIZE)) {
            if (qid !== this._queryId) return;
            this._post({
                type: 'resultsAppend',
                queryId: qid,
                mode: 'files',
                items,
                total,
            });
        }
    }
}
