import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {Board} from '../src/board.ts';
import {groupAnchorForStep, taskTargetForStep} from '../src/reorder.ts';
import {testContext} from './support.ts';

/**
 *   inbox     task-5 Pan
 *   Trabajo   task-3 API, task-4 SSD
 *   Personal  task-6 Gym
 */
function seeded() {
    const ctx = testContext();
    const board = Board.EMPTY.addGroup(ctx, {title: 'Trabajo'})
        .addGroup(ctx, {title: 'Personal'})
        .addTask(ctx, {title: 'API', projectId: 'task-1'})
        .addTask(ctx, {title: 'SSD', projectId: 'task-1'})
        .addTask(ctx, {title: 'Pan'})
        .addTask(ctx, {title: 'Gym', projectId: 'task-2'});
    return {ctx, board, sections: board.sections()};
}

/** Apply the step and read back what the popup would draw. */
function afterTaskStep(id: string, step: -1 | 1) {
    const {ctx, board, sections} = seeded();
    const target = taskTargetForStep(sections, id, step);
    assert.ok(target, 'expected the move to be possible');
    return board
        .moveTask(ctx, id, target)
        .sections()
        .map((s) => [s.group?.title ?? 'inbox', s.tasks.map((t) => t.title)]);
}

describe('taskTargetForStep', () => {
    it('swaps with the neighbour above', () => {
        assert.deepEqual(afterTaskStep('task-4', -1), [
            ['inbox', ['Pan']],
            ['Trabajo', ['SSD', 'API']],
            ['Personal', ['Gym']],
        ]);
    });

    it('swaps with the neighbour below', () => {
        assert.deepEqual(afterTaskStep('task-3', 1), [
            ['inbox', ['Pan']],
            ['Trabajo', ['SSD', 'API']],
            ['Personal', ['Gym']],
        ]);
    });

    it('crosses into the section above, landing last', () => {
        assert.deepEqual(afterTaskStep('task-3', -1), [
            ['inbox', ['Pan', 'API']],
            ['Trabajo', ['SSD']],
            ['Personal', ['Gym']],
        ]);
    });

    it('crosses into the section below, landing first', () => {
        assert.deepEqual(afterTaskStep('task-4', 1), [
            ['inbox', ['Pan']],
            ['Trabajo', ['API']],
            ['Personal', ['SSD', 'Gym']],
        ]);
    });

    it('refuses to move past either end of the popup', () => {
        const {sections} = seeded();
        assert.equal(taskTargetForStep(sections, 'task-5', -1), null);
        assert.equal(taskTargetForStep(sections, 'task-6', 1), null);
        assert.equal(taskTargetForStep(sections, 'nope', -1), null);
    });
});

describe('groupAnchorForStep', () => {
    it('moves a group up and down, never above the inbox', () => {
        const {board, sections} = seeded();

        assert.deepEqual(groupAnchorForStep(sections, 'task-2', -1), {beforeGroupId: 'task-1'});
        assert.deepEqual(
            board
                .moveGroup('task-2', 'task-1')
                .sections()
                .map((s) => s.group?.title ?? 'inbox'),
            ['inbox', 'Personal', 'Trabajo'],
        );

        assert.deepEqual(groupAnchorForStep(sections, 'task-1', 1), {beforeGroupId: null});
        assert.equal(groupAnchorForStep(sections, 'task-1', -1), null, 'already first');
        assert.equal(groupAnchorForStep(sections, 'task-2', 1), null, 'already last');
        assert.equal(groupAnchorForStep(sections, 'nope', 1), null);
    });

    it('anchors above the group after the next one', () => {
        const ctx = testContext();
        const board = Board.EMPTY.addGroup(ctx, {title: 'A'})
            .addGroup(ctx, {title: 'B'})
            .addGroup(ctx, {title: 'C'});

        const anchor = groupAnchorForStep(board.sections(), 'task-1', 1);
        assert.deepEqual(anchor, {beforeGroupId: 'task-3'});
        assert.deepEqual(
            board
                .moveGroup('task-1', anchor?.beforeGroupId ?? null)
                .groups.all()
                .map((g) => g.title),
            ['B', 'A', 'C'],
        );
    });
});
