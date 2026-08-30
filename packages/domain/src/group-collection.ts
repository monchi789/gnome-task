/**
 * An immutable, ordered set of groups.
 *
 * Same contract as `TaskCollection`: every mutating method returns a new
 * collection, and a no-op returns the *same instance* so `next !== previous`
 * stays a reliable "persist and repaint" signal.
 */

import type {DomainContext} from './task.ts';
import type {GroupColor, NewGroupInput, TaskGroup} from './group.ts';
import {createGroup, recolorGroup, renameGroup, toggleGroupCollapsed, touchGroup} from './group.ts';

export class GroupCollection {
    static readonly EMPTY = new GroupCollection([]);

    readonly #groups: readonly TaskGroup[];

    private constructor(groups: readonly TaskGroup[]) {
        this.#groups = groups;
    }

    /** Build from already-validated groups, dropping duplicate ids (first wins). */
    static from(groups: Iterable<TaskGroup>): GroupCollection {
        const seen = new Set<string>();
        const unique: TaskGroup[] = [];
        for (const group of groups) {
            if (seen.has(group.id)) continue;
            seen.add(group.id);
            unique.push(group);
        }
        return unique.length === 0 ? GroupCollection.EMPTY : new GroupCollection(unique);
    }

    get size(): number {
        return this.#groups.length;
    }

    get isEmpty(): boolean {
        return this.#groups.length === 0;
    }

    /** Manual order, as persisted. */
    all(): readonly TaskGroup[] {
        return this.#groups;
    }

    find(id: string): TaskGroup | undefined {
        return this.#groups.find((group) => group.id === id);
    }

    has(id: string): boolean {
        return this.#groups.some((group) => group.id === id);
    }

    add(ctx: DomainContext, input: NewGroupInput): GroupCollection {
        return new GroupCollection([...this.#groups, createGroup(ctx, input)]);
    }

    remove(id: string): GroupCollection {
        const next = this.#groups.filter((group) => group.id !== id);
        if (next.length === this.#groups.length) return this;
        return next.length === 0 ? GroupCollection.EMPTY : new GroupCollection(next);
    }

    rename(ctx: DomainContext, id: string, title: string): GroupCollection {
        return this.#replace(id, (group) => renameGroup(ctx, group, title));
    }

    recolor(ctx: DomainContext, id: string, color: GroupColor): GroupCollection {
        return this.#replace(id, (group) => recolorGroup(ctx, group, color));
    }

    toggleCollapsed(ctx: DomainContext, id: string): GroupCollection {
        return this.#replace(id, (group) => toggleGroupCollapsed(ctx, group));
    }

    update(
        ctx: DomainContext,
        id: string,
        changes: Parameters<typeof touchGroup>[2],
    ): GroupCollection {
        return this.#replace(id, (group) => touchGroup(ctx, group, changes));
    }

    /**
     * Move `id` so it sits immediately before `beforeId`, or last when
     * `beforeId` is null.
     *
     * Positions are named by *id*, never by index: the popup hides and reorders
     * rows (completed tasks sink, groups fold), so a visual index and a stored
     * index are not the same number. Anchoring to an id removes that whole
     * class of off-by-one bug.
     */
    move(id: string, beforeId: string | null): GroupCollection {
        if (id === beforeId) return this;

        const from = this.#groups.findIndex((group) => group.id === id);
        if (from === -1) return this;
        if (beforeId !== null && !this.has(beforeId)) return this;

        const rest = this.#groups.filter((group) => group.id !== id);
        const at = beforeId === null ? rest.length : rest.findIndex((g) => g.id === beforeId);

        const moved = this.#groups[from] as TaskGroup;
        const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
        if (next.every((group, index) => group === this.#groups[index])) return this;

        return new GroupCollection(next);
    }

    #replace(id: string, transform: (group: TaskGroup) => TaskGroup): GroupCollection {
        const index = this.#groups.findIndex((group) => group.id === id);
        if (index === -1) return this;

        const current = this.#groups[index] as TaskGroup;
        const updated = transform(current);
        if (updated === current) return this;

        const next = [...this.#groups];
        next[index] = updated;
        return new GroupCollection(next);
    }
}
