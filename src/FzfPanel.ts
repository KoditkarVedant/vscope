import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { streamFiles } from './fileProvider';
import { filterWithFzf } from './fzfProcess';

export class FzfPanel {
    public static currentPanel: FzfPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _workspaceRoot: string;
    private _disposables: vscode.Disposable[] = [];
    private _files: string[] = [];
    private _currentQuery = '';
    private _previewDebounce: NodeJS.Timeout | undefined;

    public static createOrShow(context: vscode.ExtensionContext) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('fzf-vscode: No workspace folder is open.');
            return;
        }

        if (FzfPanel.currentPanel) {
            FzfPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'fzfSearch',
            'fzf Search',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
                retainContextWhenHidden: true,
            }
        );

        FzfPanel.currentPanel = new FzfPanel(panel, context.extensionUri, workspaceRoot);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        workspaceRoot: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._workspaceRoot = workspaceRoot;

        this._panel.webview.html = this._buildHtml();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );

        this._loadFiles();
    }

    private _loadFiles() {
        streamFiles(this._workspaceRoot, (partial) => {
            this._files = partial;
            // Only push browse updates when the user hasn't typed anything yet
            if (!this._currentQuery) {
                this._postBrowse(partial);
            }
        }).then((all) => {
            this._files = all;
            if (!this._currentQuery) {
                this._postBrowse(all);
            }
        });
    }

    private _postBrowse(files: string[]) {
        this._panel.webview.postMessage({
            type: 'results',
            files: files.slice(0, 1000),
            total: files.length,
            filtered: false,
        });
    }

    private async _handleMessage(msg: { type: string; value?: string; file?: string }) {
        switch (msg.type) {
            case 'query': {
                this._currentQuery = msg.value ?? '';
                if (!this._currentQuery) {
                    this._postBrowse(this._files);
                    break;
                }
                const results = await filterWithFzf(this._currentQuery, this._files);
                this._panel.webview.postMessage({
                    type: 'results',
                    files: results,
                    total: this._files.length,
                    filtered: true,
                });
                break;
            }
            case 'preview': {
                clearTimeout(this._previewDebounce);
                this._previewDebounce = setTimeout(() => this._sendPreview(msg.file ?? ''), 80);
                break;
            }
            case 'select': {
                if (msg.file) {
                    const abs = path.join(this._workspaceRoot, msg.file);
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(abs));
                }
                this._panel.dispose();
                break;
            }
            case 'close': {
                this._panel.dispose();
                break;
            }
        }
    }

    private _sendPreview(relPath: string) {
        const abs = path.join(this._workspaceRoot, relPath);
        let content: string;
        try {
            content = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 500).join('\n');
        } catch {
            content = '(binary or unreadable file)';
        }
        this._panel.webview.postMessage({ type: 'previewContent', file: relPath, content });
    }

    public dispose() {
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
  <title>fzf Search</title>
</head>
<body>
  <div id="overlay">
    <div id="modal">
      <div id="left-pane">
        <div id="results"></div>
        <div id="footer">
          <span>^j/n ↓ &nbsp;^p ↑</span>
          <span>^u/d preview ↕</span>
          <span>^f/k preview ↔</span>
          <span>↵ open &nbsp;esc close</span>
        </div>
        <div id="search-bar">
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

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
