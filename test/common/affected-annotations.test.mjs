/* global globalThis */

import assert from 'node:assert/strict';
import test from 'node:test';

// src/common/lib/utilities.js sniffs the browser at module load
globalThis.window ??= {};

const { getAffectedAnnotations } = await import('../../src/common/lib/utilities.js');

function annotation(props) {
	return {
		id: 'AAAAAAAA',
		type: 'highlight',
		color: '#ffd400',
		comment: '',
		position: { pageIndex: 0, rects: [[0, 0, 1, 1]] },
		...props,
	};
}

function updatedInView(oldProps, newProps) {
	let { updated } = getAffectedAnnotations([annotation(oldProps)], [annotation(newProps)], true);
	return updated.length > 0;
}

test('view: editing a non-empty highlight comment does not affect the view', () => {
	assert.equal(updatedInView({ comment: 'a' }, { comment: 'ab' }), false);
});

test('view: adding or clearing a highlight comment affects the view (comment icon)', () => {
	assert.equal(updatedInView({ comment: '' }, { comment: 'a' }), true);
	assert.equal(updatedInView({ comment: 'a' }, { comment: '' }), true);
});

test('view: editing a text annotation comment affects the view', () => {
	assert.equal(updatedInView({ type: 'text', comment: 'a' }, { type: 'text', comment: 'ab' }), true);
});

test('view: color and position changes still affect the view', () => {
	assert.equal(updatedInView({}, { color: '#ff6666' }), true);
	assert.equal(updatedInView({}, { position: { pageIndex: 0, rects: [[0, 0, 2, 2]] } }), true);
});

test('non-view: any changed reference is updated', () => {
	let { updated } = getAffectedAnnotations([annotation({ comment: 'a' })], [annotation({ comment: 'ab' })]);
	assert.equal(updated.length, 1);
});
