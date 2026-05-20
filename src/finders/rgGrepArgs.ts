import * as vscode from 'vscode';

export interface RgGrepConfig {
    showHidden:     boolean;
    respectGit:     boolean;
    exclude:        string[];
    additionalArgs: string[];
}

export function readRgGrepConfig(): RgGrepConfig {
    const cfg = vscode.workspace.getConfiguration('vscope.liveGrep');
    return {
        showHidden:     cfg.get<boolean>('showHidden', true),
        respectGit:     cfg.get<boolean>('respectGitignore', true),
        exclude:        cfg.get<string[]>('exclude', []),
        additionalArgs: cfg.get<string[]>('additionalArgs', []),
    };
}

export function buildRgGrepArgs(config: RgGrepConfig, query: string): string[] {
    const args: string[] = ['--json', '--smart-case'];
    if (config.showHidden)  args.push('--hidden');
    if (!config.respectGit) args.push('--no-ignore');
    args.push('--glob', '!.git');
    for (const pattern of config.exclude) {
        args.push('--glob', `!${pattern}`);
    }
    args.push(...config.additionalArgs);
    args.push('--', query, '.');
    return args;
}
