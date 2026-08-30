import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {Board} from '../src/board.ts';
import {
    SCHEMA_VERSION,
    SnapshotFormatError,
    decodeSnapshot,
    encodeSnapshot,
    parseGroup,
    parseTask,
} from '../src/snapshot.ts';
import {testContext} from './support.ts';

describe('encode/decode round-trip', () => {
    it('preserves every task exactly', () => {
        const ctx = testContext();
        const original = Board.EMPTY.addTask(ctx, {title: 'Terminar API', priority: 'high'})
            .addTask(ctx, {title: 'Comprar SSD', dueDate: '2026-09-15'})
            .toggleTask(ctx, 'task-1');

        const {board, skipped} = decodeSnapshot(encodeSnapshot(original));

        assert.equal(skipped, 0);
        assert.deepEqual(board.tasks.all(), original.tasks.all());
    });

    it('preserves groups, their order and their membership', () => {
        const ctx = testContext();
        const original = Board.EMPTY.addGroup(ctx, {title: 'Trabajo', color: 'green'})
            .addGroup(ctx, {title: 'Personal', color: 'red'})
            .addTask(ctx, {title: 'Terminar API', projectId: 'task-1'})
            .toggleGroupCollapsed(ctx, 'task-2');

        const {board, skipped} = decodeSnapshot(encodeSnapshot(original));

        assert.equal(skipped, 0);
        assert.deepEqual(board.groups.all(), original.groups.all());
        assert.equal(board.tasks.find('task-3')?.projectId, 'task-1');
        assert.equal(board.groups.find('task-2')?.collapsed, true);
    });

    it('writes the current schema version', () => {
        const parsed = JSON.parse(encodeSnapshot(Board.EMPTY)) as Record<string, unknown>;
        assert.equal(parsed['schemaVersion'], SCHEMA_VERSION);
        assert.deepEqual(parsed['groups'], []);
        assert.deepEqual(parsed['tasks'], []);
    });
});

describe('decodeSnapshot', () => {
    it('treats a blank file as "nothing stored yet"', () => {
        assert.equal(decodeSnapshot('').board.isEmpty, true);
        assert.equal(decodeSnapshot('   \n').board.isEmpty, true);
    });

    it('throws on malformed JSON', () => {
        assert.throws(() => decodeSnapshot('{not json'), SnapshotFormatError);
    });

    it('throws on an unknown schema version rather than guessing', () => {
        assert.throws(
            () => decodeSnapshot(JSON.stringify({schemaVersion: 99, tasks: []})),
            SnapshotFormatError,
        );
        assert.throws(() => decodeSnapshot(JSON.stringify({tasks: []})), SnapshotFormatError);
    });

    it('reads a version 1 file, putting every task in the inbox', () => {
        // The shape written by 0.1.0-dev, verbatim. Rejecting it would send a
        // real user's file to quarantine on upgrade.
        const legacy = JSON.stringify({
            schemaVersion: 1,
            tasks: [
                {
                    id: 'b0b7caec',
                    title: 'Enviar excel',
                    description: '',
                    status: 'todo',
                    priority: 'none',
                    projectId: null,
                    dueDate: null,
                    createdAt: '2026-08-30T17:23:11.637231Z',
                    updatedAt: '2026-08-30T17:23:11.637231Z',
                    revision: 1,
                },
            ],
        });

        const {board, skipped} = decodeSnapshot(legacy);

        assert.equal(skipped, 0);
        assert.equal(board.groups.isEmpty, true);
        assert.deepEqual(
            board.sections().map((s) => s.group),
            [null],
        );
        assert.equal(board.tasks.find('b0b7caec')?.title, 'Enviar excel');
    });

    it('throws when tasks or groups is not an array', () => {
        assert.throws(
            () => decodeSnapshot(JSON.stringify({schemaVersion: 1, tasks: {}})),
            SnapshotFormatError,
        );
        assert.throws(
            () => decodeSnapshot(JSON.stringify({schemaVersion: 2, tasks: [], groups: {}})),
            SnapshotFormatError,
        );
    });

    it('skips individual bad records but keeps the good ones', () => {
        const text = JSON.stringify({
            schemaVersion: 2,
            groups: [{id: 'g1', title: 'Trabajo'}, {title: 'No id'}, null],
            tasks: [
                {id: 'a', title: 'Valid'},
                null,
                {title: 'No id'},
                {id: 'b', title: '   '},
                42,
                {id: 'c', title: 'Also valid'},
            ],
        });

        const {board, skipped} = decodeSnapshot(text);
        assert.equal(skipped, 6);
        assert.deepEqual(
            board.groups.all().map((g) => g.id),
            ['g1'],
        );
        assert.deepEqual(
            board.tasks.all().map((t) => t.id),
            ['a', 'c'],
        );
    });

    it('sends a task pointing at a missing group back to the inbox', () => {
        const text = JSON.stringify({
            schemaVersion: 2,
            groups: [{id: 'g1', title: 'Trabajo'}],
            tasks: [
                {id: 'a', title: 'Kept', projectId: 'g1'},
                {id: 'b', title: 'Orphan', projectId: 'deleted-group'},
            ],
        });

        const {board, skipped} = decodeSnapshot(text);
        assert.equal(skipped, 0, 'an orphan is repaired, not dropped');
        assert.equal(board.tasks.find('b')?.projectId, null);
        assert.equal(board.tasks.find('a')?.projectId, 'g1');
    });
});

describe('parseTask', () => {
    it('fills defaults for missing optional fields', () => {
        const task = parseTask({id: 'x', title: 'Bare'});
        assert.ok(task);
        assert.equal(task.status, 'todo');
        assert.equal(task.priority, 'none');
        assert.equal(task.description, '');
        assert.equal(task.projectId, null);
        assert.equal(task.dueDate, null);
        assert.equal(task.revision, 1);
        assert.equal(task.updatedAt, task.createdAt);
    });

    it('replaces out-of-range enums with safe defaults', () => {
        const task = parseTask({id: 'x', title: 'T', status: 'exploded', priority: 'urgent'});
        assert.equal(task?.status, 'todo');
        assert.equal(task?.priority, 'none');
    });

    it('rejects records without a usable id or title', () => {
        assert.equal(parseTask({title: 'no id'}), null);
        assert.equal(parseTask({id: '', title: 'blank id'}), null);
        assert.equal(parseTask({id: 'x'}), null);
        assert.equal(parseTask('nope'), null);
        assert.equal(parseTask(null), null);
    });

    it('normalises a messy stored title', () => {
        assert.equal(parseTask({id: 'x', title: '  a   b  '})?.title, 'a b');
    });

    it('rejects a non-positive or fractional revision', () => {
        assert.equal(parseTask({id: 'x', title: 'T', revision: 0})?.revision, 1);
        assert.equal(parseTask({id: 'x', title: 'T', revision: 1.5})?.revision, 1);
    });
});

describe('parseGroup', () => {
    it('fills defaults for missing optional fields', () => {
        const group = parseGroup({id: 'g', title: 'Trabajo'});
        assert.ok(group);
        assert.equal(group.color, 'blue');
        assert.equal(group.collapsed, false);
        assert.equal(group.revision, 1);
        assert.equal(group.updatedAt, group.createdAt);
    });

    it('replaces an unknown colour with the default', () => {
        assert.equal(parseGroup({id: 'g', title: 'T', color: 'chartreuse'})?.color, 'blue');
    });

    it('reads collapsed only from a real boolean', () => {
        assert.equal(parseGroup({id: 'g', title: 'T', collapsed: 'yes'})?.collapsed, false);
        assert.equal(parseGroup({id: 'g', title: 'T', collapsed: true})?.collapsed, true);
    });

    it('rejects records without a usable id or title', () => {
        assert.equal(parseGroup({title: 'no id'}), null);
        assert.equal(parseGroup({id: 'g', title: '  '}), null);
        assert.equal(parseGroup(null), null);
    });
});
