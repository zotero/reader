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
	let manager = new AnnotationManager({
		annotations: [],
		onSave: annotations => savedBatches.push(annotations.map(x => x.id)),
		onDelete: () => {},
		onRender: () => {},
		onChangeFilter: () => {},
		...options,
	});
	return { manager, savedBatches };
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

test('skipSavingDebounce: updates of an existing annotation save synchronously', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setup({ saveNewAnnotationsImmediately: true, skipSavingDebounce: true });

	let annotation = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[annotation.id]]);
	await drain();

	// Within both debounce windows of the previous save
	manager.updateAnnotations([{ id: annotation.id, color: '#ff6666' }]);
	assert.deepEqual(savedBatches, [[annotation.id], [annotation.id]]);
	await drain();

	manager.updateAnnotations([{ id: annotation.id, color: '#5fb236' }]);
	assert.deepEqual(savedBatches, [[annotation.id], [annotation.id], [annotation.id]]);
});

test('without skipSavingDebounce, updates of an existing annotation are debounced', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setup({ saveNewAnnotationsImmediately: true });

	let annotation = manager.addAnnotation(newAnnotation());
	await drain();

	manager.updateAnnotations([{ id: annotation.id, color: '#ff6666' }]);
	assert.equal(savedBatches.length, 1);

	t.mock.timers.tick(1000);
	assert.deepEqual(savedBatches, [[annotation.id], [annotation.id]]);
});
