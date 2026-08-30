import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {TaskCollection} from '../src/task-collection.ts';
import {testContext} from './support.ts';

function seeded() {
    const ctx = testContext();
    const collection = TaskCollection.EMPTY.add(ctx, {title: 'Terminar API'})
        .add(ctx, {title: 'Comprar SSD'})
        .add(ctx, {title: 'Deploy VPS'});
    return {ctx, collection};
}

describe('TaskCollection', () => {
    it('starts empty', () => {
        assert.equal(TaskCollection.EMPTY.isEmpty, true);
        assert.equal(TaskCollection.EMPTY.size, 0);
        assert.equal(TaskCollection.EMPTY.pendingCount, 0);
    });

    it('appends in insertion order without mutating the receiver', () => {
        const {collection} = seeded();
        assert.deepEqual(
            collection.all().map((t) => t.title),
            ['Terminar API', 'Comprar SSD', 'Deploy VPS'],
        );
        assert.equal(TaskCollection.EMPTY.size, 0, 'EMPTY must stay empty');
    });

    it('counts only pending tasks', () => {
        const {ctx, collection} = seeded();
        assert.equal(collection.pendingCount, 3);
        assert.equal(collection.toggle(ctx, 'task-2').pendingCount, 2);
    });

    it('sinks completed tasks to the bottom in ordered()', () => {
        const {ctx, collection} = seeded();
        const withDone = collection.toggle(ctx, 'task-1');

        assert.deepEqual(
            withDone.ordered().map((t) => t.title),
            ['Comprar SSD', 'Deploy VPS', 'Terminar API'],
        );
        assert.deepEqual(
            withDone.all().map((t) => t.title),
            ['Terminar API', 'Comprar SSD', 'Deploy VPS'],
            'storage order must be untouched',
        );
    });

    it('removes by id and collapses to EMPTY', () => {
        const {ctx, collection} = seeded();
        assert.equal(collection.remove('task-2').size, 2);
        assert.equal(
            TaskCollection.EMPTY.add(ctx, {title: 'solo'}).remove('task-4'),
            TaskCollection.EMPTY,
        );
    });

    it('returns the same instance for no-op operations', () => {
        const {ctx, collection} = seeded();

        // Unknown ids must not allocate — the caller treats `!==` as "persist".
        assert.equal(collection.remove('nope'), collection);
        assert.equal(collection.toggle(ctx, 'nope'), collection);
        assert.equal(collection.rename(ctx, 'nope', 'x'), collection);
        assert.equal(collection.rename(ctx, 'task-1', 'Terminar API'), collection);
        assert.equal(collection.clearCompleted(), collection);
    });

    it('renames in place, keeping position', () => {
        const {ctx, collection} = seeded();
        const renamed = collection.rename(ctx, 'task-2', 'Comprar NVMe');

        assert.equal(renamed.find('task-2')?.title, 'Comprar NVMe');
        assert.deepEqual(
            renamed.all().map((t) => t.id),
            ['task-1', 'task-2', 'task-3'],
        );
    });

    it('clears completed tasks only', () => {
        const {ctx, collection} = seeded();
        const cleared = collection.toggle(ctx, 'task-1').toggle(ctx, 'task-3').clearCompleted();

        assert.deepEqual(
            cleared.all().map((t) => t.title),
            ['Comprar SSD'],
        );
    });

    it('drops duplicate ids in from(), first wins', () => {
        const {collection} = seeded();
        const doubled = TaskCollection.from([...collection.all(), ...collection.all()]);
        assert.equal(doubled.size, 3);
    });
});
