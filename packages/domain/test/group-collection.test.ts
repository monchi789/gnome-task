import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {GroupCollection} from '../src/group-collection.ts';
import {testContext} from './support.ts';

function seeded() {
    const ctx = testContext();
    const groups = GroupCollection.EMPTY.add(ctx, {title: 'Trabajo'})
        .add(ctx, {title: 'Personal', color: 'green'})
        .add(ctx, {title: 'Casa', color: 'red'});
    return {ctx, groups};
}

describe('GroupCollection', () => {
    it('starts empty and appends in insertion order', () => {
        const {groups} = seeded();
        assert.equal(GroupCollection.EMPTY.isEmpty, true);
        assert.deepEqual(
            groups.all().map((g) => g.title),
            ['Trabajo', 'Personal', 'Casa'],
        );
    });

    it('defaults the colour and remembers an explicit one', () => {
        const {groups} = seeded();
        assert.equal(groups.find('task-1')?.color, 'blue');
        assert.equal(groups.find('task-2')?.color, 'green');
    });

    it('renames, recolours and folds in place', () => {
        const {ctx, groups} = seeded();
        const edited = groups
            .rename(ctx, 'task-1', 'Chamba')
            .recolor(ctx, 'task-1', 'purple')
            .toggleCollapsed(ctx, 'task-1');

        const group = edited.find('task-1');
        assert.equal(group?.title, 'Chamba');
        assert.equal(group?.color, 'purple');
        assert.equal(group?.collapsed, true);
        assert.equal(group?.revision, 4, 'every edit bumps the revision');
        assert.deepEqual(
            edited.all().map((g) => g.id),
            ['task-1', 'task-2', 'task-3'],
            'editing must not reorder',
        );
    });

    it('returns the same instance for no-op operations', () => {
        const {ctx, groups} = seeded();

        assert.equal(groups.remove('nope'), groups);
        assert.equal(groups.rename(ctx, 'nope', 'x'), groups);
        assert.equal(groups.rename(ctx, 'task-1', 'Trabajo'), groups);
        assert.equal(groups.recolor(ctx, 'task-1', 'blue'), groups);
        assert.equal(groups.toggleCollapsed(ctx, 'nope'), groups);
        assert.equal(groups.move('nope', null), groups);
        assert.equal(groups.move('task-1', 'task-1'), groups);
        assert.equal(groups.move('task-1', 'gone'), groups, 'an unknown anchor moves nothing');
        assert.equal(groups.move('task-1', 'task-2'), groups, 'already there');
        assert.equal(groups.move('task-3', null), groups, 'already last');
    });

    it('moves a group above the anchor', () => {
        const {groups} = seeded();
        assert.deepEqual(
            groups
                .move('task-3', 'task-1')
                .all()
                .map((g) => g.title),
            ['Casa', 'Trabajo', 'Personal'],
        );
        assert.deepEqual(
            groups
                .move('task-1', 'task-3')
                .all()
                .map((g) => g.title),
            ['Personal', 'Trabajo', 'Casa'],
        );
    });

    it('moves a group to the end with a null anchor', () => {
        const {groups} = seeded();
        assert.deepEqual(
            groups
                .move('task-1', null)
                .all()
                .map((g) => g.title),
            ['Personal', 'Casa', 'Trabajo'],
        );
    });

    it('rejects a blank title', () => {
        const ctx = testContext();
        assert.throws(() => GroupCollection.EMPTY.add(ctx, {title: '   '}), RangeError);
    });

    it('drops duplicate ids in from(), first wins', () => {
        const {groups} = seeded();
        assert.equal(GroupCollection.from([...groups.all(), ...groups.all()]).size, 3);
    });
});
