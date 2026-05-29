import type { PickerSource } from './Picker';
import { createFilesPicker } from './files/host';

export interface PickerRegistry {
    files: PickerSource<string>;
    // grep and references will join this registry in follow-up commits.
}

export function createPickerRegistry(workspaceRoot: string): PickerRegistry {
    return {
        files: createFilesPicker(workspaceRoot),
    };
}
