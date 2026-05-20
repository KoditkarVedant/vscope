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
        const text      = obj.data.lines.text.replace(/[\r\n]+$/, '');
        const sm        = obj.data.submatches[0];
        const byteStart = sm?.start ?? 0;
        const byteEnd   = sm?.end   ?? byteStart;
        // rg reports byte offsets, but JS strings (and Shiki tokens) index by UTF-16 code units.
        // Convert so multi-byte characters before/inside the match don't shift the highlight.
        const charStart = byteOffsetToCharIndex(text, byteStart);
        const charEnd   = byteOffsetToCharIndex(text, byteEnd);
        return {
            file: obj.data.path.text.replace(/\\/g, '/'),
            line: obj.data.line_number,
            col: charStart + 1,
            length: charEnd - charStart,
            text,
        };
    } catch {
        return null;
    }
}

function byteOffsetToCharIndex(s: string, byteOffset: number): number {
    if (byteOffset === 0) return 0;
    if (Buffer.byteLength(s, 'utf8') === s.length) return byteOffset; // ASCII fast path
    return Buffer.from(s, 'utf8').slice(0, byteOffset).toString('utf8').length;
}
