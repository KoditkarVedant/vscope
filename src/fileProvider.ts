import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';

export type ChunkCallback = (files: string[]) => void;

/**
 * Stream workspace files, calling onChunk progressively as lines arrive.
 * Tries git ls-files → fd → vscode.findFiles in order.
 * Resolves with the complete file list when done.
 */
export function streamFiles(workspaceRoot: string, onChunk: ChunkCallback): Promise<string[]> {
    return new Promise((resolve) => {
        tryStream(
            'git', ['ls-files', '--cached', '--others', '--exclude-standard'], workspaceRoot,
            onChunk, resolve,
            () => tryStream(
                'fd', ['--type', 'f', '--hidden', '--follow', '--exclude', '.git'], workspaceRoot,
                onChunk, resolve,
                () => tryVscode(workspaceRoot, onChunk, resolve)
            )
        );
    });
}

function tryStream(
    cmd: string,
    args: string[],
    cwd: string,
    onChunk: ChunkCallback,
    onDone: (files: string[]) => void,
    onFail: () => void
) {
    const all: string[] = [];
    let buf = '';
    let lastEmit = 0;

    const proc = cp.spawn(cmd, args, { cwd });

    proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        const nl = buf.lastIndexOf('\n');
        if (nl < 0) return;

        const lines = buf.slice(0, nl).split('\n').filter(Boolean);
        buf = buf.slice(nl + 1);
        all.push(...lines);

        // Throttle to ~10 emits/sec so we don't flood postMessage
        const now = Date.now();
        if (now - lastEmit >= 100) {
            lastEmit = now;
            onChunk([...all]);
        }
    });

    proc.on('close', (code) => {
        if (buf) all.push(...buf.split('\n').filter(Boolean));

        if (code === 0 && all.length > 0) {
            onChunk([...all]);
            onDone([...all]);
        } else {
            onFail();
        }
    });

    proc.on('error', onFail);
}

function tryVscode(workspaceRoot: string, onChunk: ChunkCallback, onDone: (files: string[]) => void) {
    vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**}', 20000).then((uris) => {
        const files = uris.map((u) => path.relative(workspaceRoot, u.fsPath).replace(/\\/g, '/'));
        onChunk(files);
        onDone(files);
    });
}
