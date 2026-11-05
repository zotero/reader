/* global globalThis */

import assert from 'node:assert/strict';
import test from 'node:test';

// src/common/lib/utilities.js sniffs the browser at module load
globalThis.window ??= {};

const { default: AnnotationManager } = await import('../../src/common/annotation-manager.js');
// Well past DEBOUNCE_MAX_TIME (10s), so the first save is never itself debounced
const START_TIME = 1_000_000;

function setup(options = {}) {
	let savedBatches = [];
	let deletedBatches = [];
	let manager = new AnnotationManager({
		annotations: [],
		onSave: annotations => savedBatches.push(annotations.map(x => x.id)),
		onDelete: ids => deletedBatches.push(ids.slice()),
		onRender: () => {},
		onChangeFilter: () => {},
		...options,
	});
	return { manager, savedBatches, deletedBatches };
}

function newAnnotation() {
	// The only properties addAnnotation() requires
	return { color: '#ffd400', sortIndex: '00000|000000|00000' };
}

// _triggerSaving() suspends at `await this._onSave(...)` with _savingInProgress
// still set; let its continuation run, as it would before the next user action
function drain() {
	return new Promise(resolve => setImmediate(resolve));
}

test('saveNewAnnotationsImmediately: every creation saves synchronously, even in quick succession', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setup({ saveNewAnnotationsImmediately: true });

	let first = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[first.id]]);
	await drain();

	// Still within both debounce windows of the previous save
	let second = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[first.id], [second.id]]);
});

test('without saveNewAnnotationsImmediately (desktop), rapid consecutive creations are debounced', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setup();

	let first = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[first.id]]);
	await drain();

	let second = manager.addAnnotation(newAnnotation());
	assert.equal(savedBatches.length, 1);

	t.mock.timers.tick(1000);
	assert.deepEqual(savedBatches, [[first.id], [second.id]]);
});

test('an immediate-save request survives an in-progress save without affecting later saves', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, deletedBatches } = setup({
		saveNewAnnotationsImmediately: true,
		annotations: ['A', 'B'].map(id => ({ ...newAnnotation(), id })),
	});
	manager.updateAnnotations([{ id: 'A', color: '#ff0000' }]);
	manager._skipAnnotationSavingDebounce = true;
	manager.deleteAnnotations(['B']);
	manager._skipAnnotationSavingDebounce = false;
	await drain();
	assert.deepEqual(deletedBatches.flat(), ['B']);
	manager.deleteAnnotations(['A']);
	await drain();
	assert.deepEqual(deletedBatches.flat(), ['B']);
	t.mock.timers.tick(1000);
	assert.deepEqual(deletedBatches.flat(), ['B', 'A']);
});

test('stale deletion requests do not create invalid Undo steps', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager } = setup({ annotations: [{ ...newAnnotation(), id: 'A' }] });
	assert.equal(manager.deleteAnnotations(['missing']), 0);
	assert.equal(manager.canUndo, false);
	assert.equal(manager.deleteAnnotations(['A']), 1);
	assert.equal(manager.deleteAnnotations(['A']), 0);
	assert.equal(manager._undoStack.length, 1);
	assert.equal(manager.undo(), true);
	assert.equal(manager._annotations.length, 1);
	await drain();
	t.mock.timers.tick(1000);
});

test('Undo preserves an unsent deletion when the restored annotation gets a new ID', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches, deletedBatches } = setup({ saveNewAnnotationsImmediately: true });
	let annotation = manager.addAnnotation(newAnnotation());
	await drain();
	manager.deleteAnnotations([annotation.id]);
	manager.undo();
	await drain();
	let restored = manager._annotations[0];
	assert.notEqual(restored.id, annotation.id);
	assert.deepEqual(deletedBatches.flat(), [annotation.id]);
	assert.deepEqual(savedBatches, [[annotation.id], [restored.id]]);
	assert.equal(manager._clientKnownAnnotationIDs.has(restored.id), true);
});

test('Redo preserves an unsent deletion when the restored annotation gets a new ID', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches, deletedBatches } = setup();
	let annotation = manager.addAnnotation(newAnnotation());
	await drain();
	manager.undo();
	manager.redo();
	t.mock.timers.tick(1000);
	await drain();
	let restored = manager._annotations[0];
	assert.notEqual(restored.id, annotation.id);
	assert.deepEqual(deletedBatches.flat(), [annotation.id]);
	assert.deepEqual(savedBatches, [[annotation.id], [restored.id]]);
});
