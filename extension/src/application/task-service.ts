import GLib from 'gi://GLib';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import type {
    DomainContext,
    GroupColor,
    NewTaskInput,
    Section,
    TaskDropTarget,
} from '@gnome-task/domain';
import {Board} from '@gnome-task/domain';

import type {JsonTaskRepository} from '../infrastructure/storage/json-task-repository.ts';

/** Wait this long after the last edit before touching the disk. */
const SAVE_DEBOUNCE_MS = 400;

/**
 * The only object the UI talks to.
 *
 * It owns the current `Board`, turns UI intents into domain operations, and
 * decides when state reaches the disk. Widgets never see the repository, and
 * the domain never sees GLib.
 *
 * Emits `changed` whenever the board is replaced.
 */
export class TaskService extends EventEmitter {
    readonly #repository: JsonTaskRepository;
    readonly #context: DomainContext;

    #board = Board.EMPTY;
    #saveSourceId = 0;
    #dirty = false;
    #destroyed = false;

    constructor(repository: JsonTaskRepository) {
        super();
        this.#repository = repository;
        this.#context = {
            clock: {
                // UTC throughout: timestamps must stay comparable across the
                // devices this file is meant to travel between.
                now: () => GLib.DateTime.new_now_utc().format_iso8601() ?? new Date().toISOString(),
            },
            ids: {
                next: () => GLib.uuid_string_random(),
            },
        };
    }

    get board(): Board {
        return this.#board;
    }

    get pendingCount(): number {
        return this.#board.pendingCount;
    }

    /** The grouped view the popup draws. */
    sections(): readonly Section[] {
        return this.#board.sections();
    }

    /** Read stored tasks. Safe to call once per enable(). */
    async load(): Promise<void> {
        const board = await this.#repository.load();
        if (this.#destroyed) return;
        this.#board = board;
        this.emit('changed');
    }

    // --- tasks --------------------------------------------------------------

    addTask(input: NewTaskInput): void {
        this.#apply(this.#board.addTask(this.#context, input));
    }

    toggleTask(id: string): void {
        this.#apply(this.#board.toggleTask(this.#context, id));
    }

    renameTask(id: string, title: string): void {
        this.#apply(this.#board.renameTask(this.#context, id, title));
    }

    removeTask(id: string): void {
        this.#apply(this.#board.removeTask(id));
    }

    moveTask(id: string, target: TaskDropTarget): void {
        this.#apply(this.#board.moveTask(this.#context, id, target));
    }

    clearCompleted(): void {
        this.#apply(this.#board.clearCompleted());
    }

    // --- groups -------------------------------------------------------------

    addGroup(title: string): void {
        this.#apply(this.#board.addGroup(this.#context, {title}));
    }

    renameGroup(id: string, title: string): void {
        this.#apply(this.#board.renameGroup(this.#context, id, title));
    }

    setGroupColor(id: string, color: GroupColor): void {
        this.#apply(this.#board.recolorGroup(this.#context, id, color));
    }

    toggleGroupCollapsed(id: string): void {
        this.#apply(this.#board.toggleGroupCollapsed(this.#context, id));
    }

    /** Delete the group. Its tasks survive, back in the inbox. */
    removeGroup(id: string): void {
        this.#apply(this.#board.removeGroup(this.#context, id));
    }

    moveGroup(id: string, beforeId: string | null): void {
        this.#apply(this.#board.moveGroup(id, beforeId));
    }

    /**
     * Flush any pending write and stop all timers. After this the service is
     * inert; late callbacks from the UI are ignored rather than throwing.
     */
    destroy(): void {
        this.#destroyed = true;
        this.#cancelPendingSave();

        if (!this.#dirty) return;
        try {
            // Teardown is the one moment worth blocking for: the async write
            // would be cancelled with the extension and the edit would be lost.
            this.#repository.saveSync(this.#board);
            this.#dirty = false;
        } catch (error) {
            console.error(`GNOME Task: final save failed: ${String(error)}`);
        }
    }

    /**
     * Replace the board if the operation actually changed something. `Board`
     * returns the same instance for no-ops, so this identity check is what
     * stops a redundant repaint and disk write.
     */
    #apply(next: Board): void {
        if (this.#destroyed || next === this.#board) return;
        this.#board = next;
        this.#dirty = true;
        this.emit('changed');
        this.#scheduleSave();
    }

    #scheduleSave(): void {
        this.#cancelPendingSave();
        this.#saveSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
            this.#saveSourceId = 0;
            void this.#flush();
            return GLib.SOURCE_REMOVE;
        });
    }

    #cancelPendingSave(): void {
        if (this.#saveSourceId === 0) return;
        GLib.Source.remove(this.#saveSourceId);
        this.#saveSourceId = 0;
    }

    async #flush(): Promise<void> {
        // Snapshot first: further edits during the await must not clear the
        // dirty flag for work this write does not include.
        const snapshot = this.#board;
        try {
            await this.#repository.save(snapshot);
            if (this.#board === snapshot) this.#dirty = false;
        } catch (error) {
            console.error(`GNOME Task: could not save tasks: ${String(error)}`);
        }
    }
}
