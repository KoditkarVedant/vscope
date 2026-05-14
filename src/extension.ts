import * as vscode from 'vscode';
import { FzfPanel } from './FzfPanel';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vscope.search', () => {
            FzfPanel.createOrShow(context, 'files');
        }),
        vscode.commands.registerCommand('vscope.grep', () => {
            FzfPanel.createOrShow(context, 'grep');
        }),
        vscode.commands.registerCommand('vscope.keydown', (action: string) => {
            FzfPanel.currentPanel?.postToWebview({ type: 'nav', action });
        })
    );
}

export function deactivate() {}
