// fzy fuzzy-matching algorithm.
//
// TS port of telescope.nvim's fzy (algos/fzy.lua), itself a port of John Hawthorn's
// original C fzy <https://github.com/jhawthorn/fzy>. Returns both score and matched
// character positions from a single DP pass — same shape fzf/fzy use — so any caller
// that filters by membership and highlights by position is guaranteed to agree on
// which characters matched.

const SCORE_GAP_LEADING = -0.005;
const SCORE_GAP_TRAILING = -0.005;
const SCORE_GAP_INNER = -0.01;
const SCORE_MATCH_CONSECUTIVE = 1.0;
const SCORE_MATCH_SLASH = 0.9;
const SCORE_MATCH_WORD = 0.8;
const SCORE_MATCH_CAPITAL = 0.7;
const SCORE_MATCH_DOT = 0.6;
const SCORE_MAX = Infinity;
const SCORE_MIN = -Infinity;
const MAX_LEN = 1024;

export interface FzyResult {
    matched:   boolean;
    score:     number;
    positions: number[];
}

function hasMatch(needle: string, haystack: string): boolean {
    const n = needle.toLowerCase();
    const h = haystack.toLowerCase();
    let j = 0;
    for (let i = 0; i < n.length; i++) {
        j = h.indexOf(n[i], j);
        if (j === -1) return false;
        j++;
    }
    return true;
}

function precomputeBonus(haystack: string): Float64Array {
    const bonus = new Float64Array(haystack.length);
    let last = '/';
    for (let i = 0; i < haystack.length; i++) {
        const cur = haystack[i];
        if (last === '/' || last === '\\') bonus[i] = SCORE_MATCH_SLASH;
        else if (last === '-' || last === '_' || last === ' ') bonus[i] = SCORE_MATCH_WORD;
        else if (last === '.') bonus[i] = SCORE_MATCH_DOT;
        else if (last >= 'a' && last <= 'z' && cur >= 'A' && cur <= 'Z') bonus[i] = SCORE_MATCH_CAPITAL;
        else bonus[i] = 0;
        last = cur;
    }
    return bonus;
}

/**
 * Smith-Waterman-style DP table fill. D[i][j] is the best score ending in a match at
 * position j after consuming needle[0..i]; M[i][j] is the best score over the whole
 * subproblem up to that point.
 */
function compute(needle: string, haystack: string): { D: Float64Array[]; M: Float64Array[] } {
    const n = needle.length;
    const m = haystack.length;
    const bonus = precomputeBonus(haystack);
    const ln = needle.toLowerCase();
    const lh = haystack.toLowerCase();

    const D: Float64Array[] = new Array(n);
    const M: Float64Array[] = new Array(n);
    for (let i = 0; i < n; i++) {
        D[i] = new Float64Array(m);
        M[i] = new Float64Array(m);
        const gap = (i === n - 1) ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
        let prev = SCORE_MIN;
        const nc = ln[i];
        for (let j = 0; j < m; j++) {
            if (nc === lh[j]) {
                let score = SCORE_MIN;
                if (i === 0) {
                    score = (j * SCORE_GAP_LEADING) + bonus[j];
                } else if (j > 0) {
                    const a = M[i - 1][j - 1] + bonus[j];
                    const b = D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE;
                    score = Math.max(a, b);
                }
                D[i][j] = score;
                prev = Math.max(score, prev + gap);
                M[i][j] = prev;
            } else {
                D[i][j] = SCORE_MIN;
                prev = prev + gap;
                M[i][j] = prev;
            }
        }
    }
    return { D, M };
}

/**
 * Subsequence membership + (when matched) fzy score and positions from a single pass.
 * Mirrors how fzf returns score and indices together.
 */
export function fzyMatch(needle: string, haystack: string): FzyResult {
    if (!needle) return { matched: true, score: 0, positions: [] };
    const n = needle.length;
    const m = haystack.length;
    if (m === 0 || m > MAX_LEN || n > MAX_LEN) return { matched: false, score: SCORE_MIN, positions: [] };
    if (!hasMatch(needle, haystack)) return { matched: false, score: SCORE_MIN, positions: [] };
    if (n === m) {
        const positions: number[] = new Array(n);
        for (let i = 0; i < n; i++) positions[i] = i;
        return { matched: true, score: SCORE_MAX, positions };
    }
    const { D, M } = compute(needle, haystack);
    const positions: number[] = new Array(n);
    let matchRequired = false;
    let j = m - 1;
    for (let i = n - 1; i >= 0; i--) {
        while (j >= 0) {
            if (D[i][j] !== SCORE_MIN && (matchRequired || D[i][j] === M[i][j])) {
                matchRequired = (i !== 0) && (j !== 0) && (M[i][j] === D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE);
                positions[i] = j;
                j--;
                break;
            } else {
                j--;
            }
        }
    }
    return { matched: true, score: M[n - 1][m - 1], positions };
}
