import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {TaskRepository} from '@gnome-task/domain';
import {Board, SnapshotFormatError, decodeSnapshot, encodeSnapshot} from '@gnome-task/domain';

import {replaceContentsBytes} from './gio-async.ts';
import {defaultTaskFilePath} from './task-file.ts';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * Stores tasks as a single JSON document at a path the user can choose.
 *
 * Durability rules, in order of importance:
 *
 *  1. Writes are atomic. `replace_contents_bytes_async` writes a temporary
 *     file and renames it over the target, so a crash mid-write leaves either
 *     the old file or the new one — never a truncated one.
 *  2. Damaged input is quarantined, never overwritten. A file we cannot parse
 *     is renamed aside so the user keeps a chance to recover it by hand.
 *  3. All I/O is async. This code runs in the compositor process; a
 *     synchronous write would stutter the whole desktop.
 */
export class JsonTaskRepository implements TaskRepository {
    readonly #directory: Gio.File;
    readonly #file: Gio.File;

    constructor(filePath: string = defaultTaskFilePath()) {
        this.#file = Gio.File.new_for_path(filePath);
        // `get_parent()` is null only for a filesystem root, which is not a
        // file we could write anyway; falling back to the file itself keeps
        // #ensureDirectory() harmless in that case (it fails as EXISTS).
        this.#directory = this.#file.get_parent() ?? this.#file;
    }

    get path(): string {
        return this.#file.get_path() ?? '(unknown)';
    }

    async load(): Promise<Board> {
        let text: string;
        try {
            const [contents] = await this.#file.load_contents_async(null);
            text = decoder.decode(contents);
        } catch (error) {
            // A missing file is the normal first-run case, not a failure.
            if (
                error instanceof GLib.Error &&
                error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
            ) {
                return Board.EMPTY;
            }
            throw error;
        }

        try {
            const {board, skipped} = decodeSnapshot(text);
            if (skipped > 0) {
                console.warn(`GNOME Task: dropped ${skipped} unreadable record(s)`);
            }
            return board;
        } catch (error) {
            if (error instanceof SnapshotFormatError) {
                const kept = this.#quarantine();
                console.error(
                    `GNOME Task: ${this.path} is unreadable (${error.message}). ` +
                        `Moved it to ${kept} and started with an empty list.`,
                );
                return Board.EMPTY;
            }
            throw error;
        }
    }

    async save(board: Board): Promise<void> {
        this.#ensureDirectory();

        const bytes = new GLib.Bytes(encoder.encode(encodeSnapshot(board)));
        await replaceContentsBytes(this.#file, bytes, {
            // Leaves tasks.json~ holding the previous state.
            makeBackup: true,
            flags: Gio.FileCreateFlags.REPLACE_DESTINATION,
        });
    }

    /**
     * Blocking write, used only when the shell is tearing the extension down
     * and there is no time left for the async path to complete. Keeping this
     * separate makes the one place that may block the compositor obvious.
     */
    saveSync(board: Board): void {
        this.#ensureDirectory();
        this.#file.replace_contents(
            encoder.encode(encodeSnapshot(board)),
            null,
            true,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
    }

    #ensureDirectory(): void {
        try {
            this.#directory.make_directory_with_parents(null);
        } catch (error) {
            if (
                error instanceof GLib.Error &&
                error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)
            ) {
                return;
            }
            throw error;
        }
    }

    /** Move the unreadable file aside and return the name it was given. */
    #quarantine(): string {
        const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S') ?? 'unknown';
        const name = `${this.#file.get_basename() ?? 'tasks.json'}.corrupt-${stamp}`;
        try {
            this.#file.set_display_name(name, null);
            return name;
        } catch (error) {
            console.error(`GNOME Task: could not quarantine the damaged file: ${String(error)}`);
            return '(rename failed)';
        }
    }
}
