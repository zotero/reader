import assert from 'node:assert/strict';
import test from 'node:test';
import {
	combineBounds,
	getContentFitOffset,
	getContentFitScale,
	getInkBounds,
	getSamplePageIndexes,
} from '../../src/pdf/content-fit.mjs';

const WIDTH = 400;
const HEIGHT = 520;

// Render a white page with black rectangles given in page fractions
function page(rects, width = WIDTH, height = HEIGHT) {
	let data = new Uint8ClampedArray(width * height * 4).fill(255);
	for (let [x0, y0, x1, y1] of rects) {
		for (let y = Math.round(y0 * height); y < Math.round(y1 * height); y++) {
			for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x++) {
				let index = (y * width + x) * 4;
				data[index] = data[index + 1] = data[index + 2] = 0;
			}
		}
	}
	return { data, width, height };
}

// Lines of body text with small line gaps, as a single-column paper would have
function textBlock(x0, y0, x1, y1, lineHeight = 0.012, lineGap = 0.006) {
	let rects = [];
	for (let y = y0; y + lineHeight <= y1 + 1e-9; y += lineHeight + lineGap) {
		rects.push([x0, y, x1, y + lineHeight]);
	}
	// End the block exactly at y1
	rects.push([x0, y1 - lineHeight, x1, y1]);
	return rects;
}

function assertBounds(actual, expected, tolerance = 0.01) {
	assert.ok(actual, 'expected bounds');
	for (let i = 0; i < 4; i++) {
		assert.ok(
			Math.abs(actual[i] - expected[i]) <= tolerance,
			`edge ${i}: expected ${expected[i]}, got ${actual[i]} (${JSON.stringify(actual)})`
		);
	}
}

test('returns null for a blank page', () => {
	assert.equal(getInkBounds(page([])), null);
});

test('finds the body of a single-column page', () => {
	let bounds = getInkBounds(page(textBlock(0.15, 0.1, 0.85, 0.9)));
	assertBounds(bounds, [0.15, 0.1, 0.85, 0.9]);
});

test('ignores the rotated arXiv identifier in the left margin', () => {
	let bounds = getInkBounds(page([
		// arXiv stamp: tall and narrow, well away from the body
		[0.04, 0.25, 0.07, 0.75],
		...textBlock(0.15, 0.1, 0.85, 0.9),
	]));
	assertBounds(bounds, [0.15, 0.1, 0.85, 0.9]);
});

test('ignores a centered page number and a running header', () => {
	let bounds = getInkBounds(page([
		[0.3, 0.04, 0.7, 0.055],
		...textBlock(0.15, 0.1, 0.85, 0.9),
		[0.48, 0.94, 0.52, 0.955],
	]));
	assertBounds(bounds, [0.15, 0.1, 0.85, 0.9]);
});

test('keeps a wide footnote at the bottom of the page', () => {
	let bounds = getInkBounds(page([
		...textBlock(0.15, 0.1, 0.85, 0.85),
		[0.15, 0.9, 0.85, 0.912],
	]));
	assertBounds(bounds, [0.15, 0.1, 0.85, 0.912]);
});

test('keeps both columns of a two-column page', () => {
	let bounds = getInkBounds(page([
		...textBlock(0.08, 0.08, 0.48, 0.92),
		...textBlock(0.52, 0.08, 0.92, 0.92),
	]));
	assertBounds(bounds, [0.08, 0.08, 0.92, 0.92]);
});

test('keeps figures that are wider than the text', () => {
	let bounds = getInkBounds(page([
		...textBlock(0.15, 0.1, 0.85, 0.4),
		[0.1, 0.42, 0.9, 0.6],
		...textBlock(0.15, 0.62, 0.85, 0.9),
	]));
	assertBounds(bounds, [0.1, 0.1, 0.9, 0.9]);
});

test('ignores light anti-aliasing noise', () => {
	let image = page(textBlock(0.15, 0.1, 0.85, 0.9));
	// A single stray gray pixel in the margin
	let index = (10 * WIDTH + 10) * 4;
	image.data[index] = image.data[index + 1] = image.data[index + 2] = 100;
	assertBounds(getInkBounds(image), [0.15, 0.1, 0.85, 0.9]);
});

test('combines page bounds and ignores one outlier per edge', () => {
	let body = [0.15, 0.1, 0.85, 0.9];
	assert.deepEqual(combineBounds([body, null, [0.2, 0.3, 0.8, 0.5]]), body);
	assert.deepEqual(
		combineBounds([body, body, body, body, [0, 0, 1, 1]]),
		body
	);
	assert.equal(combineBounds([null, null]), null);
});

test('samples pages evenly across the document', () => {
	assert.deepEqual(getSamplePageIndexes(3, 8), [0, 1, 2]);
	assert.deepEqual(getSamplePageIndexes(15, 8), [0, 2, 4, 6, 8, 10, 12, 14]);
	assert.deepEqual(getSamplePageIndexes(0, 8), []);
});

test('fits content width, or both dimensions when requested', () => {
	let options = {
		scale: 1,
		pageWidth: 800,
		pageHeight: 1000,
		bounds: [0.1, 0.1, 0.9, 0.9],
		viewportWidth: 800,
		viewportHeight: 800,
	};
	assert.equal(getContentFitScale({ ...options, fitHeight: false }), 1.25);
	assert.equal(getContentFitScale({ ...options, fitHeight: true }), 1);
	// 5% of the smaller side on each edge
	assert.equal(getContentFitScale({ ...options, margin: 0.05, fitHeight: false }), 720 / 640);
	assert.equal(getContentFitScale({ ...options, bounds: [0.5, 0.5, 0.5, 0.5] }), null);
});

test('centers content within the page and constrains the offset', () => {
	assert.equal(getContentFitOffset(0.1, 0.9, 1000, 800), 100);
	assert.equal(getContentFitOffset(0, 0.5, 1000, 800), 0);
	assert.equal(getContentFitOffset(0.6, 1, 1000, 800), 200);
});
