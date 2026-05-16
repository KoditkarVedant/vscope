import * as cp from 'child_process';

export function filterWithFzf(query: string, files: string[], signal?: AbortSignal): Promise<string[]> {
    return new Promise((resolve) => {
        if (!query.trim()) {
            resolve(files.slice(0, 200));
            return;
        }

        const proc = cp.spawn('fzf', ['--filter', query], {
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
            resolve(stdout.split('\n').filter(Boolean).slice(0, 200));
        });

        proc.on('error', () => {
            if (signal?.aborted) return;
            const q = query.toLowerCase();
            resolve(files.filter((f) => f.toLowerCase().includes(q)).slice(0, 200));
        });

        proc.stdin.write(files.join('\n'));
        proc.stdin.end();
    });
}
