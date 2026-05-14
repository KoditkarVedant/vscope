export type PanelMode = 'files' | 'grep';

export interface GrepMatch {
    file: string;
    line: number;
    col: number;
    text: string;
}

// ── Webview → Extension ───────────────────────────────────────────────────────

export type FromWebviewMessage =
    | { type: 'query';           value: string }
    | { type: 'preview';         file: string; line?: number }
    | { type: 'select';          file: string; line?: number; col?: number }
    | { type: 'loadMorePreview'; file: string; chunkIndex: number }
    | { type: 'ready' }
    | { type: 'toggleMode' }
    | { type: 'close' };

// ── Extension → Webview ───────────────────────────────────────────────────────

export type ToWebviewMessage =
    | { type: 'setMode';        mode: PanelMode }
    | { type: 'results';        mode: 'files'; files: string[]; total: number; filtered: boolean; queryId: number }
    | { type: 'results';        mode: 'grep';  matches: GrepMatch[]; total: number; queryId: number }
    | { type: 'previewContent'; file: string; html: string; totalChunks: number; loadedChunks: number; line?: number }
    | { type: 'previewChunk';   file: string; html: string; chunkIndex: number }
    | { type: 'nav';            action: string };
