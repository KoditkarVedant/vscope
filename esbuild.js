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
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle:      true,
        format:      'cjs',
        platform:    'node',
        target:      'node16',
        outfile:     'out/extension.js',
        // Keep shiki out of the bundle — it weighs ~10MB and is only needed once a preview
        // is first opened. Resolved from node_modules at runtime via require().
        external:    ['vscode', 'shiki'],
        sourcemap:   !production,
        minify:      production,
        logLevel:    'info',
        plugins:     [problemMatcherPlugin],
    });

    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
