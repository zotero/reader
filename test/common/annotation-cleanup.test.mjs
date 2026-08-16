import assert from 'node:assert/strict';
import test from 'node:test';

import { getEmptyTextAnnotationIDs } from '../../src/common/annotation-cleanup.mjs';

const annotations = [
	{ id: 'empty', type: 'text', comment: '' },
	{ id: 'filled', type: 'text', comment: 'comment' },
	{ id: 'highlight', type: 'highlight', comment: '' },
	{ id: 'excluded', type: 'text', comment: '' },
	{ id: 'read-only', type: 'text', comment: '', readOnly: true },
	{ id: 'external', type: 'text', comment: '', isExternal: true },
];

test('collects only empty text annotations', () => {
	assert.deepEqual(getEmptyTextAnnotationIDs(annotations), ['empty', 'excluded']);
});

test('skips excluded annotations', () => {
	assert.deepEqual(getEmptyTextAnnotationIDs(annotations, ['excluded']), ['empty']);
});

test('skips read-only and external annotations', () => {
	assert.deepEqual(
		getEmptyTextAnnotationIDs(annotations, ['empty', 'excluded']),
		[]
	);
});
