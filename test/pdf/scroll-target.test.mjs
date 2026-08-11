import assert from 'node:assert/strict';
import test from 'node:test';

import { getScrollTarget } from '../../src/pdf/scroll-target.mjs';

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
