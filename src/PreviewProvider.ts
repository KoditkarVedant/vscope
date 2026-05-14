import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    createHighlighter,
    bundledLanguages,
    type Highlighter,
    type BundledLanguage,
    type SpecialLanguage,
} from 'shiki';
import type { ToWebviewMessage } from './messages';
import extToLang from './ext-to-lang.json';

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
    const ext  = path.extname(base); // includes the leading dot, e.g. ".ts"

    // Special filenames — checked first, same order as code-telescope
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

    // Extension-based detection
    const lang = (extToLang as Record<string, string>)[ext];
    return (lang && BUNDLED_LANG_SET.has(lang) ? lang as BundledLanguage : 'plaintext');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── PreviewProvider ───────────────────────────────────────────────────────────

export class PreviewProvider {
    private _debounce: NodeJS.Timeout | undefined;

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void
    ) {
        getHighlighter().catch(() => { /* init failure retried per-request */ });
    }

    schedule(relPath: string, line?: number): void {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._send(relPath, line), 80);
    }

    dispose(): void {
        clearTimeout(this._debounce);
    }

    private async _send(relPath: string, line?: number): Promise<void> {
        const abs = path.join(this._workspaceRoot, relPath);
        let raw: string;
        try {
            raw = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 500).join('\n');
        } catch {
            this._post({
                type: 'previewContent',
                file: relPath,
                html: '<span style="opacity:0.5">(binary or unreadable file)</span>',
                line,
            });
            return;
        }

        let html: string;
        try {
            const hl    = await getHighlighter();
            const kind  = vscode.window.activeColorTheme.kind;
            const theme = (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight)
                ? 'light-plus'
                : 'dark-plus';

            let lang: BundledLanguage | SpecialLanguage = detectLanguage(relPath);
            if (lang !== 'plaintext' && !hl.getLoadedLanguages().includes(lang)) {
                try { await hl.loadLanguage(lang); }
                catch { lang = 'plaintext'; }
            }

            html = hl.codeToHtml(raw, {
                lang,
                theme,
                transformers: [{
                    line(node, lineNum) {
                        node.properties['data-line'] = String(lineNum);
                    },
                }],
            });
        } catch {
            html = `<pre style="padding:12px 16px;margin:0;tab-size:4">${escapeHtml(raw)}</pre>`;
        }

        this._post({ type: 'previewContent', file: relPath, html, line });
    }
}
