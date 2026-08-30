import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSION_DIR = path.join(ROOT, 'extension');
export const DIST_DIR = path.join(ROOT, 'dist');

export const UUID = 'gnome-task@monchi789.github.com';

export const INSTALL_DIR = path.join(os.homedir(), '.local/share/gnome-shell/extensions', UUID);

/**
 * Where tasks live when the `storage-file` setting is empty.
 *
 * The Node-side mirror of `defaultTaskFilePath()` in
 * `extension/src/infrastructure/storage/task-file.ts`, which asks GLib for the
 * same answer. Only the uninstaller uses it, and only to print it: nothing
 * here ever writes to that path.
 */
export const DEFAULT_TASK_FILE = path.join(
    process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local/share'),
    'gnome-task',
    'tasks.json',
);
