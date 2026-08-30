import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import type {Board} from '@gnome-task/domain';
import {decodeSnapshot} from '@gnome-task/domain';

import './infrastructure/prefs/gtk-async.ts';
import {resolveTaskFilePath} from './infrastructure/storage/task-file.ts';

/**
 * The GNOME docs ask preferences code to park the `Gio.Settings` object on the
 * window. Nothing else here holds a strong reference to it, and once it is
 * collected every `bind()` and `connect()` made below stops firing.
 */
type PreferencesWindow = Adw.PreferencesWindow & {_settings?: Gio.Settings};

export default class GnomeTaskPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        (window as PreferencesWindow)._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'view-list-symbolic',
        });

        const appearance = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'How GNOME Task looks in the top bar and popup.',
        });

        const showCount = new Adw.SwitchRow({
            title: 'Show pending count in the top bar',
            subtitle: 'Display the number of unfinished tasks next to the icon',
        });
        settings.bind('show-count-in-panel', showCount, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(showCount);

        const showCompleted = new Adw.SwitchRow({
            title: 'Show completed tasks',
            subtitle: 'Keep finished tasks visible at the bottom of each group',
        });
        settings.bind('show-completed', showCompleted, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(showCompleted);

        const maxVisible = new Adw.SpinRow({
            title: 'Rows before scrolling',
            subtitle: 'How many rows the popup shows before it scrolls',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
            }),
        });
        settings.bind('max-visible-tasks', maxVisible, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(maxVisible);

        page.add(appearance);
        page.add(this.#buildStorageGroup(window, settings));
        window.add(page);
    }

    #buildStorageGroup(
        window: Adw.PreferencesWindow,
        settings: Gio.Settings,
    ): Adw.PreferencesGroup {
        const storage = new Adw.PreferencesGroup({
            title: 'Storage',
            description:
                'Where tasks are stored on this machine. Pointing the extension at ' +
                'another file never overwrites it: an existing file is loaded as it ' +
                'is, and a new one can take a copy of what you have now.',
        });

        const fileRow = new Adw.ActionRow({title: 'Task file'});

        // A menu rather than one button: "open the file I already have" and
        // "start a file over there" are different questions, and answering
        // both with GTK's save dialog is what produced the misleading
        // "replace this file?" prompt.
        const popover = new Gtk.Popover();
        const chooseButton = new Gtk.MenuButton({
            label: 'Choose…',
            popover,
            valign: Gtk.Align.CENTER,
        });
        const menuBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
        });
        popover.set_child(menuBox);
        fileRow.add_suffix(chooseButton);
        storage.add(fileRow);

        const item = (label: string, onClick: () => void): Gtk.Button => {
            const button = new Gtk.Button({
                label,
                css_classes: ['flat'],
                halign: Gtk.Align.FILL,
            });
            button.get_first_child()?.set_halign(Gtk.Align.START);
            button.connect('clicked', () => {
                popover.popdown();
                onClick();
            });
            menuBox.append(button);
            return button;
        };

        item('Open an existing file…', () => {
            void this.#pickExisting(window, settings);
        });
        item('Create a new file…', () => {
            void this.#pickNew(window, settings);
        });
        const useDefault = item('Use the default location', () => {
            void this.#adopt(window, settings, defaultPath());
        });

        // One place computes what the row says, so the display can never drift
        // from the key — including when the key is changed from outside. The
        // subtitle is parsed as Pango markup, hence the escaping: a path is
        // allowed to contain an ampersand.
        const sync = (): void => {
            const path = resolveTaskFilePath(settings.get_string('storage-file'));
            fileRow.subtitle = `${GLib.markup_escape_text(path, -1)}\n${describe(path)}`;
            useDefault.sensitive = path !== defaultPath();
        };
        sync();

        const changedId = settings.connect('changed::storage-file', sync);
        window.connect('close-request', () => {
            settings.disconnect(changedId);
            return false;
        });

        return storage;
    }

    /** An existing file: `open()`, so GTK never offers to replace anything. */
    async #pickExisting(window: Adw.PreferencesWindow, settings: Gio.Settings): Promise<void> {
        const dialog = new Gtk.FileDialog({
            title: 'Open a task file',
            modal: true,
            filters: jsonFilters(),
        });
        setStartFolder(dialog, settings);

        try {
            const file = await dialog.open(window, null);
            const path = file?.get_path();
            if (path !== undefined && path !== null) await this.#adopt(window, settings, path);
        } catch (error) {
            reportDialogError(error);
        }
    }

    /** A file that does not exist yet: only `save()` lets a name be typed. */
    async #pickNew(window: Adw.PreferencesWindow, settings: Gio.Settings): Promise<void> {
        const dialog = new Gtk.FileDialog({
            title: 'Create a task file',
            modal: true,
            initial_name: 'tasks.json',
            filters: jsonFilters(),
        });
        setStartFolder(dialog, settings);

        try {
            const file = await dialog.save(window, null);
            const path = file?.get_path();
            if (path !== undefined && path !== null) await this.#adopt(window, settings, path);
        } catch (error) {
            reportDialogError(error);
        }
    }

    /**
     * Validate a chosen path, offer to take the current tasks along, and only
     * then write the key. Everything downstream of the key is rebuilt by the
     * extension itself, so this is the last moment anything can be checked.
     */
    async #adopt(
        window: Adw.PreferencesWindow,
        settings: Gio.Settings,
        chosen: string,
    ): Promise<void> {
        const path = resolveTaskFilePath(chosen);
        const current = resolveTaskFilePath(settings.get_string('storage-file'));
        if (path === current) return;

        const problem = pathProblem(path);
        if (problem !== null) {
            window.add_toast(new Adw.Toast({title: problem}));
            return;
        }

        const here = readBoard(current);
        const there = readBoard(path);
        const worthCopying = here !== null && !here.isEmpty && (there === null || there.isEmpty);

        if (worthCopying) {
            const answer = await this.#askAboutCopy(window, path);
            if (answer === 'cancel') return;
            if (answer === 'copy' && !copyFile(current, path, window)) return;
        }

        settings.set_string('storage-file', path === defaultPath() ? '' : path);
    }

    async #askAboutCopy(window: Adw.PreferencesWindow, path: string): Promise<string> {
        const dialog = new Adw.AlertDialog({
            heading: 'Take your tasks along?',
            body:
                `${path} is empty. Your current tasks can be copied there, or the ` +
                'extension can simply start with an empty list. Nothing is deleted ' +
                'either way — the file you are using now stays where it is.',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('empty', 'Start empty');
        dialog.add_response('copy', 'Copy tasks there');
        dialog.set_response_appearance('copy', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('copy');
        dialog.set_close_response('cancel');

        try {
            return await dialog.choose(window, null);
        } catch (error) {
            console.error(`GNOME Task: could not ask about copying: ${String(error)}`);
            return 'cancel';
        }
    }
}

function defaultPath(): string {
    return resolveTaskFilePath('');
}

function jsonFilters(): Gio.ListStore {
    const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
    const json = new Gtk.FileFilter({name: 'Task files (*.json)'});
    json.add_pattern('*.json');
    filters.append(json);
    return filters;
}

/**
 * Start the dialog next to the file in use — but only if that folder exists.
 * The default one is created on the first save, so on a fresh install it
 * usually does not, and GTK refuses a start folder it cannot open.
 */
function setStartFolder(dialog: Gtk.FileDialog, settings: Gio.Settings): void {
    const current = Gio.File.new_for_path(resolveTaskFilePath(settings.get_string('storage-file')));
    const folder = current.get_parent();

    if (folder !== null && folder.query_exists(null)) dialog.set_initial_folder(folder);
    else dialog.set_initial_folder(Gio.File.new_for_path(GLib.get_home_dir()));
}

/** A one-line summary of what is at `path`, for the row subtitle. */
function describe(path: string): string {
    const board = readBoard(path);
    if (board === null) {
        return Gio.File.new_for_path(path).query_exists(null)
            ? 'Unreadable — the extension will move it aside and start fresh'
            : 'New file — nothing stored here yet';
    }

    const tasks = board.tasks.size;
    const groups = board.groups.size;
    const taskText = `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`;
    return groups === 0
        ? taskText
        : `${taskText} in ${groups} ${groups === 1 ? 'group' : 'groups'}`;
}

/** The stored board, or null when the file is missing or damaged. */
function readBoard(path: string): Board | null {
    let text: string;
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok) return null;
        text = new TextDecoder('utf-8').decode(bytes);
    } catch {
        return null;
    }

    try {
        return decodeSnapshot(text).board;
    } catch {
        return null;
    }
}

/** Why this path cannot be used, or null when it can. */
function pathProblem(path: string): string | null {
    const file = Gio.File.new_for_path(path);

    if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
        return `${path} is a folder, not a file`;
    }

    const parent = file.get_parent();
    if (parent === null) return `${path} has no parent folder`;
    if (!parent.query_exists(null)) return null; // created on the first save

    try {
        const info = parent.query_info('access::can-write', Gio.FileQueryInfoFlags.NONE, null);
        if (!info.get_attribute_boolean('access::can-write')) {
            return `No permission to write in ${parent.get_path() ?? 'that folder'}`;
        }
    } catch (error) {
        return `Cannot use that folder: ${String(error)}`;
    }

    return null;
}

/**
 * Copy the tasks to their new home before the key changes.
 *
 * There is a race worth naming: an edit made in the split second between this
 * copy and the extension reloading is flushed to the *old* file by
 * `TaskService.destroy()`, and so is missing from the new one. Closing that
 * would mean coordinating two processes over a sub-second window; it is not
 * worth it, and nothing is ever lost — the old file keeps that edit.
 */
function copyFile(from: string, to: string, window: Adw.PreferencesWindow): boolean {
    const source = Gio.File.new_for_path(from);
    const destination = Gio.File.new_for_path(to);

    try {
        const folder = destination.get_parent();
        if (folder !== null && !folder.query_exists(null)) folder.make_directory_with_parents(null);
        source.copy(destination, Gio.FileCopyFlags.OVERWRITE, null, null);
        return true;
    } catch (error) {
        window.add_toast(new Adw.Toast({title: `Could not copy your tasks: ${String(error)}`}));
        return false;
    }
}

/** Closing a dialog is an answer, not a failure. */
function reportDialogError(error: unknown): void {
    if (error instanceof GLib.Error && error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
        return;
    }
    console.error(`GNOME Task: could not pick a task file: ${String(error)}`);
}
