// @ts-check
/// <reference lib="dom" />

const vscode = acquireVsCodeApi();

/** @type {string[]} */
let results = [];
let selectedIdx = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let queryDebounce = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let previewDebounce = null;

const searchInput  = /** @type {HTMLInputElement} */ (document.getElementById('search-input'));
const resultsList  = /** @type {HTMLElement} */ (document.getElementById('results'));
const previewTitle = /** @type {HTMLElement} */ (document.getElementById('preview-title'));
const previewBody  = /** @type {HTMLElement} */ (document.getElementById('preview-body'));
const counter      = /** @type {HTMLElement} */ (document.getElementById('counter'));

// ── Input: send debounced query to extension ──────────────────────────────────

searchInput.addEventListener('input', () => {
    clearTimeout(queryDebounce);
    queryDebounce = setTimeout(() => {
        vscode.postMessage({ type: 'query', value: searchInput.value });
    }, 60);
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
//
//   Conflicting keys (Ctrl+J/N/P/D/U/F/K) are intercepted by VS Code via
//   keybinding overrides in package.json and arrive here as 'nav' messages.
//   Non-conflicting keys are handled directly below.

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        openSelected();
    } else if (e.key === 'Escape') {
        vscode.postMessage({ type: 'close' });
    }
});

// ── Messages from extension ───────────────────────────────────────────────────

window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'results') {
        results = msg.files;
        selectedIdx = 0;           // always highlight the first match
        counter.textContent = msg.filtered
            ? `${results.length} / ${msg.total}`
            : `${msg.total} files`;
        renderList();
        schedulePreview();
    } else if (msg.type === 'previewContent') {
        previewTitle.textContent = msg.file;
        previewBody.textContent = msg.content;
        previewBody.scrollTop = 0;
    } else if (msg.type === 'nav') {
        switch (msg.action) {
            case 'moveDown':    move(1); break;
            case 'moveUp':      move(-1); break;
            case 'previewDown': scrollPreviewY(previewBody.clientHeight * 0.5); break;
            case 'previewUp':   scrollPreviewY(-previewBody.clientHeight * 0.5); break;
            case 'previewLeft': scrollPreviewX(-previewBody.clientWidth * 0.5); break;
            case 'previewRight':scrollPreviewX(previewBody.clientWidth * 0.5); break;
        }
    }
});

// ── Navigation ────────────────────────────────────────────────────────────────

function move(delta) {
    if (results.length === 0) return;
    selectedIdx = Math.max(0, Math.min(results.length - 1, selectedIdx + delta));
    renderList();
    schedulePreview();
}

function openSelected() {
    if (results[selectedIdx]) {
        vscode.postMessage({ type: 'select', file: results[selectedIdx] });
    }
}

function schedulePreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
        if (results[selectedIdx]) {
            vscode.postMessage({ type: 'preview', file: results[selectedIdx] });
        }
    }, 80);
}

function scrollPreviewY(px) {
    previewBody.scrollTop += px;
}

function scrollPreviewX(px) {
    previewBody.scrollLeft += px;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderList() {
    resultsList.innerHTML = '';
    if (results.length === 0) return;

    const fragment = document.createDocumentFragment();

    results.forEach((file, i) => {
        const row = document.createElement('div');
        row.className = 'result-row' + (i === selectedIdx ? ' selected' : '');

        const ext = extBadge(file);
        if (ext) {
            const badge = document.createElement('span');
            badge.className = 'ext-badge';
            badge.textContent = ext;
            row.appendChild(badge);
        }

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = basename(file);
        row.appendChild(name);

        const dir = dirPart(file);
        if (dir) {
            const dirSpan = document.createElement('span');
            dirSpan.className = 'file-dir';
            dirSpan.textContent = dir;
            row.appendChild(dirSpan);
        }

        row.addEventListener('click', () => {
            selectedIdx = i;
            openSelected();
        });

        row.addEventListener('mouseover', () => {
            if (selectedIdx !== i) {
                selectedIdx = i;
                renderList();
                schedulePreview();
            }
        });

        fragment.appendChild(row);
    });

    resultsList.appendChild(fragment);

    // Keep the selected row visible without jumping
    const sel = resultsList.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function basename(p) {
    return p.split('/').pop() || p;
}

function dirPart(p) {
    const parts = p.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function extBadge(p) {
    const name = basename(p);
    const dot = name.lastIndexOf('.');
    if (dot < 1) return '';
    return name.slice(dot + 1).toLowerCase().slice(0, 5);
}

// autofocus can be unreliable in webviews
searchInput.focus();
