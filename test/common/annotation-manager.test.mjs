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

// Rendering

function setupWithAnnotations(annotations, options = {}) {
	let renders = [];
	let { manager, savedBatches } = setup({
		annotations,
		onRender: annotations => renders.push(annotations),
		adjustTextAnnotationPosition: annotation => annotation.position,
		...options,
	});
	// Drop the initial render from the constructor
	renders.length = 0;
	return { manager, savedBatches, renders };
}

function existingAnnotation(id, sortIndex, props = {}) {
	return {
		id,
		type: 'highlight',
		color: '#ffd400',
		sortIndex,
		text: '',
		comment: '',
		tags: [],
		position: { pageIndex: 0, rects: [[0, 0, 1, 1]] },
		...props,
	};
}

function threeHighlights() {
	return [
		existingAnnotation('AAAAAAAA', '00000|000000|00000'),
		existingAnnotation('BBBBBBBB', '00000|000001|00000'),
		existingAnnotation('CCCCCCCC', '00000|000002|00000'),
	];
}

test('typing a comment defers and coalesces renders', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, renders } = setupWithAnnotations(threeHighlights());

	manager.updateAnnotations([{ id: 'BBBBBBBB', comment: 'a' }]);
	t.mock.timers.tick(100);
	manager.updateAnnotations([{ id: 'BBBBBBBB', comment: 'ab' }]);
	t.mock.timers.tick(100);
	manager.updateAnnotations([{ id: 'BBBBBBBB', comment: 'abc' }]);
	assert.equal(renders.length, 0);
	// The manager's own data is up to date immediately
	assert.equal(manager._getAnnotationByID('BBBBBBBB').comment, 'abc');

	t.mock.timers.tick(300);
	assert.equal(renders.length, 1);
	assert.equal(renders[0].find(x => x.id === 'BBBBBBBB').comment, 'abc');
});

test('continuous typing still renders at least every second', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, renders } = setupWithAnnotations(threeHighlights());

	let comment = '';
	for (let i = 0; i < 10; i++) {
		comment += 'a';
		manager.updateAnnotations([{ id: 'BBBBBBBB', comment }]);
		t.mock.timers.tick(150);
	}
	// 1500ms of typing, a key every 150ms
	assert.equal(renders.length, 1);
	assert.equal(renders[0].find(x => x.id === 'BBBBBBBB').comment.length, 7);
});

test('a non-comment change renders immediately and flushes a deferred render', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, renders } = setupWithAnnotations(threeHighlights());

	manager.updateAnnotations([{ id: 'BBBBBBBB', comment: 'abc' }]);
	manager.updateAnnotations([{ id: 'AAAAAAAA', color: '#ff6666' }]);
	assert.equal(renders.length, 1);
	assert.equal(renders[0].find(x => x.id === 'BBBBBBBB').comment, 'abc');
	assert.equal(renders[0].find(x => x.id === 'AAAAAAAA').color, '#ff6666');

	// The deferred render was replaced, not just preceded
	t.mock.timers.tick(1000);
	assert.equal(renders.length, 1);
});

test('editing the comment of a text annotation renders immediately', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let annotations = [existingAnnotation('AAAAAAAA', '00000|000000|00000', { type: 'text' })];
	let { manager, renders } = setupWithAnnotations(annotations);

	manager.updateAnnotations([{ id: 'AAAAAAAA', comment: 'a' }]);
	assert.equal(renders.length, 1);
});

test('clearing a comment renders immediately', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let annotations = [existingAnnotation('AAAAAAAA', '00000|000000|00000', { comment: 'a' })];
	let { manager, renders } = setupWithAnnotations(annotations);

	manager.updateAnnotations([{ id: 'AAAAAAAA', comment: '' }]);
	assert.equal(renders.length, 1);
});

test('undo after typing renders the restored comment immediately', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, renders } = setupWithAnnotations(threeHighlights());

	manager.updateAnnotations([{ id: 'BBBBBBBB', comment: 'abc' }]);
	manager.undo();
	assert.equal(renders.length, 1);
	assert.equal(renders[0].find(x => x.id === 'BBBBBBBB').comment, '');
	t.mock.timers.tick(1000);
	assert.equal(renders.length, 1);
});

test('deferring rendering does not change saving', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setupWithAnnotations(threeHighlights());

	manager.updateAnnotations([{ id: 'BBBBBBBB', comment: 'abc' }]);
	assert.deepEqual(savedBatches, [['BBBBBBBB']]);
});

test('updates keep annotations sorted, re-sorting only when sortIndex changes', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, renders } = setupWithAnnotations(threeHighlights());

	manager.updateAnnotations([{ id: 'AAAAAAAA', color: '#ff6666' }]);
	assert.deepEqual(renders.at(-1).map(x => x.id), ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC']);

	manager.updateAnnotations([{
		id: 'AAAAAAAA',
		sortIndex: '00000|000003|00000',
		position: { pageIndex: 0, rects: [[0, 2, 1, 3]] },
	}]);
	assert.deepEqual(renders.at(-1).map(x => x.id), ['BBBBBBBB', 'CCCCCCCC', 'AAAAAAAA']);

	// Rendered arrays are copies, so in-place updates never mutate a rendered array
	let rendered = renders.at(-1);
	manager.updateAnnotations([{ id: 'CCCCCCCC', color: '#ff6666' }]);
	assert.equal(rendered.find(x => x.id === 'CCCCCCCC').color, '#ffd400');
});
