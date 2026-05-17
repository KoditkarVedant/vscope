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
    const cfg         = vscode.workspace.getConfiguration('vscope.files');
    const showHidden  = cfg.get<boolean>('showHidden', true);
    const respectGit  = cfg.get<boolean>('respectGitignore', true);
    const exclude     = cfg.get<string[]>('exclude', []);

    const args: string[] = ['--files'];
    if (showHidden)  args.push('--hidden');
    if (!respectGit) args.push('--no-ignore');
    args.push('--glob', '!.git');
    for (const pattern of exclude) {
        args.push('--glob', `!${pattern}`);
    }
    args.push('--', '.');

    try {
        let yieldedAny = false;
        for await (const chunk of streamLines({
            cmd: getRgPath(),
            args,
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
