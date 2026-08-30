#!/usr/bin/env node
/**
 * Bundle the TypeScript sources into something GJS can actually load.
 *
 * Why a bundler and not plain `tsc`: GJS resolves neither `node_modules` nor
 * bare specifiers, so `import {Task} from '@gnome-task/domain'` would be a
 * runtime error inside GNOME Shell. esbuild inlines the workspace package
 * while leaving the two specifier families GJS *does* understand untouched:
 *
 *   gi://Gio                              -> typelib, resolved by GJS
 *   resource:///org/gnome/shell/ui/main.js -> shipped inside the shell
 *
 * `extension.js` and `prefs.js` must stay separate entry points: the shell
 * loads the first in the compositor process and the second in a standalone
 * GTK process. Code splitting puts anything they share in one chunk they both
 * import by relative path, which GJS handles fine.
 */
import {build, context} from 'esbuild';
import {cp, mkdir, readFile, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';

import {DIST_DIR, EXTENSION_DIR, ROOT} from './paths.mjs';

const metadata = JSON.parse(await readFile(path.join(EXTENSION_DIR, 'metadata.json'), 'utf8'));

/**
 * A header on every emitted file.
 *
 * esbuild drops source comments, so the bundle that ships to
 * extensions.gnome.org carries none of the reasoning that the TypeScript does.
 * This says where that reasoning lives and how to reproduce the file, which is
 * what a reviewer reading the ZIP needs in order to trust it.
 */
const banner = `/* GNOME Task ${metadata['version-name']} — ${metadata.url}
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Generated file. Bundled by esbuild from the TypeScript sources in
 * extension/src and packages/domain — no minification, no obfuscation,
 * no transformation beyond type stripping and module bundling.
 * Reproduce with:  pnpm install && pnpm build
 */`;

const run = promisify(execFile);
const watch = process.argv.includes('--watch');

/** GJS-native specifiers: never bundle, never rewrite. */
const gjsExternals = {
    name: 'gjs-externals',
    setup(pluginBuild) {
        pluginBuild.onResolve({filter: /^(gi:\/\/|resource:\/\/\/)/}, (args) => ({
            path: args.path,
            external: true,
        }));
    },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: {
        extension: path.join(EXTENSION_DIR, 'src/extension.ts'),
        prefs: path.join(EXTENSION_DIR, 'src/prefs.ts'),
    },
    outdir: DIST_DIR,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'neutral',
    target: 'firefox115', // SpiderMonkey 115, the engine behind GJS 1.82.
    // Fixed name: the shell loads whatever extension.js imports, and a hashed
    // chunk name would churn the install directory on every rebuild.
    chunkNames: 'shared',
    treeShaking: true,
    sourcemap: false,
    minify: false,
    logLevel: 'info',
    banner: {js: banner},
    plugins: [gjsExternals],
    alias: {
        '@gnome-task/domain': path.join(ROOT, 'packages/domain/src/index.ts'),
    },
};

/** Everything that is copied verbatim next to the bundled JS. */
async function copyStaticAssets() {
    for (const entry of ['metadata.json', 'stylesheet.css', 'schemas', 'icons']) {
        await cp(path.join(EXTENSION_DIR, entry), path.join(DIST_DIR, entry), {
            recursive: true,
        });
    }
    await cp(path.join(ROOT, 'LICENSE'), path.join(DIST_DIR, 'LICENSE'));
}

/**
 * Compile the GSettings schema in place.
 *
 * This belongs to the build and not to the install step: `dist/` is what the
 * shell loads through a symlink, and every build wipes it, so a rebuild that
 * only copied the `.xml` would leave the installed extension without
 * `gschemas.compiled` and getSettings() would abort on the next reload.
 */
async function compileSchemas() {
    await run('glib-compile-schemas', ['--strict', path.join(DIST_DIR, 'schemas')]);
}

async function main() {
    await rm(DIST_DIR, {recursive: true, force: true});
    await mkdir(DIST_DIR, {recursive: true});

    if (watch) {
        const ctx = await context(options);
        await ctx.watch();
        await copyStaticAssets();
        await compileSchemas();
        console.log('watching for changes; run `pnpm install:ext` after a rebuild');
        return;
    }

    await build(options);
    await copyStaticAssets();
    await compileSchemas();
    console.log(`built -> ${path.relative(ROOT, DIST_DIR)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
