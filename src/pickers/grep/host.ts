import { runGrep } from '../../finders/text';
import type { GrepMatch } from '../../messages';
import type { PickerSource } from '../Picker';

export function createGrepPicker(workspaceRoot: string): PickerSource<GrepMatch> {
    return {
        id: 'grep',
        query: (value, signal) => runGrep(value, workspaceRoot, signal),
    };
}
