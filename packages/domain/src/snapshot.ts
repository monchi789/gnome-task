/**
 * On-disk representation and its parser.
 *
 * Kept in the domain package (not in the GJS infrastructure layer) for two
 * reasons: the format must stay portable across future clients, and parsing
 * corrupt input is exactly the logic that most needs unit tests.
 *
 * The parser is deliberately forgiving about individual records — one bad task
 * or group is skipped, not fatal — but strict about the envelope. An envelope
 * this build does not understand throws, and the caller quarantines the file
 * instead of silently overwriting data it cannot read.
 */

import type {Priority, Task, TaskStatus} from './task.ts';
import {MAX_TITLE_LENGTH, PRIORITIES, TASK_STATUSES, normalizeTitle} from './task.ts';
import type {GroupColor, TaskGroup} from './group.ts';
import {DEFAULT_GROUP_COLOR, GROUP_COLORS} from './group.ts';
import {Board} from './board.ts';
import {GroupCollection} from './group-collection.ts';
import {TaskCollection} from './task-collection.ts';

/** What this build writes. */
export const SCHEMA_VERSION = 2;

/**
 * What this build reads. Version 1 had no `groups` key; its tasks all load
 * into the inbox. Rejecting it would send every existing file to quarantine.
 */
const READABLE_VERSIONS: readonly number[] = [1, 2];

export interface Snapshot {
    readonly schemaVersion: number;
    readonly groups: readonly TaskGroup[];
    readonly tasks: readonly Task[];
}

export class SnapshotFormatError extends Error {
    override readonly name = 'SnapshotFormatError';
}

export interface DecodeResult {
    readonly board: Board;
    /** Records that failed validation and were dropped. */
    readonly skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function asStatus(value: unknown): TaskStatus {
    return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : 'todo';
}

function asPriority(value: unknown): Priority {
    return PRIORITIES.includes(value as Priority) ? (value as Priority) : 'none';
}

function asColor(value: unknown): GroupColor {
    return GROUP_COLORS.includes(value as GroupColor) ? (value as GroupColor) : DEFAULT_GROUP_COLOR;
}

function asRevision(value: unknown): number {
    return Number.isInteger(value) && (value as number) > 0 ? (value as number) : 1;
}

/**
 * Validate one record. Returns null when the task is unusable — that means no
 * id or no title, the two fields nothing can be reconstructed from.
 */
export function parseTask(value: unknown): Task | null {
    if (!isRecord(value)) return null;

    const id = value['id'];
    if (typeof id !== 'string' || id === '') return null;

    const title = normalizeTitle(asString(value['title'], ''));
    if (title === '') return null;

    const createdAt = asString(value['createdAt'], new Date(0).toISOString());

    return {
        id,
        title,
        description: asString(value['description'], '').slice(0, MAX_TITLE_LENGTH * 20),
        status: asStatus(value['status']),
        priority: asPriority(value['priority']),
        projectId: asNullableString(value['projectId']),
        dueDate: asNullableString(value['dueDate']),
        createdAt,
        updatedAt: asString(value['updatedAt'], createdAt),
        revision: asRevision(value['revision']),
    };
}

/** Same contract as `parseTask`: an id and a title, or nothing. */
export function parseGroup(value: unknown): TaskGroup | null {
    if (!isRecord(value)) return null;

    const id = value['id'];
    if (typeof id !== 'string' || id === '') return null;

    const title = normalizeTitle(asString(value['title'], ''));
    if (title === '') return null;

    const createdAt = asString(value['createdAt'], new Date(0).toISOString());

    return {
        id,
        title,
        color: asColor(value['color']),
        collapsed: value['collapsed'] === true,
        createdAt,
        updatedAt: asString(value['updatedAt'], createdAt),
        revision: asRevision(value['revision']),
    };
}

export function encodeSnapshot(board: Board): string {
    const snapshot: Snapshot = {
        schemaVersion: SCHEMA_VERSION,
        groups: board.groups.all(),
        tasks: board.tasks.all(),
    };
    return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * @throws {SnapshotFormatError} on malformed JSON or an unreadable envelope.
 */
export function decodeSnapshot(text: string): DecodeResult {
    // An empty or blank file is a legitimate "nothing stored yet", not damage.
    if (text.trim() === '') return {board: Board.EMPTY, skipped: 0};

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (cause) {
        throw new SnapshotFormatError('Stored tasks are not valid JSON', {cause});
    }

    if (!isRecord(parsed)) throw new SnapshotFormatError('Snapshot root is not an object');

    const version = parsed['schemaVersion'];
    if (typeof version !== 'number' || !READABLE_VERSIONS.includes(version)) {
        throw new SnapshotFormatError(
            `Unsupported schema version ${String(version)}; this build understands ` +
                READABLE_VERSIONS.join(' and '),
        );
    }

    const rawTasks = parsed['tasks'];
    if (!Array.isArray(rawTasks)) throw new SnapshotFormatError('Snapshot "tasks" is not an array');

    // Absent in version 1, and absent is not the same as malformed.
    const rawGroups = parsed['groups'] ?? [];
    if (!Array.isArray(rawGroups)) {
        throw new SnapshotFormatError('Snapshot "groups" is not an array');
    }

    let skipped = 0;

    const groups: TaskGroup[] = [];
    for (const raw of rawGroups) {
        const group = parseGroup(raw);
        if (group === null) skipped++;
        else groups.push(group);
    }
    const collection = GroupCollection.from(groups);

    const tasks: Task[] = [];
    for (const raw of rawTasks) {
        const task = parseTask(raw);
        if (task === null) {
            skipped++;
            continue;
        }
        // A task pointing at a group that is gone would belong to a section
        // nothing draws. Send it back to the inbox rather than lose it.
        tasks.push(
            task.projectId !== null && !collection.has(task.projectId)
                ? {...task, projectId: null}
                : task,
        );
    }

    return {board: Board.from(collection, TaskCollection.from(tasks)), skipped};
}
