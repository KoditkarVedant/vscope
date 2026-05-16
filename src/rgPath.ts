import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// VS Code ships ripgrep internally — resolve to its absolute path so spawn works regardless
// of the user's PATH (notably broken on macOS when VS Code is launched from Finder/Spotlight,
// where /opt/homebrew/bin and /usr/local/bin are absent from the inherited env).
//
// Falls back to the bare command name, letting Node's PATH lookup find a system install.

let _cached: string | null = null;

export function getRgPath(): string {
    if (_cached) return _cached;

    const appRoot = vscode.env.appRoot;
    const exe     = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const candidates = [
        // Newer VS Code builds unpack native binaries out of the asar.
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exe),
        path.join(appRoot, 'node_modules',               '@vscode', 'ripgrep', 'bin', exe),
        path.join(appRoot, 'node_modules',               'vscode-ripgrep',     'bin', exe),
    ];

    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            _cached = candidate;
            return candidate;
        } catch { /* try next */ }
    }

    _cached = exe;
    return _cached;
}
