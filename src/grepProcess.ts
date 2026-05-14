import * as cp from 'child_process';
import type { GrepMatch } from './messages';

export function runGrep(
    query: string,
    workspaceRoot: string,
    onChunk: (matches: GrepMatch[]) => void
): () => void {
    const accumulated: GrepMatch[] = [];
    let buf = '';
    let lastEmit = 0;

    const proc = cp.spawn(
        'rg',
        ['--json', '--smart-case', '--', query, '.'],
        { cwd: workspaceRoot }
    );

    function emit(force = false) {
        const now = Date.now();
        if (force || now - lastEmit >= 100) {
            lastEmit = now;
            onChunk([...accumulated]);
        }
    }

    proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const raw of lines) {
            if (!raw.trim()) continue;
            try {
                const obj = JSON.parse(raw);
                if (obj.type === 'match') {
                    accumulated.push({
                        file: obj.data.path.text.replace(/\\/g, '/'),
                        line: obj.data.line_number,
                        col: (obj.data.submatches[0]?.start ?? 0) + 1,
                        text: obj.data.lines.text.replace(/[\r\n]+$/, ''),
                    });
                }
            } catch {
                // skip malformed lines
            }
        }
        emit();
    });

    proc.on('close', () => emit(true));
    proc.on('error', () => onChunk([]));

    return () => proc.kill();
}
