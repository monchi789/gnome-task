import Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

/**
 * The one place that bridges GJS's promisified I/O to TypeScript.
 *
 * The @girs types carry promise-returning overloads for most `*_async`
 * methods, which makes it look as though GJS promisifies them on its own. It
 * does not: on GJS 1.82.3 `file.load_contents_async(null)` throws
 *
 *     At least 2 arguments required, but only 1 passed
 *
 * unless something has promisified it first. The shell only does that inside
 * `gdm/loginDialog.js`, which runs in the greeter process — so in a normal
 * session it has not happened and every read would fail. Hence the explicit
 * call below.
 *
 * `replace_contents_bytes_async` needs the same treatment for a different
 * reason, and cannot be derived automatically at all: its finish function is
 * named `replace_contents_finish`, which breaks the naming rule GJS uses to
 * derive the pair, so it must be promisified by hand and the generated types
 * still only describe the callback form. The single cast below is contained
 * here rather than repeated at every call site.
 *
 * Why the bytes variant at all: plain `replace_contents_async` does not keep
 * the input buffer alive for the duration of the write, so the data can be
 * collected mid-write and the file ends up corrupt.
 */
// _promisify is idempotent, so doing this here is safe even in a process where
// the shell (or another extension) got there first.
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

type ReplaceContentsBytesAsync = (
    contents: GLib.Bytes,
    etag: string | null,
    makeBackup: boolean,
    flags: Gio.FileCreateFlags,
    cancellable: Gio.Cancellable | null,
) => Promise<string | null>;

/** Atomically replace a file's contents. Resolves with the new etag. */
export function replaceContentsBytes(
    file: Gio.File,
    contents: GLib.Bytes,
    options: {makeBackup: boolean; flags: Gio.FileCreateFlags},
): Promise<string | null> {
    const promisified = file.replace_contents_bytes_async as unknown as ReplaceContentsBytesAsync;
    return promisified.call(file, contents, null, options.makeBackup, options.flags, null);
}
