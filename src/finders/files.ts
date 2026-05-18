import * as path from 'path';
import * as vscode from 'vscode';
import { getRgPath } from '../rgPath';
import { streamLines } from './lineStreamer';
import { readRgFilesConfig, buildRgFilesArgs } from './rgFilesArgs';

export async function* streamFiles(
    workspaceRoot: string,
    signal?: AbortSignal
): AsyncGenerator<string[]> {
    const config = readRgFilesConfig();
    const args   = buildRgFilesArgs(config);

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

    const { showHidden, exclude } = config;
    const includePattern = showHidden ? '**/*' : '**/[^.]*';
    const excludePattern = exclude.length ? `{${exclude.join(',')}}` : undefined;

    const uris = await vscode.workspace.findFiles(includePattern, excludePattern);
    if (signal?.aborted) return;
    const files = uris.map((u) => path.relative(workspaceRoot, u.fsPath).replace(/\\/g, '/'));
    if (files.length > 0) yield files;
}

function normalize(line: string): string {
    return line.replace(/\\/g, '/');
}
