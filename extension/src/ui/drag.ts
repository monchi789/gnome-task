import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import type St from 'gi://St';

import type {TaskDropTarget} from '@gnome-task/domain';

/** Pointer travel before a press turns into a drag rather than a click. */
const THRESHOLD_PX = 6;

/** How close to the edge of the scroll view starts auto-scrolling. */
const EDGE_PX = 24;
const SCROLL_STEP_PX = 18;
const SCROLL_INTERVAL_MS = 30;

export interface DragRow {
    readonly kind: 'task' | 'group';
    readonly id: string;
    /** For a task, the group it sits in. For a header, its own group id. */
    readonly groupId: string | null;
    readonly actor: St.Widget;
    /** Headers only: a folded group is a drop target in its own right. */
    readonly collapsed?: boolean;
}

export interface DragHandlers {
    onDropTask(id: string, target: TaskDropTarget): void;
    onDropGroup(id: string, beforeGroupId: string | null): void;
}

/** Where a drop would land, and the row that shows it. */
interface Slot {
    readonly y: number;
    readonly target: TaskDropTarget | {readonly beforeGroupId: string | null};
    readonly mark: {readonly actor: St.Widget; readonly style: string} | null;
}

/**
 * Pointer-driven reordering for the popup.
 *
 * Deliberately *not* built on `ui/dnd.js`: that machinery is written for the
 * overview and reparents the dragged actor into `Main.uiGroup`, which fights
 * with the modal grab a popup menu holds. Here nothing is reparented and
 * nothing floats — the press is followed through a `captured-event` handler on
 * the stage, the drop position is drawn by adding a style class to the row it
 * would land next to, and the actual move is a single call into the service.
 *
 * The list re-registers every row on each render (`reset()` then `register()`
 * top to bottom), so the geometry this works from is always the geometry on
 * screen.
 */
export class DragController {
    readonly #handlers: DragHandlers;
    readonly #scrollView: St.ScrollView;

    #rows: DragRow[] = [];

    #row: DragRow | null = null;
    #startY = 0;
    #dragging = false;
    #capturedId = 0;
    #scrollSourceId = 0;
    #scrollDirection = 0;
    #marked: {actor: St.Widget; style: string} | null = null;
    #slot: Slot | null = null;

    constructor(scrollView: St.ScrollView, handlers: DragHandlers) {
        this.#scrollView = scrollView;
        this.#handlers = handlers;
    }

    get dragging(): boolean {
        return this.#dragging;
    }

    /** Called at the top of a render, before the rows are rebuilt. */
    reset(): void {
        // A rebuild destroys the actors this was tracking; a drag cannot
        // survive it, and leaving the stage handler connected would leak.
        this.#stop();
        this.#rows = [];
    }

    /**
     * Wire a row's grip and record the row.
     *
     * Rows land in the order their widgets are constructed, which is the order
     * the list draws them — that is what the drop arithmetic below assumes.
     * The grip must be a plain reactive actor, not an St.Button: a button
     * swallows the press before it gets here.
     */
    attachHandle(handle: Clutter.Actor, row: DragRow): void {
        this.#rows.push(row);
        handle.connect('button-press-event', (_actor, event: Clutter.Event) => {
            this.#begin(row, event);
            return Clutter.EVENT_STOP;
        });
    }

    destroy(): void {
        this.#stop();
        this.#rows = [];
    }

    #begin(row: DragRow, event: Clutter.Event): void {
        this.#stop();

        this.#row = row;
        this.#startY = event.get_coords()[1];
        this.#dragging = false;
        this.#capturedId = global.stage.connect('captured-event', (_stage, next: Clutter.Event) =>
            this.#onEvent(next),
        );
    }

    #onEvent(event: Clutter.Event): boolean {
        if (this.#row === null) return Clutter.EVENT_PROPAGATE;

        switch (event.type()) {
            case Clutter.EventType.MOTION: {
                const y = event.get_coords()[1];
                if (!this.#dragging && Math.abs(y - this.#startY) < THRESHOLD_PX) {
                    return Clutter.EVENT_PROPAGATE;
                }
                if (!this.#dragging) {
                    this.#dragging = true;
                    this.#row.actor.add_style_class_name('gnome-task-dragging');
                }
                this.#aimAt(y);
                return Clutter.EVENT_STOP;
            }

            case Clutter.EventType.BUTTON_RELEASE: {
                const dragged = this.#dragging;
                const row = this.#row;
                const slot = this.#slot;
                this.#stop();
                if (dragged && slot !== null) this.#commit(row, slot);
                // A press that never moved is a click on the grip; let it go.
                return dragged ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }

            case Clutter.EventType.KEY_PRESS:
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    const dragged = this.#dragging;
                    this.#stop();
                    return dragged ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                }
                return this.#dragging ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;

            default:
                return this.#dragging ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
    }

    #commit(row: DragRow | null, slot: Slot): void {
        if (row === null) return;

        if (row.kind === 'group') {
            const anchor = slot.target as {beforeGroupId: string | null};
            if (anchor.beforeGroupId !== row.id) {
                this.#handlers.onDropGroup(row.id, anchor.beforeGroupId);
            }
            return;
        }

        const target = slot.target as TaskDropTarget;
        if (target.beforeTaskId !== row.id) this.#handlers.onDropTask(row.id, target);
    }

    /** Pick the nearest drop slot to the pointer and show it. */
    #aimAt(pointerY: number): void {
        const row = this.#row;
        if (row === null) return;

        const slots = row.kind === 'group' ? this.#groupSlots() : this.#taskSlots();

        let best: Slot | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const slot of slots) {
            const distance = Math.abs(slot.y - pointerY);
            if (distance < bestDistance) {
                best = slot;
                bestDistance = distance;
            }
        }

        this.#slot = best;
        this.#mark(best?.mark ?? null);
        this.#updateAutoScroll(pointerY);
    }

    #taskSlots(): Slot[] {
        const slots: Slot[] = [];
        let section: string | null = null;
        let bottom: number | null = null;

        for (const row of this.#rows) {
            const box = geometry(row.actor);
            if (box === null) continue;

            if (row.kind === 'group') {
                // The top of a header is the end of the section above it.
                slots.push({
                    y: box.top,
                    target: {groupId: section, beforeTaskId: null},
                    mark: {actor: row.actor, style: 'gnome-task-drop-above'},
                });
                section = row.id;
                if (row.collapsed === true) {
                    // Nothing of a folded group is visible but its header, so
                    // the header itself has to accept the drop.
                    slots.push({
                        y: box.top + box.height / 2,
                        target: {groupId: row.id, beforeTaskId: null},
                        mark: {actor: row.actor, style: 'gnome-task-drop-into'},
                    });
                }
            } else {
                slots.push({
                    y: box.top,
                    target: {groupId: section, beforeTaskId: row.id},
                    mark: {actor: row.actor, style: 'gnome-task-drop-above'},
                });
            }
            bottom = box.top + box.height;
        }

        const last = this.#rows[this.#rows.length - 1];
        if (bottom !== null && last !== undefined) {
            slots.push({
                y: bottom,
                target: {groupId: section, beforeTaskId: null},
                mark: {actor: last.actor, style: 'gnome-task-drop-below'},
            });
        }
        return slots;
    }

    #groupSlots(): Slot[] {
        const slots: Slot[] = [];
        let bottom: number | null = null;

        for (const row of this.#rows) {
            const box = geometry(row.actor);
            if (box === null) continue;
            bottom = box.top + box.height;
            if (row.kind !== 'group') continue;

            slots.push({
                y: box.top,
                target: {beforeGroupId: row.id},
                mark: {actor: row.actor, style: 'gnome-task-drop-above'},
            });
        }

        const last = this.#rows[this.#rows.length - 1];
        if (bottom !== null && last !== undefined) {
            slots.push({
                y: bottom,
                target: {beforeGroupId: null},
                mark: {actor: last.actor, style: 'gnome-task-drop-below'},
            });
        }
        return slots;
    }

    #mark(next: {actor: St.Widget; style: string} | null): void {
        if (
            this.#marked !== null &&
            (next === null ||
                next.actor !== this.#marked.actor ||
                next.style !== this.#marked.style)
        ) {
            this.#marked.actor.remove_style_class_name(this.#marked.style);
            this.#marked = null;
        }
        if (next !== null && this.#marked === null) {
            next.actor.add_style_class_name(next.style);
            this.#marked = next;
        }
    }

    /** Scroll the list when the pointer sits against one of its edges. */
    #updateAutoScroll(pointerY: number): void {
        const box = geometry(this.#scrollView);
        if (box === null) {
            this.#scroll(0);
            return;
        }

        if (pointerY < box.top + EDGE_PX) this.#scroll(-1);
        else if (pointerY > box.top + box.height - EDGE_PX) this.#scroll(1);
        else this.#scroll(0);
    }

    #scroll(direction: number): void {
        if (direction === this.#scrollDirection) return;
        this.#scrollDirection = direction;

        if (this.#scrollSourceId > 0) {
            GLib.Source.remove(this.#scrollSourceId);
            this.#scrollSourceId = 0;
        }
        if (direction === 0) return;

        this.#scrollSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCROLL_INTERVAL_MS, () => {
            const adjustment = this.#scrollView.vadjustment;
            adjustment.value = Math.max(
                0,
                Math.min(
                    adjustment.upper - adjustment.page_size,
                    adjustment.value + direction * SCROLL_STEP_PX,
                ),
            );
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** Undo everything a drag put in place. Safe to call when idle. */
    #stop(): void {
        if (this.#capturedId > 0) {
            global.stage.disconnect(this.#capturedId);
            this.#capturedId = 0;
        }
        this.#scroll(0);
        this.#mark(null);
        if (this.#dragging) this.#row?.actor.remove_style_class_name('gnome-task-dragging');

        this.#row = null;
        this.#slot = null;
        this.#dragging = false;
    }
}

/** Stage coordinates of a row, or null if it is not on screen. */
function geometry(actor: St.Widget): {top: number; height: number} | null {
    if (!actor.mapped) return null;
    const [, top] = actor.get_transformed_position();
    const [, height] = actor.get_transformed_size();
    if (top === null || height === null) return null;
    return {top, height};
}
