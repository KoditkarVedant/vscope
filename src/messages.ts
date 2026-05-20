export type PanelMode = 'files' | 'grep';

export interface GrepMatch {
    file: string;
    line: number;
    col: number;     // 1-indexed byte offset of match start within line
    length: number;  // byte length of the matched text
    text: string;
}

// ── Webview → Extension ───────────────────────────────────────────────────────

export type FromWebviewMessage =
    | { type: 'query';           value: string }
    | { type: 'preview';         file: string; line?: number; col?: number; length?: number }
    | { type: 'select';          file: string; line?: number; col?: number }
    | { type: 'loadMorePreview'; file: string; chunkIndex: number }
    | { type: 'ready' }
    | { type: 'toggleMode' }
    | { type: 'close' };

// ── Extension → Webview ───────────────────────────────────────────────────────

export type ToWebviewMessage =
    | { type: 'setMode';          mode: PanelMode }
    | { type: 'resultsReset';     queryId: number; mode: PanelMode; query: string; filtered: boolean; total: number }
    | { type: 'resultsAppend';    queryId: number; mode: 'files'; items: string[]; total: number }
    | { type: 'resultsAppend';    queryId: number; mode: 'grep';  items: GrepMatch[]; total: number }
    | { type: 'resultsLoading';   queryId: number; query: string }
    | { type: 'resultsReplace';   queryId: number; mode: PanelMode; items: string[] | GrepMatch[]; total: number }
    | { type: 'resultsDone';      queryId: number }
    | { type: 'previewContent';   file: string; html: string; totalChunks: number; loadedChunks: number; line?: number }
    | { type: 'previewChunk';     file: string; html: string; chunkIndex: number }
    | { type: 'nav';              action: string };
