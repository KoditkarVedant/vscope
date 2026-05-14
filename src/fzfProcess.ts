import * as cp from 'child_process';

export function filterWithFzf(query: string, files: string[]): Promise<string[]> {
    return new Promise((resolve) => {
        if (!query.trim()) {
            resolve(files.slice(0, 200));
            return;
        }

        const proc = cp.spawn('fzf', ['--filter', query], {
            stdio: ['pipe', 'pipe', 'pipe'],
            ...(process.platform === 'win32' ? { shell: true } : {}),
        });

        let stdout = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });

        proc.on('close', () => {
            resolve(stdout.split('\n').filter(Boolean).slice(0, 200));
        });

        proc.on('error', () => {
            // fzf not in PATH — fall back to simple substring match
            const q = query.toLowerCase();
            resolve(
                files.filter((f) => f.toLowerCase().includes(q)).slice(0, 200)
            );
        });

        proc.stdin.write(files.join('\n'));
        proc.stdin.end();
    });
}
