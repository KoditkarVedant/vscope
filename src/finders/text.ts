import type { GrepMatch } from '../messages';
import { getRgPath } from '../rgPath';
import { streamLines } from './lineStreamer';
import { readRgGrepConfig, buildRgGrepArgs } from './rgGrepArgs';
import { parseRgLine } from './parseRgLine';

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
            const parsed = parseRgLine(raw);
            if (parsed) matches.push(parsed);
        }
        if (matches.length > 0) yield matches;
    }
}
