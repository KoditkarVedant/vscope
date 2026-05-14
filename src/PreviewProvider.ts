import * as fs from 'fs';
import * as path from 'path';
import type { ToWebviewMessage } from './messages';

export class PreviewProvider {
    private _debounce: NodeJS.Timeout | undefined;

    constructor(
        private readonly _workspaceRoot: string,
        private readonly _post: (msg: ToWebviewMessage) => void
    ) {}

    schedule(relPath: string, line?: number): void {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._send(relPath, line), 80);
    }

    dispose(): void {
        clearTimeout(this._debounce);
    }

    private _send(relPath: string, line?: number): void {
        const abs = path.join(this._workspaceRoot, relPath);
        let content: string;
        try {
            content = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 500).join('\n');
        } catch {
            content = '(binary or unreadable file)';
        }
        this._post({ type: 'previewContent', file: relPath, content, line });
    }
}
