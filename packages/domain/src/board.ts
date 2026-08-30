/**
 * The whole model in one value: the groups and the tasks, together.
 *
 * Groups and tasks are separate collections because they are edited
 * separately, but three operations straddle both — moving a task into another
 * group, deleting a group without deleting its tasks, and building the grouped
 * view the popup draws. Those live here so no caller has to keep two
 * collections in step by hand.
 *
 * Immutable throughout, and a no-op returns the *same instance*, exactly like
 * the collections it composes.
 */

import type {DomainContext, NewTaskInput, Task} from './task.ts';
import {isCompleted} from './task.ts';
import type {GroupColor, NewGroupInput, TaskGroup} from './group.ts';
import {GroupCollection} from './group-collection.ts';
import {TaskCollection} from './task-collection.ts';

/** One rendered block: a group header (or the inbox) and its tasks. */
export interface Section {
    /** null is the ungrouped inbox, which has no header of its own. */
    readonly group: TaskGroup | null;
    /** Display order: pending first, completed sinking to the bottom. */
    readonly tasks: readonly Task[];
}

/** Where a dragged task lands. */
export interface TaskDropTarget {
    readonly groupId: string | null;
    /** The task it should sit above, or null for the end of the group. */
    readonly beforeTaskId: string | null;
}

export class Board {
    static readonly EMPTY = new Board(GroupCollection.EMPTY, TaskCollection.EMPTY);

    readonly #groups: GroupCollection;
    readonly #tasks: TaskCollection;

    private constructor(groups: GroupCollection, tasks: TaskCollection) {
        this.#groups = groups;
        this.#tasks = tasks;
    }

    static from(groups: GroupCollection, tasks: TaskCollection): Board {
        if (groups.isEmpty && tasks.isEmpty) return Board.EMPTY;
        return new Board(groups, tasks);
    }

    get groups(): GroupCollection {
        return this.#groups;
    }

    get tasks(): TaskCollection {
        return this.#tasks;
    }

    get isEmpty(): boolean {
        return this.#tasks.isEmpty && this.#groups.isEmpty;
    }

    get pendingCount(): number {
        return this.#tasks.pendingCount;
    }

    /**
     * The grouped view, in draw order: the inbox first — it is where new tasks
     * land, and where every task from a schema-1 file starts — then the groups
     * in their manual order. An empty group still gets a section, because its
     * header is the only thing left to drop a task on.
     */
    sections(): readonly Section[] {
        const sections: Section[] = [];

        const inbox = sink(this.#tasks.inGroup(null));
        if (inbox.length > 0) sections.push({group: null, tasks: inbox});

        for (const group of this.#groups.all()) {
            sections.push({group, tasks: sink(this.#tasks.inGroup(group.id))});
        }

        return sections;
    }

    /** Pending tasks in one group; drives the count on a folded header. */
    pendingIn(groupId: string | null): number {
        let count = 0;
        for (const task of this.#tasks.inGroup(groupId)) if (!isCompleted(task)) count++;
        return count;
    }

    // --- tasks --------------------------------------------------------------

    addTask(ctx: DomainContext, input: NewTaskInput): Board {
        // An unknown group would make the task invisible: it would belong to a
        // section that is never drawn. Fall back to the inbox instead.
        const groupId = input.projectId ?? null;
        const target = groupId !== null && this.#groups.has(groupId) ? groupId : null;
        return this.#withTasks(this.#tasks.add(ctx, {...input, projectId: target}));
    }

    toggleTask(ctx: DomainContext, id: string): Board {
        return this.#withTasks(this.#tasks.toggle(ctx, id));
    }

    renameTask(ctx: DomainContext, id: string, title: string): Board {
        return this.#withTasks(this.#tasks.rename(ctx, id, title));
    }

    removeTask(id: string): Board {
        return this.#withTasks(this.#tasks.remove(id));
    }

    clearCompleted(): Board {
        return this.#withTasks(this.#tasks.clearCompleted());
    }

    /** Move a task within its group, or into another one. */
    moveTask(ctx: DomainContext, id: string, target: TaskDropTarget): Board {
        if (this.#tasks.find(id) === undefined) return this;

        const groupId =
            target.groupId !== null && this.#groups.has(target.groupId) ? target.groupId : null;

        // Re-parent first: `move()` anchors to a sibling id, and the anchor is
        // only meaningful once the task is in the destination group.
        const regrouped = this.#tasks.setGroup(ctx, id, groupId);
        const anchor = target.beforeTaskId;
        const usable = anchor !== null && regrouped.find(anchor)?.projectId === groupId;

        return this.#withTasks(
            regrouped.move(id, usable ? anchor : endOfGroupAnchor(regrouped, id, groupId)),
        );
    }

    // --- groups -------------------------------------------------------------

    addGroup(ctx: DomainContext, input: NewGroupInput): Board {
        return this.#withGroups(this.#groups.add(ctx, input));
    }

    renameGroup(ctx: DomainContext, id: string, title: string): Board {
        return this.#withGroups(this.#groups.rename(ctx, id, title));
    }

    recolorGroup(ctx: DomainContext, id: string, color: GroupColor): Board {
        return this.#withGroups(this.#groups.recolor(ctx, id, color));
    }

    toggleGroupCollapsed(ctx: DomainContext, id: string): Board {
        return this.#withGroups(this.#groups.toggleCollapsed(ctx, id));
    }

    moveGroup(id: string, beforeId: string | null): Board {
        return this.#withGroups(this.#groups.move(id, beforeId));
    }

    /** Delete a group. Its tasks survive, back in the inbox. */
    removeGroup(ctx: DomainContext, id: string): Board {
        const groups = this.#groups.remove(id);
        if (groups === this.#groups) return this;

        let tasks = this.#tasks;
        for (const task of this.#tasks.inGroup(id)) tasks = tasks.setGroup(ctx, task.id, null);

        return new Board(groups, tasks);
    }

    #withTasks(tasks: TaskCollection): Board {
        return tasks === this.#tasks ? this : new Board(this.#groups, tasks);
    }

    #withGroups(groups: GroupCollection): Board {
        return groups === this.#groups ? this : new Board(groups, this.#tasks);
    }
}

/**
 * The anchor that means "last inside this group": the task that follows the
 * group's current last member in storage order, or null for the very end.
 *
 * Translating "end of the group" into a global position here — rather than
 * letting `TaskCollection.move(id, null)` send it to the end of the file — is
 * what makes dropping a task where it already sits a true no-op, and so keeps
 * the "same instance means nothing to save" contract honest.
 */
function endOfGroupAnchor(
    tasks: TaskCollection,
    movingId: string,
    groupId: string | null,
): string | null {
    const others = tasks.all().filter((task) => task.id !== movingId);

    let last = -1;
    for (const [index, task] of others.entries()) if (task.projectId === groupId) last = index;
    if (last === -1) return null;

    return others[last + 1]?.id ?? null;
}

/** Pending first, completed to the bottom, order otherwise untouched. */
function sink(tasks: readonly Task[]): readonly Task[] {
    const pending: Task[] = [];
    const done: Task[] = [];
    for (const task of tasks) (isCompleted(task) ? done : pending).push(task);
    return done.length === 0 ? pending : [...pending, ...done];
}
