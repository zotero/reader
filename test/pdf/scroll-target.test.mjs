import assert from 'node:assert/strict';
import test from 'node:test';

import { getFitScale, getScrollTarget } from '../../src/pdf/scroll-target.mjs';

test('keeps the existing centered navigation behavior by default', () => {
	assert.deepEqual(getScrollTarget({
		rect: [500, 2000, 900, 2050],
		scrollLeft: 380,
		scrollTop: 1000,
		clientWidth: 1280,
		clientHeight: 680,
	}), {
		left: 60,
		top: 1680,
	});
});

test('centers on the target rect\'s midpoint, not its top-left corner', () => {
	assert.deepEqual(getScrollTarget({
		rect: [1000, 2000, 1400, 2800],
		scrollLeft: 0,
		scrollTop: 0,
		clientWidth: 1280,
		clientHeight: 680,
	}), {
		left: 1000 + (1400 - 1000) / 2 - 1280 / 2,
		top: 2000 + (2800 - 2000) / 2 - 680 / 2 - 5,
	});
});

test('horizontal clipping does not cause vertical recentering', () => {
	assert.deepEqual(getScrollTarget({
		rect: [300, 1200, 500, 1250],
		scrollLeft: 380,
		scrollTop: 1000,
		clientWidth: 1280,
		clientHeight: 680,
		block: 'center',
		inline: 'nearest',
		ifNeeded: true,
		visibilityMargin: -170,
	}), {
		left: 290,
		top: undefined,
	});
});

test('getFitScale zooms out just enough to fit an annotation taller than the viewport', () => {
	assert.equal(getFitScale({
		rectWidth: 600,
		rectHeight: 2000,
		currentScale: 2,
		clientWidth: 1280,
		clientHeight: 680,
	}), 2 * (680 / 2000));
});

test('getFitScale zooms out just enough to fit an annotation wider than the viewport', () => {
	assert.equal(getFitScale({
		rectWidth: 3000,
		rectHeight: 400,
		currentScale: 2,
		clientWidth: 1280,
		clientHeight: 680,
	}), 2 * (1280 / 3000));
});

test('getFitScale picks the more restrictive axis when both overflow', () => {
	let scale = getFitScale({
		rectWidth: 2560,
		rectHeight: 2040,
		currentScale: 2,
		clientWidth: 1280,
		clientHeight: 680,
	});
	assert.equal(scale, 2 * (680 / 2040));
});

test('getFitScale leaves the scale alone when the annotation already fits', () => {
	assert.equal(getFitScale({
		rectWidth: 600,
		rectHeight: 400,
		currentScale: 2,
		clientWidth: 1280,
		clientHeight: 680,
	}), null);
});
