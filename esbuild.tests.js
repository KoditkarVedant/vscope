// @ts-check
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.join(__dirname, 'src', 'tests');

function findTestFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...findTestFiles(full));
        } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js')) {
            out.push(full);
        }
    }
    return out;
}

async function main() {
    const entryPoints = findTestFiles(TESTS_DIR);
    if (entryPoints.length === 0) {
        console.error('No test files found under src/tests/');
        process.exit(1);
    }

    await esbuild.build({
        entryPoints,
        bundle:   true,
        platform: 'node',
        target:   'node18',
        format:   'cjs',
        outdir:   'out/tests',
        outbase:  'src/tests',
        external: ['vscode', 'node:*'],
        logLevel: 'info',
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
