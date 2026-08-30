/**
 * The Task entity.
 *
 * Everything here is pure data plus pure functions. There is no clock, no
 * random source and no I/O: callers pass a `DomainContext` so the same input
 * always produces the same output. That is what lets the whole model be tested
 * with plain `node --test`, far away from GJS.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'archived';

export type Priority = 'none' | 'low' | 'medium' | 'high';

export const TASK_STATUSES: readonly TaskStatus[] = [
    'todo',
    'in_progress',
    'completed',
    'archived',
];

export const PRIORITIES: readonly Priority[] = ['none', 'low', 'medium', 'high'];

/** Titles longer than this are truncated rather than rejected. */
export const MAX_TITLE_LENGTH = 500;

export interface Task {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly status: TaskStatus;
    /** Modelled from day one; no UI until 0.2. */
    readonly priority: Priority;
    /**
     * The group this task belongs to, or null for the ungrouped inbox.
     *
     * Named `projectId` because that is the product plan's word for it
     * (PLAN-TASK-GNOME.md §12) and because the field predates the UI: the file
     * format has carried it since schema version 1. The UI calls it a group.
     */
    readonly projectId: string | null;
    /** ISO-8601 date, or null. Modelled from day one; no UI until 0.2. */
    readonly dueDate: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    /** Bumped on every mutation. Groundwork for sync conflict detection. */
    readonly revision: number;
}

export interface Clock {
    /** Current time as an ISO-8601 string. */
    now(): string;
}

export interface IdGenerator {
    next(): string;
}

export interface DomainContext {
    readonly clock: Clock;
    readonly ids: IdGenerator;
}

export interface NewTaskInput {
    readonly title: string;
    readonly description?: string;
    readonly priority?: Priority;
    readonly projectId?: string | null;
    readonly dueDate?: string | null;
}

/**
 * Collapse whitespace and clamp length. A title made only of blanks normalises
 * to the empty string, which `createTask` rejects.
 */
export function normalizeTitle(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

export function isCompleted(task: Task): boolean {
    return task.status === 'completed';
}

export function createTask(ctx: DomainContext, input: NewTaskInput): Task {
    const title = normalizeTitle(input.title);
    if (title === '') throw new RangeError('A task needs a non-empty title');

    const now = ctx.clock.now();
    return {
        id: ctx.ids.next(),
        title,
        description: input.description ?? '',
        status: 'todo',
        priority: input.priority ?? 'none',
        projectId: input.projectId ?? null,
        dueDate: input.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
        revision: 1,
    };
}

/**
 * Apply a partial change, stamping `updatedAt` and bumping `revision`.
 * Returns the original object untouched when nothing actually changed, so
 * callers can skip a disk write with a cheap identity check.
 */
export function touchTask(
    ctx: DomainContext,
    task: Task,
    changes: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'revision'>>,
): Task {
    const changed = (Object.keys(changes) as (keyof typeof changes)[]).some(
        (key) => changes[key] !== undefined && changes[key] !== task[key],
    );
    if (!changed) return task;

    return {
        ...task,
        ...changes,
        updatedAt: ctx.clock.now(),
        revision: task.revision + 1,
    };
}

export function renameTask(ctx: DomainContext, task: Task, rawTitle: string): Task {
    const title = normalizeTitle(rawTitle);
    if (title === '') throw new RangeError('A task needs a non-empty title');
    return touchTask(ctx, task, {title});
}

export function toggleTask(ctx: DomainContext, task: Task): Task {
    return touchTask(ctx, task, {status: isCompleted(task) ? 'todo' : 'completed'});
}
