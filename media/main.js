// @ts-check
/// <reference lib="dom" />

const vscode = acquireVsCodeApi();

// ── Constants ─────────────────────────────────────────────────────────────────

const ITEM_HEIGHT = 28; // must match .result-row height in style.css
const BUFFER      = 8;  // extra rows rendered above/below the visible window

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {'files' | 'grep'} */
let mode = 'files';

/** @type {string[]} */
let results = [];

/** @type {Array<{file:string, line:number, col:number, text:string}>} */
let grepMatches = [];

let selectedIdx  = 0;
let lastQueryId  = -1;
let currentQuery = '';

// ── Preview chunk state ───────────────────────────────────────────────────────

let previewFile        = '';
let previewNextChunk   = 0;
let previewTotalChunks = 0;
let previewLoading     = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let queryDebounce   = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let previewDebounce = null;

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

    /** Call after results array changes. */
    setCount(n) {
        this.count = n;
        spacer.style.height = `${n * ITEM_HEIGHT}px`;
        this.render();
    },

    /** Navigate to index: scroll if needed, then re-render. */
    navigateTo(index) {
        const top    = index * ITEM_HEIGHT;
        const bottom = top + ITEM_HEIGHT;
        const { scrollTop, clientHeight } = resultsList;
        if (top < scrollTop) {
            resultsList.scrollTop = top;
        } else if (bottom > scrollTop + clientHeight) {
            resultsList.scrollTop = bottom - clientHeight;
        }
        this.render();
    },

    render() {
        const { scrollTop, clientHeight } = resultsList;
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
        const end   = Math.min(this.count, Math.ceil((scrollTop + clientHeight) / ITEM_HEIGHT) + BUFFER);

        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
            const row = buildRow(i);
            row.style.cssText =
                `position:absolute;top:${i * ITEM_HEIGHT}px;left:0;right:0;height:${ITEM_HEIGHT}px;`;
            frag.appendChild(row);
        }
        spacer.innerHTML = '';
        spacer.appendChild(frag);
    },
};

resultsList.addEventListener('scroll', () => virt.render(), { passive: true });

previewBody.addEventListener('scroll', () => {
    if (previewLoading || previewNextChunk >= previewTotalChunks) return;
    const { scrollTop, clientHeight, scrollHeight } = previewBody;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
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
        selectedIdx = i;
        virt.render();
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
    }, 60);
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
        applyMode(msg.mode);

    } else if (msg.type === 'results') {
        const isNewQuery = msg.queryId !== lastQueryId;
        lastQueryId  = msg.queryId;
        currentQuery = msg.query;

        if (mode !== msg.mode) applyMode(msg.mode);

        if (msg.mode === 'grep') {
            grepMatches = msg.matches;
            counter.textContent = `${msg.total} matches`;
        } else {
            results = msg.files;
            counter.textContent = msg.filtered
                ? `${results.length} / ${msg.total}`
                : `${msg.total} files`;
        }

        // Only jump to top when a genuinely new query starts
        if (isNewQuery) {
            selectedIdx = 0;
            resultsList.scrollTop = 0;
        }

        virt.setCount(listLength());
        schedulePreview();

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
    counter.textContent = '';
    spacer.innerHTML = '';
    spacer.style.height = '0';
    previewTitle.textContent = '';
    previewBody.innerHTML    = '';
    previewFile        = '';
    previewNextChunk   = 0;
    previewTotalChunks = 0;
    previewLoading     = false;
    searchInput.focus();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function listLength() {
    return mode === 'grep' ? grepMatches.length : results.length;
}

function move(delta) {
    if (listLength() === 0) return;
    const next = Math.max(0, Math.min(listLength() - 1, selectedIdx + delta));
    if (next !== selectedIdx) {
        selectedIdx = next;
        virt.navigateTo(next);
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
    }, 80);
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
