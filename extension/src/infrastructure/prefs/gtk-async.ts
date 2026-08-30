import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

/**
 * The one place that promisifies the GTK dialogs preferences uses.
 *
 * GJS only auto-promisifies methods whose name ends in `_async`, and none of
 * these do. On GJS 1.82.3 / GTK 4.18 the promise-looking call
 *
 *     dialog.save(window, null).then(...)
 *
 * throws before the dialog is ever shown:
 *
 *     method Gtk.FileDialog.save: At least 3 arguments required, but only 2 passed
 *
 * The @girs types carry promise-returning overloads regardless, so this is
 * invisible until runtime — and since preferences run in their own process,
 * the failure is only visible in `journalctl /usr/bin/gjs`. That is the whole
 * story behind "the file chooser does nothing".
 *
 * This deliberately does not live next to `storage/gio-async.ts`: that module
 * promisifies I/O for the shell process, and importing it here would pull the
 * compositor's file plumbing into a GTK application that has no use for it.
 */
// _promisify is idempotent, so doing this here is safe even in a process where
// something else got there first.
Gio._promisify(Gtk.FileDialog.prototype, 'open', 'open_finish');
Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
Gio._promisify(Adw.AlertDialog.prototype, 'choose', 'choose_finish');
