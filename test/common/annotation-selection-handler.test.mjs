import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnnotationSelectionHandler } from '../../src/common/annotation-selection-handler.mjs';

function setup() {
	let calls = [];
	let selectedIDs = [];
	let deferred = [];
	let handle = createAnnotationSelectionHandler({
		select(ids) {
			calls.push(['select', ids]);
			selectedIDs = ids;
		},
		notify(ids, options) {
			calls.push(['notify', ids, options]);
		},
		defer(callback) {
			deferred.push(callback);
		},
		getSelectedIDs() {
			return selectedIDs;
		},
	});
	return {
		calls,
		deferred,
		handle,
		setSelectedIDs(ids) {
			selectedIDs = ids;
		},
	};
}

test('preserves host-first ordering for ordinary annotation selection', () => {
	let { calls, handle } = setup();
	handle(['A']);
	assert.deepEqual(calls, [
		['notify', ['A'], {}],
		['select', ['A']],
	]);
});

test('selects before deferring an inline-editing notification', () => {
	let { calls, deferred, handle } = setup();
	let options = { inlineTextEditing: true };
	handle(['A'], options);
	assert.deepEqual(calls, [['select', ['A']]]);

	deferred[0]();
	assert.deepEqual(calls, [
		['select', ['A']],
		['notify', ['A'], options],
	]);
});

test('drops a deferred inline-editing notification after selection changes', () => {
	let { calls, deferred, handle, setSelectedIDs } = setup();
	handle(['A'], { inlineTextEditing: true });
	setSelectedIDs(['B']);
	deferred[0]();
	assert.deepEqual(calls, [['select', ['A']]]);
});

test('drops a deferred inline-editing notification superseded by a same-id selection', () => {
	let { calls, deferred, handle } = setup();
	let options = { inlineTextEditing: true };
	handle(['A'], options);
	handle(['A']);
	deferred[0]();
	assert.deepEqual(calls, [
		['select', ['A']],
		['notify', ['A'], {}],
		['select', ['A']],
	]);
});
