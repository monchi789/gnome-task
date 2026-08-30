import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
    MAX_TITLE_LENGTH,
    createTask,
    isCompleted,
    normalizeTitle,
    renameTask,
    toggleTask,
    touchTask,
} from '../src/task.ts';
import {testContext} from './support.ts';

describe('normalizeTitle', () => {
    it('collapses runs of whitespace and trims', () => {
        assert.equal(
            normalizeTitle('  Terminar   API \n de\tfacturación '),
            'Terminar API de facturación',
        );
    });

    it('reduces a blanks-only title to the empty string', () => {
        assert.equal(normalizeTitle('   \t\n  '), '');
    });

    it('clamps to MAX_TITLE_LENGTH', () => {
        assert.equal(normalizeTitle('a'.repeat(MAX_TITLE_LENGTH + 50)).length, MAX_TITLE_LENGTH);
    });
});

describe('createTask', () => {
    it('starts pending at revision 1 with matching timestamps', () => {
        const ctx = testContext();
        const task = createTask(ctx, {title: 'Comprar SSD'});

        assert.equal(task.id, 'task-1');
        assert.equal(task.title, 'Comprar SSD');
        assert.equal(task.status, 'todo');
        assert.equal(task.priority, 'none');
        assert.equal(task.dueDate, null);
        assert.equal(task.revision, 1);
        assert.equal(task.createdAt, task.updatedAt);
        assert.equal(isCompleted(task), false);
    });

    it('rejects a title that normalises to empty', () => {
        const ctx = testContext();
        assert.throws(() => createTask(ctx, {title: '   '}), RangeError);
    });
});

describe('touchTask', () => {
    it('returns the very same object when nothing changes', () => {
        const ctx = testContext();
        const task = createTask(ctx, {title: 'Deploy VPS'});

        // Identity, not deep equality: the caller relies on `===` to skip writes.
        assert.equal(touchTask(ctx, task, {status: 'todo'}), task);
    });

    it('bumps revision and updatedAt on a real change', () => {
        const ctx = testContext();
        const task = createTask(ctx, {title: 'Deploy VPS'});
        const updated = touchTask(ctx, task, {priority: 'high'});

        assert.equal(updated.priority, 'high');
        assert.equal(updated.revision, 2);
        assert.notEqual(updated.updatedAt, task.updatedAt);
        assert.equal(updated.createdAt, task.createdAt);
        assert.equal(task.priority, 'none', 'the original must not be mutated');
    });
});

describe('toggleTask', () => {
    it('round-trips between todo and completed', () => {
        const ctx = testContext();
        const task = createTask(ctx, {title: 'Configurar servidor'});

        const done = toggleTask(ctx, task);
        assert.equal(done.status, 'completed');
        assert.equal(isCompleted(done), true);

        const undone = toggleTask(ctx, done);
        assert.equal(undone.status, 'todo');
        assert.equal(undone.revision, 3);
    });
});

describe('renameTask', () => {
    it('normalises the new title', () => {
        const ctx = testContext();
        const task = createTask(ctx, {title: 'Old'});
        assert.equal(renameTask(ctx, task, '  New   title  ').title, 'New title');
    });

    it('refuses a blank rename', () => {
        const ctx = testContext();
        const task = createTask(ctx, {title: 'Old'});
        assert.throws(() => renameTask(ctx, task, '  '), RangeError);
    });
});
