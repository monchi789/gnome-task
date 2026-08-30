/**
 * Turning "move this one step up" into a drop target.
 *
 * This is view-order arithmetic — it works on the sections the popup actually
 * draws, where completed tasks have already sunk — but it is pure data, so it
 * lives here where it can be unit-tested instead of inside a GJS widget.
 *
 * Both functions return null when the move is impossible (already at the top,
 * already at the bottom), which callers treat as "do nothing".
 */

import type {Section, TaskDropTarget} from './board.ts';

/** -1 moves towards the top of the popup, +1 towards the bottom. */
export type Step = -1 | 1;

export function taskTargetForStep(
    sections: readonly Section[],
    taskId: string,
    step: Step,
): TaskDropTarget | null {
    const at = locate(sections, taskId);
    if (at === null) return null;

    const {sectionIndex, taskIndex} = at;
    const section = sections[sectionIndex] as Section;
    const groupId = section.group?.id ?? null;

    if (step === -1) {
        // Above the neighbour, or into the end of the section above.
        if (taskIndex > 0) {
            return {groupId, beforeTaskId: section.tasks[taskIndex - 1]?.id ?? null};
        }
        const previous = sections[sectionIndex - 1];
        if (previous === undefined) return null;
        return {groupId: previous.group?.id ?? null, beforeTaskId: null};
    }

    // Below the neighbour means above whatever follows the neighbour.
    if (taskIndex < section.tasks.length - 1) {
        return {groupId, beforeTaskId: section.tasks[taskIndex + 2]?.id ?? null};
    }
    const next = sections[sectionIndex + 1];
    if (next === undefined) return null;
    return {groupId: next.group?.id ?? null, beforeTaskId: next.tasks[0]?.id ?? null};
}

/**
 * The `beforeGroupId` anchor that moves a group one step, or null-inside-a-box
 * for "move it last". The outer null still means "impossible".
 */
export function groupAnchorForStep(
    sections: readonly Section[],
    groupId: string,
    step: Step,
): {readonly beforeGroupId: string | null} | null {
    const ids = sections.flatMap((section) => (section.group ? [section.group.id] : []));
    const index = ids.indexOf(groupId);
    if (index === -1) return null;

    if (step === -1) {
        const previous = ids[index - 1];
        return previous === undefined ? null : {beforeGroupId: previous};
    }

    if (index === ids.length - 1) return null;
    return {beforeGroupId: ids[index + 2] ?? null};
}

function locate(
    sections: readonly Section[],
    taskId: string,
): {sectionIndex: number; taskIndex: number} | null {
    for (const [sectionIndex, section] of sections.entries()) {
        const taskIndex = section.tasks.findIndex((task) => task.id === taskId);
        if (taskIndex !== -1) return {sectionIndex, taskIndex};
    }
    return null;
}
