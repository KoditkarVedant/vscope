// @ts-check
/// <reference lib="dom" />

const vscode = acquireVsCodeApi();

// ── Config ────────────────────────────────────────────────────────────────────
// All tunables live here so behavior is easy to inspect and adjust.

const CFG = Object.freeze({
    /** Row height in px — must match .result-row height in style.css. */
    ITEM_HEIGHT: 28,
    /** Extra rows rendered above/below the visible window. */
    VIRT_BUFFER: 8,
    /** Debounce before sending a files-mode query to the extension (ms). */
    QUERY_DEBOUNCE_FILES_MS: 60,
    /** Debounce before sending a grep-mode query (ms). */
    QUERY_DEBOUNCE_GREP_MS: 150,
    /** Debounce before requesting preview for the selected row (ms). */
    PREVIEW_DEBOUNCE_MS: 80,
    /** Distance (px) from preview bottom that triggers loadMorePreview. */
    PREVIEW_PREFETCH_PX: 200,
});

// Kept as locals for code readability; values come from CFG.
const ITEM_HEIGHT = CFG.ITEM_HEIGHT;
const BUFFER      = CFG.VIRT_BUFFER;

// ── rAF coalescer ─────────────────────────────────────────────────────────────
// Generic batcher: caller pushes items as they arrive; drain runs at most once
// per animation frame with the accumulated batch. Decouples message receipt
// (must stay sub-millisecond) from heavy DOM/state work.

/**
 * @template T
 * @param {(batch: T[]) => void} drain
 * @returns {{ push: (item: T) => void, clear: () => void }}
 */
function createRafCoalescer(drain) {
    /** @type {T[]} */
    let pending = [];
    let scheduled = false;

    const flush = () => {
        scheduled = false;
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        drain(batch);
    };

    return {
        push(item) {
            pending.push(item);
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(flush);
        },
        clear() {
            pending = [];
        },
    };
}

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {'files' | 'grep'} */
let mode = 'files';

/** @type {string[]} */
let results = [];

/** @type {Array<{file:string, line:number, col:number, text:string}>} */
let grepMatches = [];

let selectedIdx     = 0;
let lastQueryId     = -1;
let currentQuery    = '';
let currentTotal    = 0;
let currentFiltered = false;

// ── Preview chunk state ───────────────────────────────────────────────────────

let previewFile        = '';
let previewNextChunk   = 0;
let previewTotalChunks = 0;
let previewLoading     = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let queryDebounce   = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let previewDebounce = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let counterDebounce = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const searchInput  = /** @type {HTMLInputElement}   */ (document.getElementById('search-input'));
const resultsList  = /** @type {HTMLElement}         */ (document.getElementById('results'));
const previewTitle = /** @type {HTMLElement}         */ (document.getElementById('preview-title'));
const previewBody  = /** @type {HTMLElement}         */ (document.getElementById('preview-body'));
const counter      = /** @type {HTMLElement}         */ (document.getElementById('counter'));
const modeBtn      = /** @type {HTMLButtonElement}   */ (document.getElementById('mode-btn'));
const divider      = /** @type {HTMLElement}         */ (document.getElementById('divider'));
const leftPane     = /** @type {HTMLElement}         */ (document.getElementById('left-pane'));
const rightPane    = /** @type {HTMLElement}         */ (document.getElementById('right-pane'));
const modal        = /** @type {HTMLElement}         */ (document.getElementById('modal'));

// Keep focus on the search input whenever the user clicks anywhere inside the
// modal — prevents mode-switch and results clicks from stealing focus.
document.getElementById('overlay').addEventListener('mousedown', (e) => {
    if (e.target !== searchInput && !leftPane.classList.contains('hidden')) e.preventDefault();
});

window.addEventListener('focus', () => searchInput.focus());

// ── Pane resize ───────────────────────────────────────────────────────────────

let leftWidthPct = 38;
/** @type {null | 'left' | 'right'} */
let maximized = null;

function setLeftWidth(pct) {
    leftWidthPct = Math.max(15, Math.min(80, pct));
    leftPane.style.width = `${leftWidthPct}%`;
}

function toggleMaximize(side) {
    if (maximized === side) {
        maximized = null;
        leftPane.classList.remove('hidden');
        rightPane.classList.remove('hidden');
        divider.classList.remove('hidden');
        leftPane.style.width = `${leftWidthPct}%`;
        searchInput.focus();
    } else {
        maximized = side;
        if (side === 'left') {
            rightPane.classList.add('hidden');
            divider.classList.add('hidden');
            leftPane.classList.remove('hidden');
            leftPane.style.width = '100%';
            searchInput.focus();
        } else {
            leftPane.classList.add('hidden');
            divider.classList.add('hidden');
            rightPane.classList.remove('hidden');
        }
    }
}

divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = leftPane.getBoundingClientRect().width;
    const totalWidth = modal.getBoundingClientRect().width;

    divider.classList.add('dragging');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) { setLeftWidth(((startWidth + e.clientX - startX) / totalWidth) * 100); }
    function onUp()   {
        divider.classList.remove('dragging');
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
});

function resetPanes() {
    maximized = null;
    leftPane.classList.remove('hidden');
    rightPane.classList.remove('hidden');
    divider.classList.remove('hidden');
    setLeftWidth(38);
}

divider.addEventListener('dblclick', resetPanes);

// ── Virtualizer ───────────────────────────────────────────────────────────────
// Only renders the rows visible in the scroll window plus a small buffer.
// Row positions are set with absolute CSS so the spacer height drives the
// scrollbar, not the actual DOM nodes.

const spacer = document.createElement('div');
spacer.style.cssText = 'position:relative;width:100%;';
resultsList.appendChild(spacer);

const virt = {
    count: 0,
    _rafScheduled: false,
    _renderedStart: 0,
    _renderedEnd: 0,
    /** @type {Map<number, HTMLElement>} index → row element currently in DOM */
    _rows: new Map(),
    _purgeOnNextRender: false,

    /**
     * Mark all rendered rows as stale — next render purges and rebuilds them.
     * Used when the underlying data is replaced (resultsReset, mode change).
     */
    invalidate() {
        this._purgeOnNextRender = true;
    },

    /** Call after results array changes. Coalesces bursts into one render per frame. */
    setCount(n) {
        if (n !== this.count) {
            this.count = n;
            spacer.style.height = `${n * ITEM_HEIGHT}px`;
        }
        this.scheduleRender();
    },

    scheduleRender() {
        if (this._rafScheduled) return;
        this._rafScheduled = true;
        requestAnimationFrame(() => {
            this._rafScheduled = false;
            this.render();
        });
    },

    /**
     * Move selection. If new row is already in the rendered window, just toggle .selected on
     * the old and new rows — no virtualizer rebuild. Otherwise scroll into view (which fires
     * the scroll listener and re-renders) or schedule an explicit render.
     */
    selectIndex(newIdx, oldIdx) {
        this._rows.get(oldIdx)?.classList.remove('selected');

        const top    = newIdx * ITEM_HEIGHT;
        const bottom = top + ITEM_HEIGHT;
        const { scrollTop, clientHeight } = resultsList;

        // Scroll into view if needed. Don't return — the new row may already be in _rows
        // (BUFFER pre-renders nearby indices), in which case we still need to flip its class.
        if (top < scrollTop) {
            resultsList.scrollTop = top;
        } else if (bottom > scrollTop + clientHeight) {
            resultsList.scrollTop = bottom - clientHeight;
        }

        const cur = this._rows.get(newIdx);
        if (cur) {
            cur.classList.add('selected');
        } else {
            this.scheduleRender();
        }
    },

    render() {
        const { scrollTop, clientHeight } = resultsList;
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
        const end   = Math.min(this.count, Math.ceil((scrollTop + clientHeight) / ITEM_HEIGHT) + BUFFER);

        if (this._purgeOnNextRender) {
            this._purgeOnNextRender = false;
            for (const el of this._rows.values()) el.remove();
            this._rows.clear();
        }

        // Drop rows that scrolled out of the window.
        for (const [idx, el] of this._rows) {
            if (idx < start || idx >= end) {
                el.remove();
                this._rows.delete(idx);
            }
        }

        // Mount rows that scrolled into the window. Untouched rows stay put — no repaint.
        for (let i = start; i < end; i++) {
            if (this._rows.has(i)) continue;
            const row = buildRow(i);
            row.style.cssText =
                `position:absolute;top:${i * ITEM_HEIGHT}px;left:0;right:0;height:${ITEM_HEIGHT}px;`;
            spacer.appendChild(row);
            this._rows.set(i, row);
        }

        this._renderedStart = start;
        this._renderedEnd = end;
    },
};

resultsList.addEventListener('scroll', () => virt.scheduleRender(), { passive: true });

// ── Append queue ──────────────────────────────────────────────────────────────
// Buffers resultsAppend messages and drains them once per animation frame. Pre-batching
// folds N message handlers into one DOM-touching pass per frame, so the main thread is
// free to dispatch keypresses between incoming chunks during streaming bursts.

/** @typedef {{ queryId: number, mode: 'files' | 'grep', items: any[], total: number }} AppendMsg */

const appendQueue = createRafCoalescer(/** @param {AppendMsg[]} batch */ (batch) => {
    // The reset path clears the queue, so every batch here is for the current query/mode.
    let firstAppendOfQuery = listLength() === 0;
    let nextTotal = currentTotal;
    let addedAny = false;

    for (const msg of batch) {
        if (msg.queryId !== lastQueryId || msg.mode !== mode) continue;
        if (msg.mode === 'grep') {
            for (const m of msg.items) grepMatches.push(m);
        } else {
            for (const f of msg.items) results.push(f);
        }
        nextTotal = msg.total;
        addedAny = true;
    }

    if (!addedAny) return;

    if (nextTotal !== currentTotal || currentFiltered) {
        currentTotal = nextTotal;
        scheduleCounter();
    }
    virt.setCount(listLength());
    if (firstAppendOfQuery) schedulePreview();
});

previewBody.addEventListener('scroll', () => {
    if (previewLoading || previewNextChunk >= previewTotalChunks) return;
    const { scrollTop, clientHeight, scrollHeight } = previewBody;
    if (scrollTop + clientHeight >= scrollHeight - CFG.PREVIEW_PREFETCH_PX) {
        previewLoading = true;
        vscode.postMessage({ type: 'loadMorePreview', file: previewFile, chunkIndex: previewNextChunk });
    }
}, { passive: true });

// ── Highlight helpers ─────────────────────────────────────────────────────────

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Returns indices in str that greedily match the characters of query in order.
function fuzzyPositions(query, str) {
    const q = query.toLowerCase();
    const s = str.toLowerCase();
    const positions = [];
    let si = 0;
    for (let qi = 0; qi < q.length; qi++) {
        const idx = s.indexOf(q[qi], si);
        if (idx === -1) return [];
        positions.push(idx);
        si = idx + 1;
    }
    return positions;
}

// Wraps matched positions in <span class="match">, grouping consecutive runs.
function highlightChars(str, positions) {
    if (!positions.length) return escHtml(str);
    const posSet = new Set(positions);
    let html = '';
    let inMatch = false;
    for (let i = 0; i < str.length; i++) {
        const ch = escHtml(str[i]);
        if (posSet.has(i)) {
            if (!inMatch) { html += '<span class="match">'; inMatch = true; }
            html += ch;
        } else {
            if (inMatch)  { html += '</span>'; inMatch = false; }
            html += ch;
        }
    }
    if (inMatch) html += '</span>';
    return html;
}

// Highlights the first occurrence of query as a substring (for grep results).
function highlightSubstring(str, query) {
    if (!query) return escHtml(str);
    const idx = str.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escHtml(str);
    return escHtml(str.slice(0, idx))
        + `<span class="match">${escHtml(str.slice(idx, idx + query.length))}</span>`
        + escHtml(str.slice(idx + query.length));
}

// ── Row builder ───────────────────────────────────────────────────────────────

function buildRow(i) {
    const row = document.createElement('div');
    row.className = 'result-row' + (i === selectedIdx ? ' selected' : '');
    row.dataset.index = String(i);

    if (mode === 'grep') {
        const m = grepMatches[i];

        const loc = document.createElement('span');
        loc.className = 'grep-loc';
        loc.textContent = `${basename(m.file)}:${m.line}`;
        row.appendChild(loc);

        const text = document.createElement('span');
        text.className = 'grep-text';
        text.innerHTML = highlightSubstring(m.text.trimStart(), currentQuery);
        row.appendChild(text);

        const dir = dirPart(m.file);
        if (dir) {
            const d = document.createElement('span');
            d.className = 'file-dir';
            d.textContent = dir;
            row.appendChild(d);
        }
    } else {
        const file = results[i];

        const ext = extBadge(file);
        if (ext) {
            const badge = document.createElement('span');
            badge.className = 'ext-badge';
            badge.textContent = ext;
            row.appendChild(badge);
        }

        const positions  = fuzzyPositions(currentQuery, file);
        const nameStart  = file.lastIndexOf('/') + 1;
        const namePosns  = positions.filter(p => p >= nameStart).map(p => p - nameStart);
        const dirPosns   = positions.filter(p => p < nameStart);

        const name = document.createElement('span');
        name.className = 'file-name';
        name.innerHTML = highlightChars(basename(file), namePosns);
        row.appendChild(name);

        const dir = dirPart(file);
        if (dir) {
            const d = document.createElement('span');
            d.className = 'file-dir';
            d.innerHTML = highlightChars(dir, dirPosns);
            row.appendChild(d);
        }
    }

    row.addEventListener('click', () => {
        const prev = selectedIdx;
        selectedIdx = i;
        virt.selectIndex(i, prev);
        schedulePreview();
    });
    row.addEventListener('dblclick', () => { selectedIdx = i; openSelected(); });

    return row;
}

// ── Input ─────────────────────────────────────────────────────────────────────

modeBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleMode' });
    searchInput.focus();
});

searchInput.addEventListener('input', () => {
    clearTimeout(queryDebounce);
    queryDebounce = setTimeout(() => {
        vscode.postMessage({ type: 'query', value: searchInput.value });
    }, mode === 'grep' ? CFG.QUERY_DEBOUNCE_GREP_MS : CFG.QUERY_DEBOUNCE_FILES_MS);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter')     { e.preventDefault(); openSelected(); }
});

window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (maximized) {
        resetPanes();
        searchInput.focus();
    } else {
        vscode.postMessage({ type: 'close' });
    }
});

// ── Messages from extension ───────────────────────────────────────────────────

window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'setMode') {
        if (mode !== msg.mode) applyMode(msg.mode);

    } else if (msg.type === 'resultsReset') {
        // applyMode resets lastQueryId etc., so it must run BEFORE we apply the message's
        // state — otherwise the new queryId we set here gets clobbered, and every subsequent
        // append for this query is treated as stale and silently dropped.
        if (mode !== msg.mode) applyMode(msg.mode);

        lastQueryId  = msg.queryId;
        currentQuery = msg.query;
        currentFiltered = msg.filtered;

        appendQueue.clear();  // drop any in-flight appends from the previous query
        results = [];
        grepMatches = [];
        currentTotal = msg.total;
        selectedIdx = 0;
        resultsList.scrollTop = 0;
        setLoading(false);
        updateCounter();
        virt.invalidate();
        virt.setCount(0);

    } else if (msg.type === 'resultsLoading') {
        lastQueryId  = msg.queryId;
        currentQuery = msg.query;
        appendQueue.clear();
        setLoading(true);

    } else if (msg.type === 'resultsReplace') {
        if (msg.queryId !== lastQueryId) return;
        setLoading(false);
        appendQueue.clear();
        if (msg.mode === 'grep') {
            grepMatches = /** @type {any[]} */ (msg.items);
            results = [];
        } else {
            results = /** @type {string[]} */ (msg.items);
            grepMatches = [];
        }
        currentTotal    = msg.total;
        currentFiltered = true;
        selectedIdx = 0;
        resultsList.scrollTop = 0;
        updateCounter();
        virt.invalidate();
        virt.setCount(listLength());
        schedulePreview();

    } else if (msg.type === 'resultsAppend') {
        // Filter stale messages here so the queue stays small. Heavy work runs in the rAF
        // drainer below — message receipt itself must stay sub-millisecond to keep keypresses
        // responsive during streaming bursts.
        if (msg.queryId !== lastQueryId) return;
        if (mode !== msg.mode) return;
        appendQueue.push(msg);

    } else if (msg.type === 'previewContent') {
        previewTitle.textContent = msg.file;
        previewBody.innerHTML    = msg.html;
        previewFile        = msg.file;
        previewNextChunk   = msg.loadedChunks;
        previewTotalChunks = msg.totalChunks;
        previewLoading     = false;
        if (msg.line) {
            requestAnimationFrame(() => {
                const lineEl = previewBody.querySelector(`[data-line="${msg.line}"]`);
                if (lineEl) lineEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            });
        } else {
            previewBody.scrollTop = 0;
        }

    } else if (msg.type === 'previewChunk') {
        previewBody.insertAdjacentHTML('beforeend', msg.html);
        previewNextChunk = msg.chunkIndex + 1;
        previewLoading   = false;

    } else if (msg.type === 'nav') {
        switch (msg.action) {
            case 'moveDown':     move(1); break;
            case 'moveUp':       move(-1); break;
            case 'previewDown':  scrollPreviewY( previewBody.clientHeight * 0.5); break;
            case 'previewUp':    scrollPreviewY(-previewBody.clientHeight * 0.5); break;
            case 'previewLeft':  scrollPreviewX(-previewBody.clientWidth  * 0.5); break;
            case 'previewRight': scrollPreviewX( previewBody.clientWidth  * 0.5); break;
            case 'zoomLeft':     toggleMaximize('left');  break;
            case 'zoomRight':    toggleMaximize('right'); break;
        }
    }
});

// ── Mode ──────────────────────────────────────────────────────────────────────

function applyMode(newMode) {
    mode = newMode;
    modeBtn.textContent = mode;
    searchInput.value = '';
    searchInput.placeholder = mode === 'grep' ? 'Search content...' : 'Search files...';
    results = [];
    grepMatches = [];
    selectedIdx = 0;
    lastQueryId = -1;
    currentTotal = 0;
    currentFiltered = false;
    counter.textContent = '';
    virt.invalidate();
    virt.setCount(0);
    previewTitle.textContent = '';
    previewBody.innerHTML    = '';
    previewFile        = '';
    previewNextChunk   = 0;
    previewTotalChunks = 0;
    previewLoading     = false;
    searchInput.focus();
}

function setLoading(on) {
    counter.classList.toggle('loading', on);
}

function scheduleCounter() {
    clearTimeout(counterDebounce);
    counterDebounce = setTimeout(updateCounter, 50);
}

function updateCounter() {
    clearTimeout(counterDebounce);
    counterDebounce = null;
    if (mode === 'grep') {
        counter.textContent = currentTotal ? `${currentTotal} matches` : '';
    } else {
        counter.textContent = currentFiltered
            ? `${results.length} / ${currentTotal}`
            : `${currentTotal} files`;
    }
}

// ── Navigation ────────────────────────────────────────────────────────────────

function listLength() {
    return mode === 'grep' ? grepMatches.length : results.length;
}

function move(delta) {
    if (listLength() === 0) return;
    const next = Math.max(0, Math.min(listLength() - 1, selectedIdx + delta));
    if (next !== selectedIdx) {
        const prev = selectedIdx;
        selectedIdx = next;
        virt.selectIndex(next, prev);
        schedulePreview();
    }
}

function openSelected() {
    if (mode === 'grep') {
        const m = grepMatches[selectedIdx];
        if (m) vscode.postMessage({ type: 'select', file: m.file, line: m.line, col: m.col });
    } else {
        if (results[selectedIdx]) vscode.postMessage({ type: 'select', file: results[selectedIdx] });
    }
}

function schedulePreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
        if (mode === 'grep') {
            const m = grepMatches[selectedIdx];
            if (m) vscode.postMessage({ type: 'preview', file: m.file, line: m.line });
        } else {
            if (results[selectedIdx]) vscode.postMessage({ type: 'preview', file: results[selectedIdx] });
        }
    }, CFG.PREVIEW_DEBOUNCE_MS);
}

function scrollPreviewY(px) { previewBody.scrollTop  += px; }
function scrollPreviewX(px) { previewBody.scrollLeft += px; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function basename(p) { return p.split('/').pop() || p; }
function dirPart(p) {
    const parts = p.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}
function extBadge(p) {
    const name = basename(p);
    const dot  = name.lastIndexOf('.');
    if (dot < 1) return '';
    return name.slice(dot + 1).toLowerCase().slice(0, 5);
}

vscode.postMessage({ type: 'ready' });
searchInput.focus();
