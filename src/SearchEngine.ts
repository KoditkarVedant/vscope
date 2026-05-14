import { streamFiles } from './fileProvider';
import { filterWithFzf } from './fzfProcess';
import { runGrep } from './grepProcess';
import type { PanelMode, ToWebviewMessage } from './messages';

export class SearchEngine {
    private _files: string[] = [];
    private _currentQuery = '';
    private _queryId = 0;
    private _cancelGrep: (() => void) | null = null;
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

    loadFiles(): void {
        streamFiles(this._workspaceRoot, (partial) => {
            this._files = partial;
            if (!this._currentQuery && this._mode === 'files') {
                this._postBrowse(partial);
            }
        }).then((all) => {
            this._files = all;
            if (!this._currentQuery && this._mode === 'files') {
                this._postBrowse(all);
            }
        });
    }

    setMode(mode: PanelMode): void {
        this._mode = mode;
        this._currentQuery = '';
        this._cancelGrep?.();
        this._cancelGrep = null;
        if (mode === 'files') {
            this._postBrowse(this._files);
        } else {
            this._post({ type: 'results', mode: 'grep', matches: [], total: 0, queryId: ++this._queryId });
        }
    }

    async handleQuery(value: string): Promise<void> {
        this._currentQuery = value;

        if (this._mode === 'grep') {
            this._cancelGrep?.();
            this._cancelGrep = null;
            if (!this._currentQuery) {
                this._post({ type: 'results', mode: 'grep', matches: [], total: 0, queryId: ++this._queryId });
                return;
            }
            const qid = ++this._queryId;
            this._cancelGrep = runGrep(this._currentQuery, this._workspaceRoot, (matches) => {
                this._post({
                    type: 'results',
                    mode: 'grep',
                    matches: matches.slice(0, 1000),
                    total: matches.length,
                    queryId: qid,
                });
            });
            return;
        }

        if (!this._currentQuery) {
            this._postBrowse(this._files);
            return;
        }
        const qid = ++this._queryId;
        const results = await filterWithFzf(this._currentQuery, this._files);
        this._post({
            type: 'results',
            mode: 'files',
            files: results,
            total: this._files.length,
            filtered: true,
            queryId: qid,
        });
    }

    cancelPending(): void {
        this._cancelGrep?.();
        this._cancelGrep = null;
    }

    private _postBrowse(files: string[]): void {
        this._post({
            type: 'results',
            mode: 'files',
            files: files.slice(0, 1000),
            total: files.length,
            filtered: false,
            queryId: 0,
        });
    }
}
