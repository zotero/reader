import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTouchAnnotationTransform,
	shouldStartInlineTextAnnotationEditing,
	touchAnnotationTransformMoved,
} from '../../src/pdf/touch-annotation-transform.mjs';

const touchEvent = {
	pointerType: 'touch',
	pointerId: 7,
	target: {},
	clientX: 20,
	clientY: 30,
};

test('starts inline text editing only for Android touch input', () => {
	assert.equal(shouldStartInlineTextAnnotationEditing(touchEvent, 'android'), true);
	assert.equal(shouldStartInlineTextAnnotationEditing({ ...touchEvent, pointerType: 'mouse' }, 'android'), false);
	assert.equal(shouldStartInlineTextAnnotationEditing(touchEvent, 'zotero'), false);
});

test('starts transforms only on Android, for selected annotations and supported actions', () => {
	for (let type of ['moveAndDrag', 'resize', 'rotate']) {
		assert.deepEqual(createTouchAnnotationTransform(touchEvent, { type }, true, 'android'), {
			pointerID: 7,
			target: touchEvent.target,
			x: 20,
			y: 30,
		});
	}
	assert.equal(createTouchAnnotationTransform(touchEvent, { type: 'moveAndDrag' }, false, 'android'), null);
	assert.equal(createTouchAnnotationTransform({ ...touchEvent, pointerType: 'mouse' }, { type: 'moveAndDrag' }, true, 'android'), null);
	assert.equal(createTouchAnnotationTransform(touchEvent, { type: 'drag' }, true, 'android'), null);
	assert.equal(createTouchAnnotationTransform(touchEvent, { type: 'moveAndDrag' }, true, 'web'), null);
});

test('ignores touch jitter until drag slop is reached', () => {
	let transform = createTouchAnnotationTransform(touchEvent, { type: 'moveAndDrag' }, true, 'android');
	assert.equal(touchAnnotationTransformMoved(transform, { clientX: 23, clientY: 33 }), false);
	assert.equal(touchAnnotationTransformMoved(transform, { clientX: 23, clientY: 34 }), true);
});
