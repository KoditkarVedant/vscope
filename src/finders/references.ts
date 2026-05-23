import * as path from 'path';
import * as vscode from 'vscode';
import type { GrepMatch } from '../messages';
import { logError } from '../logger';

export async function getReferences(
    uri: vscode.Uri,
    position: vscode.Position,
    workspaceRoot: string,
    signal?: AbortSignal
): Promise<GrepMatch[]> {
    if (signal?.aborted) return [];

    let locations: vscode.Location[] | undefined;
    try {
        locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );
    } catch (err) {
        logError('references.executeReferenceProvider', err);
        return [];
    }
    if (!locations || signal?.aborted) return [];

    const byFile = new Map<string, vscode.Range[]>();
    for (const loc of locations) {
        const key = loc.uri.toString();
        const arr = byFile.get(key) ?? [];
        arr.push(loc.range);
        byFile.set(key, arr);
    }

    const out: GrepMatch[] = [];
    for (const [uriStr, ranges] of byFile) {
        if (signal?.aborted) return [];
        const fileUri = vscode.Uri.parse(uriStr);
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(fileUri);
        } catch (err) {
            logError('references.openTextDocument', err);
            continue;
        }
        for (const range of ranges) {
            const lineText = doc.lineAt(range.start.line).text;
            out.push({
                file: toRelative(fileUri.fsPath, workspaceRoot),
                line: range.start.line + 1,
                col: range.start.character + 1,
                length: rangeLengthOnStartLine(range, lineText),
                text: lineText,
            });
        }
    }

    return out;
}

function toRelative(absPath: string, workspaceRoot: string): string {
    const rel = path.relative(workspaceRoot, absPath);
    return rel.replace(/\\/g, '/');
}

function rangeLengthOnStartLine(range: vscode.Range, lineText: string): number {
    if (range.start.line === range.end.line) {
        return Math.max(0, range.end.character - range.start.character);
    }
    return Math.max(0, lineText.length - range.start.character);
}
