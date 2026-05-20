import type { GrepMatch } from '../messages';
import { getRgPath } from '../rgPath';
import { streamLines } from './lineStreamer';
import { readRgGrepConfig, buildRgGrepArgs } from './rgGrepArgs';

/**
 * Stream ripgrep matches as delta chunks of GrepMatch[].
 * Small first chunk for low TTFB; larger chunks afterward.
 */
export async function* runGrep(
    query: string,
    workspaceRoot: string,
    signal?: AbortSignal
): AsyncGenerator<GrepMatch[]> {
    const args = buildRgGrepArgs(readRgGrepConfig(), query);
    for await (const lines of streamLines({
        cmd: getRgPath(),
        args,
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
        const sm    = obj.data.submatches[0];
        const start = sm?.start ?? 0;
        const end   = sm?.end   ?? start;
        return {
            file: obj.data.path.text.replace(/\\/g, '/'),
            line: obj.data.line_number,
            col: start + 1,
            length: end - start,
            text: obj.data.lines.text.replace(/[\r\n]+$/, ''),
        };
    } catch {
        return null;
    }
}
