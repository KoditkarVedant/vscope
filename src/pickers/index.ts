import type { PickerSource } from './Picker';
import { createFilesPicker } from './files/host';
import { createGrepPicker } from './grep/host';
import { createReferencesPicker, type ReferencesContext } from './references/host';
import type { GrepMatch } from '../messages';

export type { ReferencesContext };

export interface PickerRegistry {
    files:      PickerSource<string>;
    grep:       PickerSource<GrepMatch>;
    references: PickerSource<GrepMatch, ReferencesContext>;
}

export function createPickerRegistry(workspaceRoot: string): PickerRegistry {
    return {
        files:      createFilesPicker(workspaceRoot),
        grep:       createGrepPicker(workspaceRoot),
        references: createReferencesPicker(workspaceRoot),
    };
}
