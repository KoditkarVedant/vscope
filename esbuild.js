// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch      = process.argv.includes('--watch');

/**
 * Emits "[watch] build started/finished" markers so the VS Code task problem matcher
 * can detect when a watch-mode rebuild begins and ends. Without these, F5's preLaunchTask
 * waits forever for a "started" signal that esbuild doesn't emit on its own.
 */
const problemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(/** @type {import('esbuild').PluginBuild} */ build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            for (const { text, location } of result.errors) {
                console.error(`✘ [ERROR] ${text}`);
                if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
            }
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    // Extension host bundle — runs in VS Code's Node process.
    const hostCtx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle:      true,
        format:      'cjs',
        platform:    'node',
        target:      'node16',
        outfile:     'out/extension.js',
        external:    ['vscode'],
        sourcemap:   !production,
        minify:      production,
        logLevel:    'info',
        plugins:     [problemMatcherPlugin],
    });

    // Webview bundle — runs in the Chromium webview. IIFE so the output is a single
    // classic script with no module syntax, which lets the CSP stay nonce-only (no
    // strict-dynamic) and the script tag stay plain `<script src=...>`.
    const webviewCtx = await esbuild.context({
        entryPoints: ['src/webview/main.js'],
        bundle:      true,
        format:      'iife',
        platform:    'browser',
        target:      'es2020',
        outfile:     'out/webview/main.js',
        sourcemap:   !production,
        minify:      production,
        logLevel:    'info',
    });

    if (watch) {
        await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
    } else {
        await Promise.all([hostCtx.rebuild(), webviewCtx.rebuild()]);
        await Promise.all([hostCtx.dispose(), webviewCtx.dispose()]);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
