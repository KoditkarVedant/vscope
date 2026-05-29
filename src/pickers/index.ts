import type { PickerSource } from './Picker';
import { createFilesPicker } from './files/host';
import { createGrepPicker } from './grep/host';
import type { GrepMatch } from '../messages';

export interface PickerRegistry {
    files: PickerSource<string>;
    grep:  PickerSource<GrepMatch>;
    // references will join this registry in the next commit.
}

export function createPickerRegistry(workspaceRoot: string): PickerRegistry {
    return {
        files: createFilesPicker(workspaceRoot),
        grep:  createGrepPicker(workspaceRoot),
    };
}
