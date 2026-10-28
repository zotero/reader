import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
			specifier += '.js';
		}
		return nextResolve(specifier, context);
	},
});
const { default: Page } = await import('../../src/pdf/page.js');
hooks.deregister();

function fixture() {
	let annotation = {
		type: 'ink', id: 'ink', color: '#000000',
		position: { pageIndex: 0, width: 1, paths: [[0, 0, 1, 1]] }
	};
	let layer = {
		_getPageAnnotations: () => [annotation],
		_selectedAnnotationIDs: [],
	};
	let viewport = { transform: [2, 0, 0, -2, 5, 100] };
	let page = new Page(layer, { id: 1, viewport });
	// Isolate ink from unrelated overlay sources; retain the real action builder.
	for (let method of [
		'_pushCommentIcons',
		'_pushOverlays',
		'_pushHover',
		'_pushFindResults',
		'_pushFocusOutline',
		'_pushSelectedOutlines',
		'_pushRangeGrippers',
		'_pushSelection'
	]) {
		page[method] = () => {};
	}
	let transforms = 0;
	let p2v = page._p2v;
	page._p2v = function _p2v(position) {
		transforms++;
		return p2v.call(this, position);
	};
	return { page, layer, annotation, viewport, transforms: () => transforms };
}

test('unchanged completed ink avoids transforming all its points again', () => {
	let { page, transforms } = fixture();
	let first = page._buildDisplayList();
	assert.equal(first[0].d, 'M5 100L5 100L7 98');
	assert.equal(first[0].strokeWidth, 2);
	assert.deepEqual(page._buildDisplayList(), first);
	assert.equal(transforms(), 1);
});

test('replacing a completed ink position updates the displayed path', () => {
	let { page, annotation, transforms } = fixture();
	let first = page._buildDisplayList();
	annotation.position = { ...annotation.position, paths: [[0, 0, 3, 4]] };
	assert.notEqual(page._buildDisplayList()[0].d, first[0].d);
	assert.equal(transforms(), 2);
});

test('zoom, rotation and translation invalidate completed ink geometry', () => {
	for (let transform of [[3, 0, 0, -3, 5, 100], [0, 2, 2, 0, 5, 100], [2, 0, 0, -2, 25, 120]]) {
		let { page, viewport, transforms } = fixture();
		let first = page._buildDisplayList();
		viewport.transform.splice(0, 6, ...transform);
		assert.notEqual(page._buildDisplayList()[0].d, first[0].d);
		assert.equal(transforms(), 2);
	}
});

test('ink color and thickness still update without rebuilding its path', () => {
	let { page, annotation, transforms } = fixture();
	let first = page._buildDisplayList()[0];
	annotation.color = '#ff0000';
	annotation.position.width = 2;
	let updated = page._buildDisplayList()[0];
	assert.equal(updated.d, first.d);
	assert.notEqual(updated.stroke, first.stroke);
	assert.equal(updated.strokeWidth, 4);
	assert.equal(transforms(), 1);
});

test('points appended to an active ink stroke remain visible', () => {
	let { page, layer } = fixture();
	layer.action = { type: 'ink', annotation: {
		type: 'ink', color: '#ff0000',
		position: { pageIndex: 0, width: 1, paths: [[2, 2]] }
	} };
	let first = page._buildDisplayList();
	layer.action.annotation.position.paths[0].push(3, 4);
	let updated = page._buildDisplayList();
	assert.deepEqual(updated[0], first[0]);
	assert.notEqual(updated[1].d, first[1].d);
});
