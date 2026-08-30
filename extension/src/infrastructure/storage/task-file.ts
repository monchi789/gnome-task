import GLib from 'gi://GLib';

const FILE_NAME = 'tasks.json';
const APP_DIR = 'gnome-task';

/**
 * Where the tasks live when the `storage-file` setting is empty.
 *
 * This module deliberately holds nothing but path arithmetic. `prefs.ts` needs
 * the same answer as `extension.ts` to fill the Storage row, and importing the
 * repository for it would drag `gio-async.ts` — whose `Gio._promisify()` runs
 * at import time — into the GTK process, which has no business promisifying
 * the shell's I/O.
 */
export function defaultTaskFilePath(): string {
    return GLib.build_filenamev([GLib.get_user_data_dir(), APP_DIR, FILE_NAME]);
}

/**
 * Turn the raw `storage-file` setting into a usable absolute path.
 *
 * The value normally comes from the file chooser and is already absolute, but
 * it is a plain string key that anyone can set with `gsettings`, so a bad value
 * must degrade to the default rather than send writes somewhere unpredictable.
 */
export function resolveTaskFilePath(setting: string): string {
    const value = setting.trim();
    if (value === '') return defaultTaskFilePath();

    const expanded =
        value === '~'
            ? GLib.get_home_dir()
            : value.startsWith('~/')
              ? GLib.build_filenamev([GLib.get_home_dir(), value.slice(2)])
              : value;

    if (!GLib.path_is_absolute(expanded)) {
        console.warn(
            `GNOME Task: storage-file "${setting}" is not an absolute path; ` +
                'using the default location instead.',
        );
        return defaultTaskFilePath();
    }

    return expanded;
}
