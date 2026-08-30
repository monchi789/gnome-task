/**
 * The TaskGroup entity.
 *
 * A group is the `Project` of the product plan (PLAN-TASK-GNOME.md §4 and §12),
 * labelled "group" in the UI because that is what it does in 0.1: it gives a
 * handful of tasks a title, a colour and a place in a manual order. Tasks point
 * at it through their existing `projectId` field.
 *
 * Same rules as `task.ts`: pure data, pure functions, no clock and no random
 * source — the caller passes a `DomainContext`.
 */

import type {DomainContext} from './task.ts';
import {normalizeTitle} from './task.ts';

/**
 * A fixed palette rather than a free colour. The shell theme decides what each
 * name renders as (see stylesheet.css), so a group keeps working when the user
 * switches between light and dark, and a stored file never carries a colour
 * that is invisible on the other theme.
 */
export type GroupColor =
    'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'brown' | 'gray';

export const GROUP_COLORS: readonly GroupColor[] = [
    'blue',
    'green',
    'yellow',
    'orange',
    'red',
    'purple',
    'brown',
    'gray',
];

export const DEFAULT_GROUP_COLOR: GroupColor = 'blue';

export interface TaskGroup {
    readonly id: string;
    readonly title: string;
    readonly color: GroupColor;
    /**
     * Whether the section is folded shut in the popup. This is view state, but
     * it lives in the data file on purpose: it is per-group, and a group that
     * travels between devices should arrive folded the way it was left.
     */
    readonly collapsed: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
    /** Bumped on every mutation. Groundwork for sync conflict detection. */
    readonly revision: number;
}

export interface NewGroupInput {
    readonly title: string;
    readonly color?: GroupColor;
}

export function createGroup(ctx: DomainContext, input: NewGroupInput): TaskGroup {
    const title = normalizeTitle(input.title);
    if (title === '') throw new RangeError('A group needs a non-empty title');

    const now = ctx.clock.now();
    return {
        id: ctx.ids.next(),
        title,
        color: input.color ?? DEFAULT_GROUP_COLOR,
        collapsed: false,
        createdAt: now,
        updatedAt: now,
        revision: 1,
    };
}

/**
 * Apply a partial change, stamping `updatedAt` and bumping `revision`. Returns
 * the original object when nothing actually changed, so callers can skip a
 * repaint and a disk write with a cheap identity check.
 */
export function touchGroup(
    ctx: DomainContext,
    group: TaskGroup,
    changes: Partial<Omit<TaskGroup, 'id' | 'createdAt' | 'updatedAt' | 'revision'>>,
): TaskGroup {
    const changed = (Object.keys(changes) as (keyof typeof changes)[]).some(
        (key) => changes[key] !== undefined && changes[key] !== group[key],
    );
    if (!changed) return group;

    return {
        ...group,
        ...changes,
        updatedAt: ctx.clock.now(),
        revision: group.revision + 1,
    };
}

export function renameGroup(ctx: DomainContext, group: TaskGroup, rawTitle: string): TaskGroup {
    const title = normalizeTitle(rawTitle);
    if (title === '') throw new RangeError('A group needs a non-empty title');
    return touchGroup(ctx, group, {title});
}

export function recolorGroup(ctx: DomainContext, group: TaskGroup, color: GroupColor): TaskGroup {
    return touchGroup(ctx, group, {color});
}

export function toggleGroupCollapsed(ctx: DomainContext, group: TaskGroup): TaskGroup {
    return touchGroup(ctx, group, {collapsed: !group.collapsed});
}
