import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseRgLine as parseLine } from '../finders/parseRgLine';

function rgMatch(opts: {
    path: string;
    line: number;
    text: string;
    submatches?: Array<{ start: number; end: number; match?: string }>;
}): string {
    return JSON.stringify({
        type: 'match',
        data: {
            path:        { text: opts.path },
            lines:       { text: opts.text },
            line_number: opts.line,
            absolute_offset: 0,
            submatches:  (opts.submatches ?? []).map((s) => ({
                match: { text: s.match ?? '' },
                start: s.start,
                end:   s.end,
            })),
        },
    });
}

describe('parseLine - non-match input', () => {
    test('returns null for non-JSON garbage', () => {
        assert.equal(parseLine('not json at all'), null);
        assert.equal(parseLine(''), null);
        assert.equal(parseLine('{'), null);
    });

    test('returns null for ripgrep summary / begin / end events', () => {
        assert.equal(parseLine(JSON.stringify({ type: 'summary', data: {} })), null);
        assert.equal(parseLine(JSON.stringify({ type: 'begin',   data: {} })), null);
        assert.equal(parseLine(JSON.stringify({ type: 'end',     data: {} })), null);
    });
});

describe('parseLine - basic match shape', () => {
    test('extracts file, line, col, length, text from a simple ASCII match', () => {
        const raw = rgMatch({
            path: 'src/foo.ts',
            line: 42,
            text: 'const greeting = "hello world";',
            submatches: [{ start: 19, end: 24, match: 'hello' }],
        });
        const r = parseLine(raw);
        assert.ok(r, 'expected a match');
        assert.equal(r!.file,   'src/foo.ts');
        assert.equal(r!.line,   42);
        assert.equal(r!.col,    20);   // 1-indexed char offset of 'h'
        assert.equal(r!.length, 5);    // 'hello'
        assert.equal(r!.text,   'const greeting = "hello world";');
    });

    test('uses the first submatch when ripgrep returns multiple on one line', () => {
        const raw = rgMatch({
            path: 'a.ts',
            line: 1,
            text: 'foo bar foo',
            submatches: [
                { start: 0, end: 3, match: 'foo' },
                { start: 8, end: 11, match: 'foo' },
            ],
        });
        const r = parseLine(raw);
        assert.equal(r!.col, 1);
        assert.equal(r!.length, 3);
    });

    test('falls back to col=1 length=0 when submatches is empty', () => {
        const raw = rgMatch({ path: 'a.ts', line: 1, text: 'x', submatches: [] });
        const r = parseLine(raw);
        assert.equal(r!.col, 1);
        assert.equal(r!.length, 0);
    });
});

describe('parseLine - line text normalization', () => {
    test('strips a trailing LF from the line text', () => {
        const raw = rgMatch({ path: 'a.ts', line: 1, text: 'hello\n', submatches: [{ start: 0, end: 5 }] });
        assert.equal(parseLine(raw)!.text, 'hello');
    });

    test('strips a trailing CRLF from the line text', () => {
        const raw = rgMatch({ path: 'a.ts', line: 1, text: 'hello\r\n', submatches: [{ start: 0, end: 5 }] });
        assert.equal(parseLine(raw)!.text, 'hello');
    });

    test('preserves CR/LF embedded in the middle of the line', () => {
        // Pathological but possible — make sure the regex anchors at end only.
        const raw = rgMatch({ path: 'a.ts', line: 1, text: 'a\nb', submatches: [{ start: 0, end: 1 }] });
        assert.equal(parseLine(raw)!.text, 'a\nb');
    });
});

describe('parseLine - path normalization', () => {
    test('converts Windows backslashes to forward slashes in file path', () => {
        const raw = rgMatch({
            path: 'src\\finders\\text.ts',
            line: 1,
            text: 'x',
            submatches: [{ start: 0, end: 1 }],
        });
        assert.equal(parseLine(raw)!.file, 'src/finders/text.ts');
    });
});

describe('parseLine - byte offset to char index conversion', () => {
    test('multi-byte chars before the match do not shift col', () => {
        // 'é' is two UTF-8 bytes but one JS char. ripgrep reports byte offsets, so the
        // raw byte start of the match is 3 (é + space + x), but the char offset is 2.
        const text = 'é xy';
        const before = 'é ';
        const byteStart = Buffer.byteLength(before, 'utf8'); // 3
        const byteEnd   = byteStart + 1;                     // covers 'x'
        const raw = rgMatch({
            path: 'a.ts',
            line: 1,
            text,
            submatches: [{ start: byteStart, end: byteEnd }],
        });
        const r = parseLine(raw);
        assert.equal(r!.col,    3); // 1-indexed JS string index of 'x'
        assert.equal(r!.length, 1);
        // Sanity: text[col-1 .. col-1+length] is the matched substring.
        assert.equal(r!.text.slice(r!.col - 1, r!.col - 1 + r!.length), 'x');
    });

    test('multi-byte chars inside the match preserve correct char-length', () => {
        // 'café' has byte length 5 but JS-string length 4.
        const text = 'café';
        const byteStart = 0;
        const byteEnd   = Buffer.byteLength(text, 'utf8'); // 5
        const raw = rgMatch({
            path: 'a.ts',
            line: 1,
            text,
            submatches: [{ start: byteStart, end: byteEnd }],
        });
        const r = parseLine(raw);
        assert.equal(r!.col,    1);
        assert.equal(r!.length, 4); // 4 JS chars, not 5 bytes
    });

    test('pure ASCII takes the fast path and produces identical results', () => {
        const text = 'plain ascii text';
        const raw = rgMatch({
            path: 'a.ts',
            line: 1,
            text,
            submatches: [{ start: 6, end: 11 }], // 'ascii'
        });
        const r = parseLine(raw);
        assert.equal(r!.col,    7);
        assert.equal(r!.length, 5);
        assert.equal(r!.text.slice(r!.col - 1, r!.col - 1 + r!.length), 'ascii');
    });
});
