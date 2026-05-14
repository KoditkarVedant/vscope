import * as vscode from 'vscode';
import { FzfPanel } from './FzfPanel';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vscope.search', () => {
            FzfPanel.createOrShow(context);
        })
    );
}

export function deactivate() {}
