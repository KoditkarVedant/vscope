import * as path from 'path';
import * as vscode from 'vscode';
import { getRgPath } from '../rgPath';
import { streamLines } from './lineStreamer';

/**
 * Stream workspace files as delta chunks.
 * Primary: rg --files (respects .gitignore).
 * Fallback: vscode.workspace.findFiles (single emit).
 */
export async function* streamFiles(
    workspaceRoot: string,
    signal?: AbortSignal
): AsyncGenerator<string[]> {
    try {
        let yieldedAny = false;
        for await (const chunk of streamLines({
            cmd: getRgPath(),
            args: ['--files', '--hidden', '--glob', '!.git', '--', '.'],
            cwd: workspaceRoot,
            signal,
            chunkSize: (isFirst, count) => {
                if (isFirst) return 200;
                if (count < 10_000) return 5_000;
                return 20_000;
            },
        })) {
            yieldedAny = true;
            yield chunk.map(normalize);
        }
        if (yieldedAny) return;
    } catch {
        // fall through to vscode API
    }

    if (signal?.aborted) return;

    const uris = await vscode.workspace.findFiles(
        '**/*',
        '{**/node_modules/**,**/.git/**}',
        20_000
    );
    if (signal?.aborted) return;
    const files = uris.map((u) => path.relative(workspaceRoot, u.fsPath).replace(/\\/g, '/'));
    if (files.length > 0) yield files;
}

function normalize(line: string): string {
    return line.replace(/\\/g, '/');
}
