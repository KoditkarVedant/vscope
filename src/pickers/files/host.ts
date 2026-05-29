import { streamFiles } from '../../finders/files';
import { fuzzyFiles } from '../../finders/fuzzyFiles';
import type { PickerSource } from '../Picker';

export function createFilesPicker(workspaceRoot: string): PickerSource<string> {
    return {
        id: 'files',
        browse: (signal) => streamFiles(workspaceRoot, signal),
        async *query(value, signal) {
            const items = await fuzzyFiles(workspaceRoot, value, signal);
            if (signal.aborted) return;
            yield items;
        },
    };
}
