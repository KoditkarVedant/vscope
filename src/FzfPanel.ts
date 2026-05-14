import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { streamFiles } from './fileProvider';
import { filterWithFzf } from './fzfProcess';
import { runGrep } from './grepProcess';

export type PanelMode = 'files' | 'grep';

export class FzfPanel {
    public static currentPanel: FzfPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _workspaceRoot: string;
    private _disposables: vscode.Disposable[] = [];
    private _files: string[] = [];
    private _currentQuery = '';
    private _queryId = 0;
    private _mode: PanelMode;
    private _cancelGrep: (() => void) | null = null;
    private _previewDebounce: NodeJS.Timeout | undefined;

    public static createOrShow(context: vscode.ExtensionContext, mode: PanelMode = 'files') {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('VScope: No workspace folder is open.');
            return;
        }

        if (FzfPanel.currentPanel) {
            FzfPanel.currentPanel.setMode(mode);
            FzfPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'vscope',
            'VScope',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
                retainContextWhenHidden: true,
            }
        );

        FzfPanel.currentPanel = new FzfPanel(panel, context.extensionUri, workspaceRoot, mode);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        workspaceRoot: string,
        mode: PanelMode
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._workspaceRoot = workspaceRoot;
        this._mode = mode;

        this._panel.webview.html = this._buildHtml();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(
            (e) => setContext(e.webviewPanel.visible),
            null,
            this._disposables
        );
        this._panel.webview.onDidReceiveMessage(
            (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );

        setContext(true);
        this._loadFiles();
    }

    public setMode(mode: PanelMode) {
        this._mode = mode;
        this._currentQuery = '';
        this._cancelGrep?.();
        this._cancelGrep = null;
        this._panel.webview.postMessage({ type: 'setMode', mode });
        if (mode === 'files') {
            this._postBrowse(this._files);
        } else {
            this._panel.webview.postMessage({ type: 'results', mode: 'grep', matches: [], total: 0 });
        }
    }

    private _loadFiles() {
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

    private _postBrowse(files: string[]) {
        this._panel.webview.postMessage({
            type: 'results',
            mode: 'files',
            files: files.slice(0, 1000),
            total: files.length,
            filtered: false,
            queryId: 0,
        });
    }

    private async _handleMessage(msg: {
        type: string;
        value?: string;
        file?: string;
        line?: number;
        col?: number;
    }) {
        switch (msg.type) {
            case 'query': {
                this._currentQuery = msg.value ?? '';

                if (this._mode === 'grep') {
                    this._cancelGrep?.();
                    this._cancelGrep = null;
                    if (!this._currentQuery) {
                        this._panel.webview.postMessage({ type: 'results', mode: 'grep', matches: [], total: 0, queryId: ++this._queryId });
                        break;
                    }
                    const qid = ++this._queryId;
                    this._cancelGrep = runGrep(this._currentQuery, this._workspaceRoot, (matches) => {
                        this._panel.webview.postMessage({
                            type: 'results',
                            mode: 'grep',
                            matches: matches.slice(0, 1000),
                            total: matches.length,
                            queryId: qid,
                        });
                    });
                    break;
                }

                // files mode
                if (!this._currentQuery) {
                    this._postBrowse(this._files);
                    break;
                }
                const qid = ++this._queryId;
                const results = await filterWithFzf(this._currentQuery, this._files);
                this._panel.webview.postMessage({
                    type: 'results',
                    mode: 'files',
                    files: results,
                    total: this._files.length,
                    filtered: true,
                    queryId: qid,
                });
                break;
            }

            case 'preview': {
                clearTimeout(this._previewDebounce);
                this._previewDebounce = setTimeout(
                    () => this._sendPreview(msg.file ?? '', msg.line),
                    80
                );
                break;
            }

            case 'select': {
                if (msg.file) {
                    const abs = path.join(this._workspaceRoot, msg.file);
                    const uri = vscode.Uri.file(abs);
                    if (msg.line !== undefined) {
                        const line = msg.line - 1;
                        const col = (msg.col ?? 1) - 1;
                        await vscode.window.showTextDocument(uri, {
                            selection: new vscode.Range(line, col, line, col),
                        });
                    } else {
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                }
                this._panel.dispose();
                break;
            }

            case 'ready': {
                // Webview JS has loaded — send the initial mode so the button
                // label and placeholder are correct before any results arrive.
                this._panel.webview.postMessage({ type: 'setMode', mode: this._mode });
                break;
            }

            case 'toggleMode': {
                this.setMode(this._mode === 'files' ? 'grep' : 'files');
                break;
            }

            case 'close': {
                this._panel.dispose();
                break;
            }
        }
    }

    private _sendPreview(relPath: string, line?: number) {
        const abs = path.join(this._workspaceRoot, relPath);
        let content: string;
        try {
            content = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 500).join('\n');
        } catch {
            content = '(binary or unreadable file)';
        }
        this._panel.webview.postMessage({ type: 'previewContent', file: relPath, content, line });
    }

    public postToWebview(msg: object) {
        this._panel.webview.postMessage(msg);
    }

    public dispose() {
        setContext(false);
        this._cancelGrep?.();
        FzfPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    private _buildHtml(): string {
        const webview = this._panel.webview;
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource};
             script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>VScope</title>
</head>
<body>
  <div id="overlay">
    <div id="modal">
      <div id="left-pane">
        <div id="results"></div>
        <div id="footer">
          <span>^n ↓ &nbsp;^p ↑</span>
          <span>^u/d preview ↕</span>
          <span>^f/k preview ↔</span>
          <span>↵ open &nbsp;esc close</span>
        </div>
        <div id="search-bar">
          <button id="mode-btn" title="Toggle between file search and live grep">files</button>
          <span id="prompt">&gt;</span>
          <input id="search-input"
            type="text"
            placeholder="Search files..."
            autocomplete="off"
            spellcheck="false"
            autofocus>
          <span id="counter"></span>
        </div>
      </div>
      <div id="right-pane">
        <div id="preview-title"></div>
        <pre id="preview-body"></pre>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function setContext(active: boolean) {
    vscode.commands.executeCommand('setContext', 'vscope.active', active);
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
