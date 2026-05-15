import { streamLines } from './lineStreamer';
import type { GrepMatch } from './messages';

/**
 * Stream ripgrep matches as delta chunks of GrepMatch[].
 * Small first chunk for low TTFB; larger chunks afterward.
 */
export async function* runGrep(
    query: string,
    workspaceRoot: string,
    signal?: AbortSignal
): AsyncGenerator<GrepMatch[]> {
    for await (const lines of streamLines({
        cmd: 'rg',
        args: ['--json', '--smart-case', '--', query, '.'],
        cwd: workspaceRoot,
        signal,
        chunkSize: (isFirst, count) => {
            if (isFirst) return 100;
            if (count < 10_000) return 5_000;
            return 12_000;
        },
    })) {
        const matches: GrepMatch[] = [];
        for (const raw of lines) {
            const parsed = parseLine(raw);
            if (parsed) matches.push(parsed);
        }
        if (matches.length > 0) yield matches;
    }
}

function parseLine(raw: string): GrepMatch | null {
    try {
        const obj = JSON.parse(raw);
        if (obj.type !== 'match') return null;
        return {
            file: obj.data.path.text.replace(/\\/g, '/'),
            line: obj.data.line_number,
            col: (obj.data.submatches[0]?.start ?? 0) + 1,
            text: obj.data.lines.text.replace(/[\r\n]+$/, ''),
        };
    } catch {
        return null;
    }
}
