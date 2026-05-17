import * as vscode from 'vscode';

// FzfPanel pulls in SearchEngine, PreviewProvider, and (transitively) shiki — none of which
// are needed until the user actually invokes a command. Loading them on demand keeps
// activation to just registering the command callbacks.
async function getPanel() {
    const mod = await import('./FzfPanel');
    return mod.FzfPanel;
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vscope.findFiles', async () => {
            const FzfPanel = await getPanel();
            FzfPanel.createOrShow(context, 'files');
        }),
        vscode.commands.registerCommand('vscope.liveGrep', async () => {
            const FzfPanel = await getPanel();
            FzfPanel.createOrShow(context, 'grep');
        }),
        vscode.commands.registerCommand('vscope.keydown', async (action: string) => {
            const FzfPanel = await getPanel();
            FzfPanel.currentPanel?.postToWebview({ type: 'nav', action });
        })
    );
}

export function deactivate() {}
