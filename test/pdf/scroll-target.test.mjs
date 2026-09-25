import assert from 'node:assert/strict';
import test from 'node:test';

import { getPageScrollTarget, getScrollTarget } from '../../src/pdf/scroll-target.mjs';

test('keeps the existing centered navigation behavior by default', () => {
	assert.deepEqual(getScrollTarget({
		rect: [500, 2000, 900, 2050],
		scrollLeft: 380,
		scrollTop: 1000,
		clientWidth: 1280,
		clientHeight: 680,
	}), {
		left: -140,
		top: 1655,
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

test('fitted page navigation keeps PDF.js alignment on each axis', () => {
	for (let rect of [[320, 30, 360, 50], [620, 530, 650, 550]]) {
		for (let [horizontal, scrollLeft, left] of [[true, 310, 310], [false, 310, undefined], [false, 350, 310]]) {
			assert.deepEqual(getPageScrollTarget({
				rect, pageRect: [310, 18, 710, 618],
				scrollLeft, clientWidth: 400, clientHeight: 600, horizontal,
			}), { left, top: 18 });
		}
	}
});

test('overflowing axes center within the page and keep oversized targets at their start', () => {
	for (let [rect, pageRect, left, top] of [
		[[1020, 2030, 1080, 2050], [1000, 2000, 2200, 3800], 1000, 2000],
		[[1500, 2800, 1600, 2840], [1000, 2000, 2200, 3800], 1350, 2520],
		[[2120, 3750, 2180, 3770], [1000, 2000, 2200, 3800], 1800, 3200],
		[[1100, 2200, 1600, 3000], [1000, 2000, 2200, 3800], 1100, 2200],
		[[1100, 2800, 1200, 2840], [1000, 2000, 1400, 3800], 1000, 2520],
		[[1500, 2100, 1600, 2140], [1000, 2000, 2200, 2600], 1350, 2000],
	]) {
		assert.deepEqual(getPageScrollTarget({
			rect, pageRect, scrollLeft: 0, clientWidth: 400, clientHeight: 600, horizontal: true,
		}), { left, top });
	}
});
