import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createHighlighterCore } from '@shikijs/core';
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma';
import getWasm from '@shikijs/engine-oniguruma/wasm-inlined';
import darkPlus  from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';
import type { HighlighterCore, SpecialLanguage, ThemedToken, GrammarState, ThemeRegistrationRaw } from '@shikijs/core';
import type { ToWebviewMessage } from './messages';
import extToLang from './ext-to-lang.json';
import { BUNDLED_LANGS, BUNDLED_LANG_SET } from './shikiLangs';

type BundledLanguage = string;

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_LINES    = 100; // lines per rendered chunk
const MAX_FILE_CACHE = 5;   // max files kept in memory

// ── Highlighter singleton ─────────────────────────────────────────────────────

let _hl: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
    if (!_hl) {
        _hl = createHighlighterCore({
            themes: [darkPlus, lightPlus],
            langs:  BUNDLED_LANGS,
            engine: createOnigurumaEngine(getWasm),
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
    // detectLanguage is always called after getHighlighter resolves (see _sendInitial), so
    // _bundledLangSet is populated. If unexpectedly called earlier, fall through to plaintext.
    return (lang && BUNDLED_LANG_SET.has(lang) ? lang as BundledLanguage : 'plaintext');
}

// ── JSONC helpers ─────────────────────────────────────────────────────────────

// Strips // and /* */ comments without mangling strings, then removes trailing commas.
function stripJsonc(text: string): string {
    let out = '';
    let i   = 0;
    while (i < text.length) {
        if (text[i] === '"') {
            out += '"';
            i++;
            while (i < text.length) {
                if (text[i] === '\\') {
                    out += text[i] + (text[i + 1] ?? '');
                    i += 2;
                } else if (text[i] === '"') {
                    out += '"';
                    i++;
                    break;
                } else {
                    out += text[i++];
                }
            }
        } else if (text[i] === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
        } else if (text[i] === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
        } else {
            out += text[i++];
        }
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
}

// ── Theme resolution ──────────────────────────────────────────────────────────

type ThemeJson = ThemeRegistrationRaw & { include?: string; colors?: Record<string, string>; tokenColors?: unknown[] };

function readThemeFile(filePath: string): ThemeJson | null {
    try {
        return JSON.parse(stripJsonc(fs.readFileSync(filePath, 'utf8'))) as ThemeJson;
    } catch {
        return null;
    }
}

// Loads a theme JSON and merges one level of `include` (relative path sibling).
function loadThemeJson(filePath: string): ThemeJson | null {
    const obj = readThemeFile(filePath);
    if (!obj) return null;

    if (obj.include) {
        const basePath = path.resolve(path.dirname(filePath), obj.include);
        const base     = readThemeFile(basePath);
        if (base) {
            return {
                ...base,
                ...obj,
                tokenColors: [...(base.tokenColors ?? []), ...(obj.tokenColors ?? [])],
                colors:      { ...(base.colors      ?? {}), ...(obj.colors      ?? {}) },
            };
        }
    }
    return obj;
}

// Walks vscode.extensions.all looking for the theme whose label or id matches.
function findThemeFilePath(themeName: string): string | null {
    for (const ext of vscode.extensions.all) {
        const themes: { label?: string; id?: string; path?: string }[] =
            ext.packageJSON?.contributes?.themes ?? [];
        for (const t of themes) {
            if ((t.label === themeName || t.id === themeName) && t.path) {
                return path.join(ext.extensionPath, t.path);
            }
        }
    }
    return null;
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
    private _debounce:      NodeJS.Timeout | undefined;
    private _cache          = new Map<string, FileCache>();
    private _loadedThemes   = new Set<string>();
    private _themeListener: vscode.Disposable;

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void
    ) {
        getHighlighter().catch(() => {});

        // Invalidate cache whenever the user switches themes so the next
        // preview request re-renders with the new colors.
        this._themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
            this._loadedThemes.clear();
            this._cache.clear();
        });
    }

    schedule(relPath: string, line?: number, col?: number, length?: number): void {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._sendInitial(relPath, line, col, length), 80);
    }

    async loadChunk(relPath: string, chunkIndex: number): Promise<void> {
        const cache = this._cache.get(relPath);
        if (!cache || chunkIndex >= cache.chunks.length) return;

        const html = await this._renderChunk(cache, chunkIndex);
        this._post({ type: 'previewChunk', file: relPath, html, chunkIndex });
    }

    dispose(): void {
        clearTimeout(this._debounce);
        this._themeListener.dispose();
    }

    // Returns the Shiki theme name to use, loading the user's active VS Code
    // theme from disk when possible and falling back to built-in dark/light.
    private async _resolveTheme(): Promise<string> {
        const themeName    = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
        const kind         = vscode.window.activeColorTheme.kind;
        const builtinTheme = (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight)
            ? 'light-plus' : 'dark-plus';

        if (!themeName) return builtinTheme;
        if (this._loadedThemes.has(themeName)) return themeName;

        const filePath = findThemeFilePath(themeName);
        if (!filePath) return builtinTheme;

        const themeJson = loadThemeJson(filePath);
        if (!themeJson) return builtinTheme;

        try {
            const hl = await getHighlighter();
            await hl.loadTheme({ ...themeJson, name: themeName });
            this._loadedThemes.add(themeName);
            return themeName;
        } catch {
            return builtinTheme;
        }
    }

    private async _sendInitial(relPath: string, line?: number, _col?: number, _length?: number): Promise<void> {
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
        const theme = await this._resolveTheme();

        const lang: BundledLanguage | SpecialLanguage = detectLanguage(relPath);

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
