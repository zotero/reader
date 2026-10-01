import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DOUBLE_TAP_DELAY,
	DOUBLE_TAP_SLOP,
	getColumnSpanRect,
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

// Two columns of two lines each, left at x 10-90, right at x 110-190
function twoColumns() {
	return [
		char('A', [10, 80, 90, 90], { lineBreakAfter: true }),
		char('B', [10, 65, 90, 75], { lineBreakAfter: true, paragraphBreakAfter: true }),
		char('C', [110, 80, 190, 90], { lineBreakAfter: true }),
		char('D', [110, 65, 190, 75], { lineBreakAfter: true, paragraphBreakAfter: true }),
	];
}

test('spans both columns when tapping the gutter between them', () => {
	assert.deepEqual(getColumnSpanRect(twoColumns(), [100, 70]), [10, 65, 190, 90]);
	// Between lines in the gutter
	assert.deepEqual(getColumnSpanRect(twoColumns(), [100, 77]), [10, 65, 190, 90]);
});

test('does not span columns when tapping on text', () => {
	assert.equal(getColumnSpanRect(twoColumns(), [50, 70]), null);
	assert.equal(getColumnSpanRect(twoColumns(), [150, 85]), null);
});

test('does not span when tapping outside the columns', () => {
	assert.equal(getColumnSpanRect(twoColumns(), [5, 70]), null);
	assert.equal(getColumnSpanRect(twoColumns(), [100, 200]), null);
});

test('does not treat a space between words as a gutter', () => {
	let chars = [
		char('A', [10, 80, 40, 90], { spaceAfter: true }),
		char('B', [50, 80, 90, 90], { lineBreakAfter: true, paragraphBreakAfter: true }),
	];
	assert.equal(getColumnSpanRect(chars, [45, 85]), null);
});

test('does not span blocks separated by more than a gutter', () => {
	let chars = [
		char('A', [10, 80, 30, 90], { lineBreakAfter: true, paragraphBreakAfter: true }),
		char('B', [170, 80, 190, 90], { lineBreakAfter: true, paragraphBreakAfter: true }),
	];
	assert.equal(getColumnSpanRect(chars, [100, 85]), null);
});

test('can fit a column pair without the minimum zoom step', () => {
	assert.equal(getDoubleTapTargetScale(1, 400, 432, 1), 1);
	assert.equal(getDoubleTapTargetScale(1, 400, 432), 1.25);
});
