import * as cp from 'child_process';
import * as vscode from 'vscode';
import { getRgPath } from '../rgPath';
import { readRgFilesConfig, buildRgFilesArgs } from './rgFilesArgs';

export function fuzzyFiles(
    workspaceRoot: string,
    query: string,
    signal?: AbortSignal
): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
        if (signal?.aborted) { resolve([]); return; }

        const fzfBin = vscode.workspace.getConfiguration('vscope.fzf').get<string>('path', '') || 'fzf';

        const rgArgs = buildRgFilesArgs(readRgFilesConfig());
        const rg  = cp.spawn(getRgPath(), rgArgs, { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'] });
        const fzf = cp.spawn(fzfBin, ['--filter', query], { stdio: ['pipe', 'pipe', 'pipe'] });

        const cleanup = () => {
            if (!rg.killed)  rg.kill();
            if (!fzf.killed) fzf.kill();
        };

        const abort = () => { cleanup(); resolve([]); };
        signal?.addEventListener('abort', abort, { once: true });

        // Pipe rg output directly into fzf — no JS buffer for the full file list.
        rg.stdout.pipe(fzf.stdin);
        rg.on('error', () => { try { fzf.stdin.end(); } catch {} });

        let stdout = '';
        fzf.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });

        fzf.on('close', () => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) return;
            resolve(stdout.split('\n').filter(Boolean).map(normalize));
        });

        fzf.on('error', (err: NodeJS.ErrnoException) => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) return;
            if (err.code === 'ENOENT') {
                vscode.window.showWarningMessage(
                    `VScope: fzf binary not found ("${fzfBin}"). Install fzf or set vscope.fzf.path.`
                );
            }
            resolve([]);
        });
    });
}

function normalize(p: string): string {
    return p.replace(/\\/g, '/');
}
