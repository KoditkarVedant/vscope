import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | null = null;

function channel(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('VScope');
    }
    return _channel;
}

export function logError(context: string, err: unknown): void {
    const ch = channel();
    const time = new Date().toISOString();
    if (err instanceof Error) {
        ch.appendLine(`[${time}] [${context}] ${err.message}`);
        if (err.stack) ch.appendLine(err.stack);
    } else {
        ch.appendLine(`[${time}] [${context}] ${String(err)}`);
    }
}
