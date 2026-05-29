import * as vscode from 'vscode';
import { getReferences } from '../../finders/references';
import type { GrepMatch } from '../../messages';
import type { PickerSource } from '../Picker';

export interface ReferencesContext {
    uri: vscode.Uri;
    position: vscode.Position;
}

export function createReferencesPicker(workspaceRoot: string): PickerSource<GrepMatch, ReferencesContext> {
    return {
        id: 'references',
        load: (ctx, signal) => getReferences(ctx.uri, ctx.position, workspaceRoot, signal),
    };
}
