import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { fzyMatch } from '../algos/fzy';

describe('fzyMatch - edge cases', () => {
    test('empty needle matches anything with zero score', () => {
        const r = fzyMatch('', 'anything');
        assert.equal(r.matched, true);
        assert.equal(r.score, 0);
        assert.deepEqual(r.positions, []);
    });

    test('empty haystack does not match a non-empty needle', () => {
        const r = fzyMatch('x', '');
        assert.equal(r.matched, false);
        assert.deepEqual(r.positions, []);
    });

    test('exact equality returns +Infinity score and identity positions', () => {
        const r = fzyMatch('foo', 'foo');
        assert.equal(r.matched, true);
        assert.equal(r.score, Infinity);
        assert.deepEqual(r.positions, [0, 1, 2]);
    });

    test('haystack longer than MAX_LEN (1024) does not match', () => {
        const big = 'a'.repeat(1025);
        const r = fzyMatch('a', big);
        assert.equal(r.matched, false);
    });
});

describe('fzyMatch - subsequence membership', () => {
    test('characters out of order do not match', () => {
        const r = fzyMatch('cba', 'abc');
        assert.equal(r.matched, false);
    });

    test('missing characters do not match', () => {
        const r = fzyMatch('foo', 'fo');
        assert.equal(r.matched, false);
    });

    test('repeated characters consume distinct haystack slots', () => {
        assert.equal(fzyMatch('aa', 'a').matched, false);
        assert.equal(fzyMatch('aa', 'aa').matched, true);
        assert.equal(fzyMatch('aa', 'aba').matched, true);
    });

    test('matching is case-insensitive', () => {
        const r = fzyMatch('FOO', 'src/Foo.ts');
        assert.equal(r.matched, true);
        // positions point at F, o, o in the haystack
        assert.deepEqual(r.positions.map((p) => 'src/Foo.ts'[p].toLowerCase()), ['f', 'o', 'o']);
    });
});

describe('fzyMatch - position correctness', () => {
    test('positions are strictly increasing', () => {
        const r = fzyMatch('sfl', 'src/finders/lineStreamer.ts');
        assert.equal(r.matched, true);
        for (let i = 1; i < r.positions.length; i++) {
            assert.ok(r.positions[i] > r.positions[i - 1], `positions not increasing: ${r.positions}`);
        }
    });

    test('positions index characters that actually match the needle', () => {
        const needle = 'fzy';
        const hay = 'src/algos/fzy.ts';
        const r = fzyMatch(needle, hay);
        assert.equal(r.matched, true);
        const matched = r.positions.map((p) => hay[p].toLowerCase()).join('');
        assert.equal(matched, needle);
    });
});

describe('fzyMatch - scoring heuristics', () => {
    test('basename match outscores deeply-nested-path match', () => {
        const needle = 'foo';
        const a = fzyMatch(needle, 'foo.ts');
        const b = fzyMatch(needle, 'a/b/c/d/e/f/foo.ts');
        assert.equal(a.matched, true);
        assert.equal(b.matched, true);
        // Both end on the same trailing 'foo.ts', but the shallow path has fewer leading
        // gaps so should score higher.
        assert.ok(a.score > b.score, `expected ${a.score} > ${b.score}`);
    });

    test('consecutive characters beat scattered characters of the same name', () => {
        // "abc" in "abcxxx" is a single run; "abc" in "axbxcx" is three isolated chars.
        const consecutive = fzyMatch('abc', 'abcxxx');
        const scattered   = fzyMatch('abc', 'axbxcx');
        assert.equal(consecutive.matched, true);
        assert.equal(scattered.matched, true);
        assert.ok(consecutive.score > scattered.score, `consecutive=${consecutive.score} scattered=${scattered.score}`);
    });

    test('match right after a path separator beats a mid-segment match', () => {
        // 'foo' starting just after '/' picks up the slash bonus.
        const afterSlash = fzyMatch('foo', 'x/foo');
        const midSegment = fzyMatch('foo', 'xfooy');
        assert.equal(afterSlash.matched, true);
        assert.equal(midSegment.matched, true);
        assert.ok(afterSlash.score > midSegment.score, `afterSlash=${afterSlash.score} midSegment=${midSegment.score}`);
    });

    test('match at start of word (after underscore) beats mid-word match', () => {
        const afterWordBoundary = fzyMatch('bar', 'foo_bar');
        const midWord           = fzyMatch('bar', 'foobary');
        assert.equal(afterWordBoundary.matched, true);
        assert.equal(midWord.matched, true);
        assert.ok(afterWordBoundary.score > midWord.score, `boundary=${afterWordBoundary.score} mid=${midWord.score}`);
    });
});
