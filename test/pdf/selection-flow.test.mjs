import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	isolateCharsToAnchorFlow,
} from '../../src/pdf/selection-flow.mjs';

const PROJECT_ROOT = new URL('../../', import.meta.url).href;
const moduleHooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		let resolved;
		try {
			resolved = nextResolve(specifier, context);
		}
		catch (error) {
			if ((specifier.startsWith('.') || specifier.startsWith('/'))
					&& !/\.[a-z]+$/i.test(specifier)) {
				for (let extension of ['.js', '.mjs']) {
					let candidate = new URL(specifier + extension, context.parentURL);
					if (existsSync(fileURLToPath(candidate))) {
						resolved = nextResolve(candidate.href, context);
						break;
					}
				}
			}
			if (!resolved) {
				throw error;
			}
		}
		if (resolved.url.startsWith(PROJECT_ROOT) && /\.m?js$/.test(resolved.url)) {
			return { ...resolved, format: 'module' };
		}
		return resolved;
	},
});
const { getSelectionRangesByPosition } = await import('../../src/pdf/selection.js');
const { PDFNativeTextSelection } = await import('../../src/pdf/native-text-selection.js');
moduleHooks.deregister();

function char(c, pageIndex, offset, flowClass) {
	return {
		c,
		pageIndex,
		offset,
		...(flowClass && { flowClass }),
	};
}

test('keeps only the anchor flow in both selection directions', () => {
	let chars = [
		char('a', 0, 0),
		char('f', 0, 1, 'auxiliary'),
		char('b', 0, 2),
	];
	for (let anchorAtStart of [true, false]) {
		let result = isolateCharsToAnchorFlow(chars, anchorAtStart);
		assert.deepEqual(result.map(({ c }) => c), ['a', 'b']);
	}
	let crossFlowChars = [
		char('h', 0, 0, 'excluded'),
		char('a', 0, 1),
		char('b', 0, 2),
	];
	assert.equal(isolateCharsToAnchorFlow(crossFlowChars, true), null);
});

test('does not alter selections before SDT flow metadata exists', () => {
	assert.equal(isolateCharsToAnchorFlow([
		char('a', 0, 0),
		char('b', 0, 1),
	], true), null);
});

test('reconstructs discontinuous selections without guessing spacing', () => {
	for (let { first, last, spaceAfter, expected, validateNative } of [
		{ first: 'a', last: 'b', spaceAfter: true, expected: 'a b' },
		{ first: 'd', last: ',', expected: 'd,' },
		{ first: 'a', last: 'b', expected: 'ab', validateNative: true },
	]) {
		let chars = [
			{
				...char(first, 0, 0),
				...(spaceAfter && { spaceAfter: true }),
				rect: [0, 0, 1, 1],
				inlineRect: [0, 0, 1, 1],
			},
			{ ...char('x', 0, 1, 'auxiliary'), rect: [2, 0, 3, 1], inlineRect: [2, 0, 3, 1] },
			{ ...char(last, 0, 2), rect: [4, 0, 5, 1], inlineRect: [4, 0, 5, 1] },
		];
		let page = { chars, viewBox: [0, 0, 10, 10], semanticFlowRevision: 1 };
		let position = { pageIndex: 0, rects: [chars[0].rect, chars[2].rect] };
		if (validateNative) {
			let nativeRanges = getSelectionRangesByPosition(
				[page],
				position,
				{ applyFlow: false },
			);
			assert.equal(nativeRanges[0].text, 'axb');
		}
		let ranges = getSelectionRangesByPosition([page], position);
		assert.equal(ranges.length, 1);
		assert.equal(ranges[0].text, expected);
		assert.deepEqual(ranges[0].position.rects, [chars[0].rect, chars[2].rect]);
	}
});

test('waits for one semantic generation before filtering a cross-page selection', () => {
	let firstPageChars = [
		{ ...char('a', 0, 0), rect: [0, 0, 1, 1], inlineRect: [0, 0, 1, 1] },
		{ ...char('f', 0, 1, 'auxiliary'), rect: [2, 0, 3, 1], inlineRect: [2, 0, 3, 1] },
	];
	let secondPageChars = [
		{ ...char('b', 1, 0), rect: [0, 0, 1, 1], inlineRect: [0, 0, 1, 1] },
	];
	let pages = [
		{
			chars: firstPageChars,
			viewBox: [0, 0, 10, 10],
			semanticFlowRevision: 1,
		},
		{
			chars: secondPageChars,
			viewBox: [0, 0, 10, 10],
			semanticFlowRevision: null,
		},
	];
	let position = {
		pageIndex: 0,
		rects: firstPageChars.map(({ rect }) => rect),
		nextPageRects: secondPageChars.map(({ rect }) => rect),
	};
	let ranges = getSelectionRangesByPosition(pages, position);
	assert.deepEqual(ranges.map(range => range.text), ['af', 'b']);

	pages[1].semanticFlowRevision = 1;
	ranges = getSelectionRangesByPosition(pages, position);
	assert.deepEqual(ranges.map(range => range.text), ['a', 'b']);
});

test('derives native selection endpoints before applying document flow', () => {
	let pages = [
		{
			chars: [
				{ ...char('a', 0, 0), rect: [0, 0, 1, 1], inlineRect: [0, 0, 1, 1] },
				{ ...char('x', 0, 1, 'auxiliary'), rect: [2, 0, 3, 1], inlineRect: [2, 0, 3, 1] },
			],
			viewBox: [0, 0, 10, 10],
			semanticFlowRevision: 1,
		},
		{
			chars: [
				{ ...char('y', 1, 0, 'auxiliary'), rect: [0, 0, 1, 1], inlineRect: [0, 0, 1, 1] },
				{ ...char('b', 1, 1), rect: [2, 0, 3, 1], inlineRect: [2, 0, 3, 1] },
			],
			viewBox: [0, 0, 10, 10],
			semanticFlowRevision: 1,
		},
	];
	let positions = new Map(pages.map((page, pageIndex) => [
		pageIndex,
		{ pageIndex, rects: page.chars.map(({ rect }) => rect) },
	]));
	let selection = {
		_view: { _pdfPages: pages },
		_getRangePositionsByPage: () => positions,
	};
	let ranges = PDFNativeTextSelection.prototype._getSelectionRangesByRects.call(
		selection,
		{ range: {}, anchorIsStart: true }
	);
	assert.deepEqual(ranges.map(range => range.text), ['a', 'b']);
});
