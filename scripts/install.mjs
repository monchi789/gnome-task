#!/usr/bin/env node
/**
 * Install the built extension into the user's GNOME Shell extension directory.
 *
 * `dist/` is symlinked rather than copied: the shell follows the link, so an
 * edit-build-reload cycle needs no reinstall. `--copy` produces a real
 * directory instead, which is what you want when handing the extension to
 * someone else or preparing a zip.
 */
import {access, cp, lstat, mkdir, readlink, rm, symlink} from 'node:fs/promises';
import path from 'node:path';

import {DIST_DIR, INSTALL_DIR, UUID} from './paths.mjs';

const copyMode = process.argv.includes('--copy');
// `install.sh` prints its own closing instructions, and two lists of "next
// steps" that disagree about whether the extension is already enabled is worse
// than either one alone.
const quiet = process.argv.includes('--quiet');

async function exists(target) {
    try {
        await access(target);
        return true;
    } catch {
        return false;
    }
}

/**
 * Remove whatever currently occupies the install path.
 * `lstat` (not `stat`) so a dangling symlink is still detected and cleared.
 */
async function clearInstallPath() {
    try {
        const info = await lstat(INSTALL_DIR);
        if (info.isSymbolicLink()) {
            console.log(`replacing symlink -> ${await readlink(INSTALL_DIR)}`);
        } else {
            console.log('replacing existing installed directory');
        }
        await rm(INSTALL_DIR, {recursive: true, force: true});
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

async function main() {
    // The compiled schema is checked alongside the bundle because the shell
    // needs both: an uncompiled schema makes getSettings() abort and the
    // extension fail to load with a message that does not name the real cause.
    // `pnpm build` produces both, so a missing one always means the same fix.
    for (const required of ['extension.js', 'schemas/gschemas.compiled']) {
        if (!(await exists(path.join(DIST_DIR, required)))) {
            throw new Error(`dist/${required} is missing — run \`pnpm build\` first`);
        }
    }

    await mkdir(path.dirname(INSTALL_DIR), {recursive: true});
    await clearInstallPath();

    if (copyMode) {
        await cp(DIST_DIR, INSTALL_DIR, {recursive: true});
        console.log(`copied  -> ${INSTALL_DIR}`);
    } else {
        await symlink(DIST_DIR, INSTALL_DIR, 'dir');
        console.log(`linked  -> ${INSTALL_DIR}`);
    }

    if (quiet) return;

    const wayland = process.env['XDG_SESSION_TYPE'] === 'wayland';
    console.log('\nNext:');
    console.log(
        wayland
            ? '  1. log out and back in (Wayland cannot restart the shell in place)'
            : '  1. press Alt+F2, type  r  and hit Enter to restart GNOME Shell',
    );
    console.log(`  2. gnome-extensions enable ${UUID}`);
    console.log('  3. journalctl -f -o cat /usr/bin/gnome-shell   # watch for errors');
}

main().catch((error) => {
    console.error(`install failed: ${error.message}`);
    process.exitCode = 1;
});
