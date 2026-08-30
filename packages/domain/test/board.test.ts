import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {Board} from '../src/board.ts';
import {testContext} from './support.ts';

/**
 * ids run through one counter shared by groups and tasks:
 *   task-1 Trabajo (group)   task-2 Personal (group)
 *   task-3 API      task-4 SSD      task-5 Pan
 */
function seeded() {
    const ctx = testContext();
    const board = Board.EMPTY.addGroup(ctx, {title: 'Trabajo'})
        .addGroup(ctx, {title: 'Personal'})
        .addTask(ctx, {title: 'Terminar API', projectId: 'task-1'})
        .addTask(ctx, {title: 'Comprar SSD', projectId: 'task-1'})
        .addTask(ctx, {title: 'Comprar pan'});
    return {ctx, board};
}

function shape(board: Board) {
    return board
        .sections()
        .map((section) => [section.group?.title ?? 'inbox', section.tasks.map((t) => t.title)]);
}

describe('Board.sections', () => {
    it('puts the inbox first and the groups in their manual order', () => {
        const {board} = seeded();
        assert.deepEqual(shape(board), [
            ['inbox', ['Comprar pan']],
            ['Trabajo', ['Terminar API', 'Comprar SSD']],
            ['Personal', []],
        ]);
    });

    it('hides the inbox when nothing is ungrouped', () => {
        const {ctx, board} = seeded();
        const tidy = board.moveTask(ctx, 'task-5', {groupId: 'task-2', beforeTaskId: null});
        assert.deepEqual(shape(tidy), [
            ['Trabajo', ['Terminar API', 'Comprar SSD']],
            ['Personal', ['Comprar pan']],
        ]);
    });

    it('keeps an empty group visible — its header is the drop target', () => {
        const {board} = seeded();
        assert.deepEqual(
            board.sections().map((s) => s.group?.title),
            [undefined, 'Trabajo', 'Personal'],
        );
    });

    it('sinks completed tasks inside their own section only', () => {
        const {ctx, board} = seeded();
        const done = board.toggleTask(ctx, 'task-3');

        assert.deepEqual(shape(done), [
            ['inbox', ['Comprar pan']],
            ['Trabajo', ['Comprar SSD', 'Terminar API']],
            ['Personal', []],
        ]);
        assert.deepEqual(
            done.tasks.all().map((t) => t.id),
            ['task-3', 'task-4', 'task-5'],
            'storage order must be untouched',
        );
    });

    it('counts pending tasks per group', () => {
        const {ctx, board} = seeded();
        assert.equal(board.pendingIn('task-1'), 2);
        assert.equal(board.toggleTask(ctx, 'task-3').pendingIn('task-1'), 1);
        assert.equal(board.pendingIn(null), 1);
        assert.equal(board.pendingIn('task-2'), 0);
    });
});

describe('Board.moveTask', () => {
    it('moves a task into another group, at the end by default', () => {
        const {ctx, board} = seeded();
        const moved = board.moveTask(ctx, 'task-5', {groupId: 'task-1', beforeTaskId: null});

        assert.equal(moved.tasks.find('task-5')?.projectId, 'task-1');
        assert.deepEqual(shape(moved), [
            ['Trabajo', ['Terminar API', 'Comprar SSD', 'Comprar pan']],
            ['Personal', []],
        ]);
    });

    it('drops a task above the anchor', () => {
        const {ctx, board} = seeded();
        const moved = board.moveTask(ctx, 'task-5', {
            groupId: 'task-1',
            beforeTaskId: 'task-4',
        });

        assert.deepEqual(shape(moved), [
            ['Trabajo', ['Terminar API', 'Comprar pan', 'Comprar SSD']],
            ['Personal', []],
        ]);
    });

    it('reorders inside one group', () => {
        const {ctx, board} = seeded();
        const moved = board.moveTask(ctx, 'task-4', {
            groupId: 'task-1',
            beforeTaskId: 'task-3',
        });

        assert.deepEqual(
            moved.sections()[1]?.tasks.map((t) => t.title),
            ['Comprar SSD', 'Terminar API'],
        );
    });

    it('ignores an anchor that lives in another group', () => {
        const {ctx, board} = seeded();
        // task-3 is in Trabajo; landing in the inbox it cannot be an anchor.
        const moved = board.moveTask(ctx, 'task-4', {groupId: null, beforeTaskId: 'task-3'});

        assert.deepEqual(shape(moved), [
            ['inbox', ['Comprar pan', 'Comprar SSD']],
            ['Trabajo', ['Terminar API']],
            ['Personal', []],
        ]);
    });

    it('sends a task dropped on an unknown group to the inbox', () => {
        const {ctx, board} = seeded();
        const moved = board.moveTask(ctx, 'task-3', {groupId: 'gone', beforeTaskId: null});
        assert.equal(moved.tasks.find('task-3')?.projectId, null);
    });

    it('returns the same instance when nothing moves', () => {
        const {ctx, board} = seeded();
        assert.equal(board.moveTask(ctx, 'nope', {groupId: null, beforeTaskId: null}), board);
        assert.equal(
            board.moveTask(ctx, 'task-4', {groupId: 'task-1', beforeTaskId: null}),
            board,
            'already last in its group',
        );
    });
});

describe('Board group lifecycle', () => {
    it('keeps the tasks of a deleted group, back in the inbox', () => {
        const {ctx, board} = seeded();
        const pruned = board.removeGroup(ctx, 'task-1');

        assert.equal(pruned.groups.has('task-1'), false);
        assert.deepEqual(shape(pruned), [
            ['inbox', ['Terminar API', 'Comprar SSD', 'Comprar pan']],
            ['Personal', []],
        ]);
    });

    it('moves a group with everything in it', () => {
        const {board} = seeded();
        assert.deepEqual(shape(board.moveGroup('task-2', 'task-1')), [
            ['inbox', ['Comprar pan']],
            ['Personal', []],
            ['Trabajo', ['Terminar API', 'Comprar SSD']],
        ]);
    });

    it('lands a task added to an unknown group in the inbox', () => {
        const {ctx, board} = seeded();
        const added = board.addTask(ctx, {title: 'Huérfana', projectId: 'gone'});
        assert.equal(added.tasks.find('task-6')?.projectId, null);
    });

    it('returns the same instance for no-op operations', () => {
        const {ctx, board} = seeded();
        assert.equal(board.removeGroup(ctx, 'nope'), board);
        assert.equal(board.moveGroup('nope', null), board);
        assert.equal(board.renameGroup(ctx, 'task-1', 'Trabajo'), board);
        assert.equal(board.removeTask('nope'), board);
        assert.equal(board.clearCompleted(), board);
    });
});
