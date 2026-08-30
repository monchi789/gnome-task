/**
 * An immutable, ordered set of tasks.
 *
 * Every mutating method returns a new collection; the receiver is never
 * modified. When an operation is a no-op (unknown id, unchanged title) the
 * *same instance* comes back, so `next !== previous` is a reliable "something
 * changed, persist and repaint" signal.
 */

import type {DomainContext, NewTaskInput, Task} from './task.ts';
import {createTask, isCompleted, renameTask, toggleTask, touchTask} from './task.ts';

export class TaskCollection {
    static readonly EMPTY = new TaskCollection([]);

    readonly #tasks: readonly Task[];

    private constructor(tasks: readonly Task[]) {
        this.#tasks = tasks;
    }

    /** Build from already-validated tasks, dropping duplicate ids (first wins). */
    static from(tasks: Iterable<Task>): TaskCollection {
        const seen = new Set<string>();
        const unique: Task[] = [];
        for (const task of tasks) {
            if (seen.has(task.id)) continue;
            seen.add(task.id);
            unique.push(task);
        }
        return unique.length === 0 ? TaskCollection.EMPTY : new TaskCollection(unique);
    }

    get size(): number {
        return this.#tasks.length;
    }

    get isEmpty(): boolean {
        return this.#tasks.length === 0;
    }

    /** Tasks not yet completed. Drives the panel badge. */
    get pendingCount(): number {
        let count = 0;
        for (const task of this.#tasks) if (!isCompleted(task)) count++;
        return count;
    }

    /** Insertion order, as persisted. */
    all(): readonly Task[] {
        return this.#tasks;
    }

    /** Display order: pending first, completed sinking to the bottom. */
    ordered(): readonly Task[] {
        const pending: Task[] = [];
        const done: Task[] = [];
        for (const task of this.#tasks) (isCompleted(task) ? done : pending).push(task);
        return [...pending, ...done];
    }

    find(id: string): Task | undefined {
        return this.#tasks.find((task) => task.id === id);
    }

    add(ctx: DomainContext, input: NewTaskInput): TaskCollection {
        return new TaskCollection([...this.#tasks, createTask(ctx, input)]);
    }

    remove(id: string): TaskCollection {
        const next = this.#tasks.filter((task) => task.id !== id);
        if (next.length === this.#tasks.length) return this;
        return next.length === 0 ? TaskCollection.EMPTY : new TaskCollection(next);
    }

    toggle(ctx: DomainContext, id: string): TaskCollection {
        return this.#replace(id, (task) => toggleTask(ctx, task));
    }

    rename(ctx: DomainContext, id: string, title: string): TaskCollection {
        return this.#replace(id, (task) => renameTask(ctx, task, title));
    }

    update(
        ctx: DomainContext,
        id: string,
        changes: Parameters<typeof touchTask>[2],
    ): TaskCollection {
        return this.#replace(id, (task) => touchTask(ctx, task, changes));
    }

    /** Point a task at a group, or at the ungrouped inbox with null. */
    setGroup(ctx: DomainContext, id: string, groupId: string | null): TaskCollection {
        return this.#replace(id, (task) => touchTask(ctx, task, {projectId: groupId}));
    }

    /** Every task belonging to `groupId` (null for the ungrouped inbox). */
    inGroup(groupId: string | null): readonly Task[] {
        return this.#tasks.filter((task) => task.projectId === groupId);
    }

    /**
     * Move `id` so it sits immediately before `beforeId`, or last when
     * `beforeId` is null.
     *
     * Positions are named by *id*, never by index: the popup sinks completed
     * tasks and can hide them entirely, so a visual index and a stored index
     * are not the same number. Anchoring to an id removes that whole class of
     * off-by-one bug.
     *
     * "Last" means last in storage order, which — since sections are built by
     * filtering on the group — is the same as last within the task's group.
     */
    move(id: string, beforeId: string | null): TaskCollection {
        if (id === beforeId) return this;

        const from = this.#tasks.findIndex((task) => task.id === id);
        if (from === -1) return this;
        if (beforeId !== null && this.find(beforeId) === undefined) return this;

        const rest = this.#tasks.filter((task) => task.id !== id);
        const at = beforeId === null ? rest.length : rest.findIndex((t) => t.id === beforeId);

        const moved = this.#tasks[from] as Task;
        const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
        if (next.every((task, index) => task === this.#tasks[index])) return this;

        return new TaskCollection(next);
    }

    /** Drop every completed task. */
    clearCompleted(): TaskCollection {
        const next = this.#tasks.filter((task) => !isCompleted(task));
        if (next.length === this.#tasks.length) return this;
        return next.length === 0 ? TaskCollection.EMPTY : new TaskCollection(next);
    }

    #replace(id: string, transform: (task: Task) => Task): TaskCollection {
        const index = this.#tasks.findIndex((task) => task.id === id);
        if (index === -1) return this;

        const current = this.#tasks[index] as Task;
        const updated = transform(current);
        if (updated === current) return this;

        const next = [...this.#tasks];
        next[index] = updated;
        return new TaskCollection(next);
    }
}
