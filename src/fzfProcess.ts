import * as cp from 'child_process';
import * as vscode from 'vscode';

export function filterWithFzf(query: string, files: string[], signal?: AbortSignal): Promise<string[]> {
    return new Promise((resolve) => {
        const filesCfg  = vscode.workspace.getConfiguration('vscope.files');
        const fzfCfg    = vscode.workspace.getConfiguration('vscope.fzf');
        const maxResults = filesCfg.get<number>('maxResults', 200);
        const fzfBin     = fzfCfg.get<string>('path', '') || 'fzf';

        if (!query.trim()) {
            resolve(files.slice(0, maxResults));
            return;
        }

        const proc = cp.spawn(fzfBin, ['--filter', query], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        signal?.addEventListener('abort', () => {
            proc.kill();
            resolve([]);
        }, { once: true });

        let stdout = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });

        proc.on('close', () => {
            if (signal?.aborted) return;
            resolve(stdout.split('\n').filter(Boolean).slice(0, maxResults));
        });

        proc.on('error', () => {
            if (signal?.aborted) return;
            const q = query.toLowerCase();
            resolve(files.filter((f) => f.toLowerCase().includes(q)).slice(0, maxResults));
        });

        proc.stdin.write(files.join('\n'));
        proc.stdin.end();
    });
}
