import * as vscode from 'vscode';

export interface RgFilesConfig {
    showHidden:     boolean;
    respectGit:     boolean;
    exclude:        string[];
    additionalArgs: string[];
}

export function readRgFilesConfig(): RgFilesConfig {
    const cfg = vscode.workspace.getConfiguration('vscope.findFiles');
    return {
        showHidden:     cfg.get<boolean>('showHidden', true),
        respectGit:     cfg.get<boolean>('respectGitignore', true),
        exclude:        cfg.get<string[]>('exclude', []),
        additionalArgs: cfg.get<string[]>('additionalArgs', []),
    };
}

export function buildRgFilesArgs(config: RgFilesConfig): string[] {
    const args: string[] = ['--files'];
    if (config.showHidden)  args.push('--hidden');
    if (!config.respectGit) args.push('--no-ignore');
    args.push('--glob', '!.git');
    for (const pattern of config.exclude) {
        args.push('--glob', `!${pattern}`);
    }
    args.push(...config.additionalArgs);
    args.push('--', '.');
    return args;
}
