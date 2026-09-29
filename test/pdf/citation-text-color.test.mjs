/* global globalThis */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

globalThis.window ??= {};

// Unrelated UI and TypeScript dependencies are not used by these PDFView checks.
const stubs = {
	'common/view': 'export default {};',
	'common/sdt/position-mapper': 'export let getBlockNodeByRef = () => null;',
	'common/lib/history': 'export class History {}',
	'common/read-aloud/jump-button': 'export class ReadAloudJumpButton {}',
	'dom/common/lib/selector': 'export let isSelector = () => false;',
};

registerHooks({
	resolve(specifier, context, next) {
		let stub = Object.entries(stubs).find(([suffix]) => specifier.endsWith(suffix))?.[1];
		if (stub) {
			return next('data:text/javascript,' + encodeURIComponent(stub), context);
		}
		let error;
		for (let candidate of [specifier, specifier + '.js', specifier + '.mjs', specifier + '.ts']) {
			try {
				return next(candidate, context);
			}
			catch (e) {
				error ||= e;
			}
		}
		throw error;
	},
});
const [{ default: Page }, { default: PDFView }] = await Promise.all([
	import('../../src/pdf/page.js'),
	import('../../src/pdf/pdf-view.js'),
]);

function fixture() {
	let position = { pageIndex: 0, rects: [[20, 40, 60, 50]] };
	let data = { semanticFlowRevision: 1, overlays: [{ type: 'citation', position }] };
	let layer = {
		_pdfPages: [data],
		_hover: position,
		_getPageTextColorRegions: PDFView.prototype._getPageTextColorRegions,
	};
	let requested = [];
	let originalPage = {
		id: 1,
		coloredTextRegions: [],
		setTextColorRegions(regions) {
			requested.push(regions);
		},
	};
	let page = new Page(layer, originalPage);
	page._pushPositionRects = (items, position, style) => items.push({ position, style });
	return { page, layer, data, requested, originalPage };
}

test('prepared citation colors are available synchronously before painting', () => {
	let rect = [20, 40, 60, 50];
	let view = {
		_pdfPages: [{
			semanticFlowRevision: 1,
			overlays: [{ type: 'citation', position: { pageIndex: 0, rects: [rect] } }],
		}],
	};
	assert.deepEqual(PDFView.prototype._getPageTextColorRegions.call(view, { id: 1 }),
		[{ rect, color: '#245e91' }]);
});

test('pending citation data does not start preparation before painting', () => {
	let view = {
		_pdfPages: {},
		_documentData: {
			registerPage: () => assert.fail('Page registration belongs to the post-render path'),
			ensureSemanticPage: () => assert.fail('Painting must not start semantic preparation'),
		},
		_ensureBasicPageData: () => assert.fail('Painting must not start data extraction'),
	};
	assert.equal(PDFView.prototype._getPageTextColorRegions.call(view, { id: 1 }), null);
});

test('preview views and destroyed views do not supply citation colors', () => {
	for (let state of [
		{ _preview: true },
		{ _destroyed: true },
	]) {
		let view = {
			_getPageTextColorRegions: PDFView.prototype._getPageTextColorRegions,
			...state,
		};
		let requested = null;
		let originalPage = { id: 1, setTextColorRegions: regions => requested = regions };
		assert.deepEqual(view._getPageTextColorRegions(originalPage), []);
		new Page(view, originalPage)._updateTextColorRegions();
		assert.deepEqual(requested, [], 'Live pages use the same policy as new draws');
	}
});

test('fallback persists until the entire citation is colored; hover remains', () => {
	let { page, data, requested, originalPage } = fixture();
	page._updateTextColorRegions();
	assert.equal(requested[0].length, 1);
	let items = [];
	page._pushOverlays(items);
	assert.equal(items.length, 1, 'Requested does not mean displayed');
	originalPage.coloredTextRegions = requested[0];
	items = [];
	page._pushOverlays(items);
	assert.equal(items.length, 0);
	page._pushHover(items);
	assert.equal(items.length, 1);

	// The old canvas colors only the first line of the updated citation.
	data.overlays[0].position.rects = [[20, 40, 60, 50], [20, 80, 60, 90]];
	page._updateTextColorRegions();
	items = [];
	page._pushOverlays(items);
	assert.equal(items.length, 1);
});

test('pending semantic data is not treated as an empty set of citations', () => {
	let { page, layer, data, requested } = fixture();
	page._updateTextColorRegions();
	for (let pending of [undefined, { overlays: [] }]) {
		layer._pdfPages[0] = pending;
		page._updateTextColorRegions();
	}
	assert.equal(requested.length, 1);
	layer._pdfPages[0] = { ...data, overlays: [] };
	page._updateTextColorRegions();
	assert.deepEqual(requested[1], []);
});

test('only citations and matched internal links get coloring', () => {
	let { page, data, requested } = fixture();
	let position = { pageIndex: 0, rects: [[80, 40, 100, 50]] };
	data.overlays.push(
		{ type: 'external-link', position },
		{ type: 'internal-link', source: 'annotation', position },
		{ type: 'reference', position },
		{ type: 'internal-link', source: 'matched', position },
	);
	page._updateTextColorRegions();
	assert.equal(requested[0].length, 2);
	assert.equal(requested[0][1].rect, position.rects[0]);
});

test('cross-page citations use only this page’s PDF-space rectangles', () => {
	let { page, data, requested } = fixture();
	data.overlays[0].position = {
		pageIndex: -1, rects: [[20, 40, 60, 50]], nextPageRects: [[10, 140, 80, 150]],
	};
	page._updateTextColorRegions();
	assert.deepEqual(requested[0][0].rect, [10, 140, 80, 150]);
});
