#!/usr/bin/env node
/**
 * Produce the ZIP that gets uploaded to extensions.gnome.org.
 *
 * `gnome-extensions pack` does the packing rather than a hand-rolled zip: it
 * is the tool the review process expects, it compiles the GSettings schema
 * itself, and it puts everything at the top level of the archive, which is
 * where the shell looks for `metadata.json`.
 *
 * The listing is then checked against what the extension actually needs. EGO
 * asks that a submission not carry files it does not need to function, and an
 * archive is the one artifact nobody re-reads before uploading it.
 */
import {execFile} from 'node:child_process';
import {access, stat} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';

import {DIST_DIR, ROOT, UUID} from './paths.mjs';

const run = promisify(execFile);

const SCHEMA = 'schemas/org.gnome.shell.extensions.gnome-task.gschema.xml';

/**
 * Everything the archive is allowed to contain, and must.
 *
 * `metadata.json`, `extension.js`, `prefs.js` and `stylesheet.css` are picked
 * up by the packer on its own; the rest is passed as extra sources. Directory
 * entries are not listed — `unzip -Z1` reports them with a trailing slash and
 * they are filtered out before the comparison.
 *
 * Note what is *not* here: `schemas/gschemas.compiled`. The local build makes
 * one because the shell loads `dist/` through a symlink and nothing else would
 * compile it, but an extension installed from extensions.gnome.org is compiled
 * by the shell itself — `extractExtensionArchive()` in `ui/extensionDownloader.js`
 * runs `glib-compile-schemas --strict` on the extracted `schemas/` directory.
 * Shipping the binary would be one more unnecessary file in the submission.
 */
const EXPECTED = [
    'LICENSE',
    'extension.js',
    'icons/gnome-task-symbolic.svg',
    'metadata.json',
    'prefs.js',
    'schemas/org.gnome.shell.extensions.gnome-task.gschema.xml',
    'shared.js',
    'stylesheet.css',
];

async function exists(target) {
    try {
        await access(target);
        return true;
    } catch {
        return false;
    }
}

/** The archive is built from `dist/`, so a stale or absent build is fatal. */
async function requireBuild() {
    for (const required of ['metadata.json', 'extension.js', 'schemas/gschemas.compiled']) {
        if (!(await exists(path.join(DIST_DIR, required)))) {
            throw new Error(`dist/${required} is missing — run \`pnpm build\` first`);
        }
    }
}

async function pack() {
    await run(
        'gnome-extensions',
        [
            'pack',
            DIST_DIR,
            '--force',
            '--out-dir',
            ROOT,
            '--extra-source=shared.js',
            '--extra-source=icons',
            '--extra-source=LICENSE',
            `--schema=${SCHEMA}`,
        ],
        {cwd: ROOT},
    );
}

/** File entries in the archive, sorted, directories dropped. */
async function listing(archive) {
    const {stdout} = await run('unzip', ['-Z1', archive]);
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.endsWith('/'))
        .sort();
}

function compare(actual) {
    const missing = EXPECTED.filter((entry) => !actual.includes(entry));
    const extra = actual.filter((entry) => !EXPECTED.includes(entry));

    if (missing.length > 0 || extra.length > 0) {
        const lines = [
            ...missing.map((entry) => `  missing: ${entry}`),
            ...extra.map((entry) => `  unexpected: ${entry}`),
        ];
        throw new Error(`the archive does not match what it should contain:\n${lines.join('\n')}`);
    }
}

async function main() {
    await requireBuild();
    await pack();

    const archive = path.join(ROOT, `${UUID}.shell-extension.zip`);
    if (!(await exists(archive))) {
        throw new Error(`gnome-extensions pack produced no archive at ${archive}`);
    }

    const entries = await listing(archive);
    compare(entries);

    const {size} = await stat(archive);
    console.log(`packed  -> ${path.relative(ROOT, archive)}  (${(size / 1024).toFixed(1)} kB)`);
    for (const entry of entries) console.log(`  ${entry}`);
    console.log('\nUpload it at https://extensions.gnome.org/upload/');
}

main().catch((error) => {
    console.error(`pack failed: ${error.message}`);
    process.exitCode = 1;
});
