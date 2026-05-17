import * as vscode from 'vscode';
import * as path from 'path';
import { SearchEngine } from './SearchEngine';
import { PreviewProvider } from './PreviewProvider';
import type { PanelMode } from './messages';

export class FzfPanel {
    public static currentPanel: FzfPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _search: SearchEngine;
    private readonly _preview: PreviewProvider;
    private _disposables: vscode.Disposable[] = [];

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

        const post = (msg: object) => this._panel.webview.postMessage(msg);
        this._search  = new SearchEngine(workspaceRoot, post, mode);
        this._preview = new PreviewProvider(workspaceRoot, post);

        this._panel.webview.html = this._buildHtml(extensionUri);
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
        this._search.startBrowse();
    }

    public setMode(mode: PanelMode): void {
        this._search.setMode(mode);
        this._panel.webview.postMessage({ type: 'setMode', mode });
    }

    public postToWebview(msg: object): void {
        this._panel.webview.postMessage(msg);
    }

    public dispose(): void {
        setContext(false);
        this._search.cancelPending();
        this._preview.dispose();
        FzfPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    private async _handleMessage(msg: { type: string; value?: string; file?: string; line?: number; col?: number; chunkIndex?: number }) {
        switch (msg.type) {
            case 'query':
                await this._search.handleQuery(msg.value ?? '');
                break;

            case 'preview':
                if (msg.file) this._preview.schedule(msg.file, msg.line);
                break;

            case 'loadMorePreview':
                if (msg.file && msg.chunkIndex !== undefined) {
                    await this._preview.loadChunk(msg.file, msg.chunkIndex);
                }
                break;

            case 'select':
                if (msg.file) {
                    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
                    const abs = path.join(workspaceRoot, msg.file);
                    const uri = vscode.Uri.file(abs);
                    if (msg.line !== undefined) {
                        const line = msg.line - 1;
                        const col  = (msg.col ?? 1) - 1;
                        await vscode.window.showTextDocument(uri, {
                            selection: new vscode.Range(line, col, line, col),
                        });
                    } else {
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                }
                this._panel.dispose();
                break;

            case 'ready':
                this._panel.webview.postMessage({ type: 'setMode', mode: this._search.mode });
                break;

            case 'toggleMode':
                this.setMode(this._search.mode === 'files' ? 'grep' : 'files');
                break;

            case 'close':
                this._panel.dispose();
                break;
        }
    }

    private _buildHtml(extensionUri: vscode.Uri): string {
        const webview = this._panel.webview;
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
        const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
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
          <span>alt+,/. zoom pane</span>
          <span>↵/dbl open &nbsp;esc close</span>
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
      <div id="divider"></div>
      <div id="right-pane">
        <div id="preview-title"></div>
        <div id="preview-body"></div>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">window.__pathSep__ = '${process.platform === 'win32' ? '\\\\' : '/'}';</script>
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
