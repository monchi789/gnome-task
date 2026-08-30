#!/usr/bin/env node
/**
 * Remove the installed extension from the user's GNOME Shell extension
 * directory.
 *
 * The mirror image of `install.mjs`, and it stops at exactly the same place:
 * the tasks file is the user's data, not ours, so it is never touched — its
 * path is printed instead, for whoever does want it gone.
 */
import {execFile} from 'node:child_process';
import {lstat, readlink, rm} from 'node:fs/promises';
import {promisify} from 'node:util';

import {DEFAULT_TASK_FILE, INSTALL_DIR, UUID} from './paths.mjs';

const run = promisify(execFile);

/**
 * Ask the shell to disable it first. A failure here is not interesting: the
 * extension may already be disabled, or the shell may not know it at all, and
 * either way removing the directory is what actually uninstalls it.
 */
async function disable() {
    try {
        await run('gnome-extensions', ['disable', UUID]);
        console.log(`disabled ${UUID}`);
    } catch {
        console.log(`${UUID} was not enabled`);
    }
}

async function main() {
    let info;
    try {
        // lstat, not stat: a dangling symlink still has to be removed.
        info = await lstat(INSTALL_DIR);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        console.log(`nothing to remove — ${INSTALL_DIR} does not exist`);
        return;
    }

    await disable();

    if (info.isSymbolicLink()) {
        console.log(`removing symlink -> ${await readlink(INSTALL_DIR)}`);
    } else {
        console.log('removing installed directory');
    }
    await rm(INSTALL_DIR, {recursive: true, force: true});
    console.log(`removed  -> ${INSTALL_DIR}`);

    console.log('\nYour tasks were left alone:');
    console.log(`  ${DEFAULT_TASK_FILE}`);
    console.log('  (or wherever Preferences → Storage pointed). Delete it by hand if you want');
    console.log('  it gone; reinstalling picks it up again exactly as it is.');
}

main().catch((error) => {
    console.error(`uninstall failed: ${error.message}`);
    process.exitCode = 1;
});
