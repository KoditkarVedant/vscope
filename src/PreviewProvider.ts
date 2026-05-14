import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    createHighlighter,
    bundledLanguages,
    type Highlighter,
    type BundledLanguage,
    type SpecialLanguage,
    type ThemedToken,
    type GrammarState,
} from 'shiki';
import type { ToWebviewMessage } from './messages';
import extToLang from './ext-to-lang.json';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_LINES    = 100; // lines per rendered chunk
const MAX_FILE_CACHE = 5;   // max files kept in memory

// ── Highlighter singleton ─────────────────────────────────────────────────────

const BUNDLED_LANG_SET = new Set<string>(Object.keys(bundledLanguages));

let _hl: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
    if (!_hl) {
        _hl = createHighlighter({
            themes: ['dark-plus', 'light-plus'],
            langs:  [],
        }).catch((e) => { _hl = null; throw e; });
    }
    return _hl;
}

// ── Language detection ────────────────────────────────────────────────────────

function detectLanguage(filePath: string): BundledLanguage | SpecialLanguage {
    const base = path.basename(filePath).toLowerCase();
    const ext  = path.extname(base);

    if (base === 'makefile'   || base.startsWith('makefile.'))                             return 'makefile';
    if (base === 'dockerfile' || base.startsWith('dockerfile.'))                            return 'dockerfile';
    if (base === '.gitignore' || base === '.dockerignore' || base === '.prettierignore')    return 'plaintext';
    if (base === '.gitattributes')                                                           return 'plaintext';
    if (base === '.env'       || base.startsWith('.env.'))                                  return 'dotenv';
    if (base === '.editorconfig')                                                            return 'ini';
    if (base === '.prettierrc' || base === '.eslintrc' || base === '.babelrc')              return 'json';
    if (base === '.npmrc'     || base === '.yarnrc')                                        return 'ini';
    if (base === '.bashrc'    || base === '.bash_profile' || base === '.zshrc' || base === '.profile') return 'shellscript';
    if (base === 'gemfile'    || base === 'rakefile' || base === 'podfile' || base === 'vagrantfile') return 'ruby';
    if (base === 'cmakelists.txt')                                                           return 'cmake';
    if (base === 'gradlew')                                                                  return 'shellscript';

    const lang = (extToLang as Record<string, string>)[ext];
    return (lang && BUNDLED_LANG_SET.has(lang) ? lang as BundledLanguage : 'plaintext');
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tokenStyle(t: ThemedToken): string {
    const parts: string[] = [];
    if (t.color) parts.push(`color:${t.color}`);
    const fs = t.fontStyle ?? 0;
    if (fs & 1) parts.push('font-style:italic');
    if (fs & 2) parts.push('font-weight:bold');
    if (fs & 4) parts.push('text-decoration:underline');
    return parts.join(';');
}

function buildChunkHtml(
    tokens:    ThemedToken[][],
    fg:        string,
    bg:        string,
    theme:     string,
    startLine: number   // 1-indexed absolute line number of first line in this chunk
): string {
    const lines = tokens.map((lineTokens, i) => {
        const num   = startLine + i;
        const spans = lineTokens.map(t => {
            const style = tokenStyle(t);
            return style
                ? `<span style="${style}">${escapeHtml(t.content)}</span>`
                : escapeHtml(t.content);
        }).join('');
        return `<span data-line="${num}">${spans}</span>`;
    }).join('\n');

    return `<pre class="shiki ${theme}" style="background-color:${bg};color:${fg}"><code>${lines}\n</code></pre>`;
}

// ── File cache ────────────────────────────────────────────────────────────────

interface FileCache {
    chunks:        string[];
    grammarStates: (GrammarState | undefined)[];
    fg:            string;
    bg:            string;
    lang:          BundledLanguage | SpecialLanguage;
    theme:         string;
}

// ── PreviewProvider ───────────────────────────────────────────────────────────

export class PreviewProvider {
    private _debounce: NodeJS.Timeout | undefined;
    private _cache = new Map<string, FileCache>();

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void
    ) {
        getHighlighter().catch(() => {});
    }

    schedule(relPath: string, line?: number): void {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._sendInitial(relPath, line), 80);
    }

    async loadChunk(relPath: string, chunkIndex: number): Promise<void> {
        const cache = this._cache.get(relPath);
        if (!cache || chunkIndex >= cache.chunks.length) return;

        const html = await this._renderChunk(cache, chunkIndex);
        this._post({ type: 'previewChunk', file: relPath, html, chunkIndex });
    }

    dispose(): void {
        clearTimeout(this._debounce);
    }

    private async _sendInitial(relPath: string, line?: number): Promise<void> {
        const abs = path.join(this._workspaceRoot, relPath);
        let raw: string;
        try {
            raw = fs.readFileSync(abs, 'utf8');
        } catch {
            this._post({
                type: 'previewContent',
                file: relPath,
                html: '<span style="opacity:0.5">(binary or unreadable file)</span>',
                totalChunks: 1,
                loadedChunks: 1,
            });
            return;
        }

        const hl    = await getHighlighter();
        const kind  = vscode.window.activeColorTheme.kind;
        const theme = (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight)
            ? 'light-plus' : 'dark-plus';

        let lang: BundledLanguage | SpecialLanguage = detectLanguage(relPath);
        if (lang !== 'plaintext' && !hl.getLoadedLanguages().includes(lang)) {
            try { await hl.loadLanguage(lang); }
            catch { lang = 'plaintext'; }
        }

        // Split file into fixed-size line chunks
        const allLines = raw.split('\n');
        const chunks: string[] = [];
        for (let i = 0; i < allLines.length; i += CHUNK_LINES) {
            chunks.push(allLines.slice(i, i + CHUNK_LINES).join('\n'));
        }

        // Probe first chunk to get fg/bg from the theme
        const probe = hl.codeToTokens(chunks[0] ?? '', { lang, theme });

        const cache: FileCache = {
            chunks,
            grammarStates: new Array(chunks.length).fill(undefined),
            fg:   probe.fg ?? '',
            bg:   probe.bg ?? '',
            lang,
            theme,
        };
        cache.grammarStates[0] = probe.grammarState;

        // LRU: evict oldest entry when over the limit
        this._cache.set(relPath, cache);
        if (this._cache.size > MAX_FILE_CACHE) {
            this._cache.delete(this._cache.keys().next().value!);
        }

        // Render chunks 0..targetChunk so the target line is immediately visible
        const targetChunk = line
            ? Math.min(Math.floor((line - 1) / CHUNK_LINES), chunks.length - 1)
            : 0;

        let html = '';
        for (let i = 0; i <= targetChunk; i++) {
            html += await this._renderChunk(cache, i);
        }

        this._post({
            type: 'previewContent',
            file: relPath,
            html,
            totalChunks:  chunks.length,
            loadedChunks: targetChunk + 1,
            line,
        });
    }

    private async _renderChunk(cache: FileCache, chunkIndex: number): Promise<string> {
        const { chunks, grammarStates, fg, bg, lang, theme } = cache;
        const prevState = chunkIndex > 0 ? grammarStates[chunkIndex - 1] : undefined;
        const startLine = chunkIndex * CHUNK_LINES + 1; // absolute, 1-indexed

        const hl = await getHighlighter();

        // Single tokenisation pass: gives us both tokens (for HTML) and the
        // grammar state needed by the next chunk.
        const { tokens, grammarState: nextState } = hl.codeToTokens(
            chunks[chunkIndex],
            { lang, theme, grammarState: prevState }
        );
        grammarStates[chunkIndex] = nextState;

        return buildChunkHtml(tokens, fg, bg, theme, startLine);
    }
}
