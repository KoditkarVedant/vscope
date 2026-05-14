import * as vscode from 'vscode';
import { FzfPanel } from './FzfPanel';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vscope.search', () => {
            FzfPanel.createOrShow(context);
        }),
        // Forwards keybinding overrides to the active webview panel.
        // Each keybinding in package.json passes an action string via args.
        vscode.commands.registerCommand('vscope.keydown', (action: string) => {
            FzfPanel.currentPanel?.postToWebview({ type: 'nav', action });
        })
    );
}

export function deactivate() {}
