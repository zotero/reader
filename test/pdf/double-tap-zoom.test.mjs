import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DOUBLE_TAP_DELAY,
	DOUBLE_TAP_SLOP,
	getDoubleTapTargetScale,
	getTextBlockRect,
	isDoubleTap,
} from '../../src/pdf/double-tap-zoom.mjs';

function char(c, rect, extra = {}) {
	return {
		c,
		rect,
		inlineRect: rect,
		fontSize: 10,
		...extra,
	};
}

test('recognizes only nearby taps within the Android double-tap interval', () => {
	let first = { x: 10, y: 20, time: 1000 };
	assert.equal(isDoubleTap(first, { x: 20, y: 25, time: 1000 + DOUBLE_TAP_DELAY }), true);
	assert.equal(isDoubleTap(first, { x: 20, y: 25, time: 1001 + DOUBLE_TAP_DELAY }), false);
	assert.equal(isDoubleTap(first, { x: 10 + DOUBLE_TAP_SLOP + 1, y: 20, time: 1100 }), false);
});

test('returns the tapped paragraph rather than adjacent text', () => {
	let chars = [
		char('A', [10, 80, 20, 90]),
		char('B', [20, 80, 30, 90], { lineBreakAfter: true }),
		char('C', [10, 65, 20, 75]),
		char('D', [20, 65, 30, 75], { lineBreakAfter: true, paragraphBreakAfter: true }),
		char('E', [100, 30, 110, 40]),
		char('F', [110, 30, 120, 40], { lineBreakAfter: true, paragraphBreakAfter: true }),
	];
	assert.deepEqual(getTextBlockRect(chars, [15, 70]), [10, 65, 30, 90]);
	assert.deepEqual(getTextBlockRect(chars, [115, 35]), [100, 30, 120, 40]);
});

test('keeps a paragraph column local when text flows into another column', () => {
	let chars = [
		char('A', [10, 80, 30, 90], { lineBreakAfter: true }),
		char('B', [10, 65, 30, 75], { lineBreakAfter: true }),
		char('C', [100, 80, 120, 90], { lineBreakAfter: true }),
		char('D', [100, 65, 120, 75], { lineBreakAfter: true, paragraphBreakAfter: true }),
	];
	assert.deepEqual(getTextBlockRect(chars, [20, 70]), [10, 65, 30, 90]);
	assert.deepEqual(getTextBlockRect(chars, [110, 70]), [100, 65, 120, 90]);
});

test('does not snap distant blank-page taps to text', () => {
	let chars = [char('A', [10, 10, 20, 20], { lineBreakAfter: true, paragraphBreakAfter: true })];
	assert.equal(getTextBlockRect(chars, [200, 200]), null);
});

test('fits blocks with margins and bounds extreme zoom levels', () => {
	assert.equal(getDoubleTapTargetScale(1, 200, 432), 2);
	assert.equal(getDoubleTapTargetScale(1, 1000, 432), 1.25);
	assert.equal(getDoubleTapTargetScale(2, 10, 432), 4);
	assert.equal(getDoubleTapTargetScale(1, 0, 432), 2);
});
