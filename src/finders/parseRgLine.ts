import type { GrepMatch } from '../messages';

/**
 * Parse a single line of ripgrep's `--json` output into a `GrepMatch`. Returns
 * `null` for non-match events (begin/end/summary) and for malformed input.
 *
 * Ripgrep reports byte offsets, but JS strings (and Shiki tokens) index by UTF-16
 * code units — convert so multi-byte chars before/inside the match don't shift
 * the highlight.
 */
export function parseRgLine(raw: string): GrepMatch | null {
    try {
        const obj = JSON.parse(raw);
        if (obj.type !== 'match') return null;
        const text      = obj.data.lines.text.replace(/[\r\n]+$/, '');
        const sm        = obj.data.submatches[0];
        const byteStart = sm?.start ?? 0;
        const byteEnd   = sm?.end   ?? byteStart;
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
