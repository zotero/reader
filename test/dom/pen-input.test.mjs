import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

// Load real classes without initializing their browser-only UI dependencies.
function loadClass(file, name, handlers) {
	const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
		filename: file,
		configFile: false,
		babelrc: false,
		presets: ['@babel/preset-typescript', '@babel/preset-react', ['@babel/preset-env', { targets: { node: 'current' } }]],
		plugins: [({ types }) => ({ visitor: {
			ImportDeclaration(path) {
				path.remove();
			},
			ClassProperty(path) {
				if (handlers.includes(path.node.key.name)) {
					// Expose the arrow handler to constructor-free fixtures.
					let { key, value } = path.node;
					path.replaceWith(types.classMethod('method', key, value.params, value.body));
				}
			},
		} })],
	});
	const context = { exports: {}, window: { matchMedia: () => ({ matches: false }) } };
	vm.runInNewContext(code, context, { filename: file });
	return context.exports[name];
}

const DOMView = loadClass('../../src/dom/common/dom-view.tsx', 'default', ['_handleAnnotationPointerUp']);
const PaginatedFlow = loadClass('../../src/dom/epub/flow.ts', 'PaginatedFlow', [
	'_handlePointerDown',
	'_handlePointerMove',
	'_handlePointerUp',
	'_handlePointerCancel',
	'_handlePointerOut',
	'_handleSelectionChange',
	'_resetSwipe',
]);

function createView() {
	let classes = new Set(['creating-touch-annotation']);
	let added = 0;
	let selected = 0;
	let view = Object.assign(Object.create(DOMView.prototype), {
		_handledPointerIDs: new Set(),
		_tool: { type: 'highlight' },
		_touchAnnotationStartPosition: {},
		_touchAnnotationPointerType: 'pen',
		_previewAnnotation: { text: 'selected text' },
		_selectionChangedWhilePointerDown: false,
		_pointerMovementWhileDown: 20,
		_gotPointerUp: false,
		_selectedAnnotationIDs: [],
		_getAnnotationsAtPoint: () => ['existing'],
		_iframeDocument: { body: { classList: { remove: name => classes.delete(name) } } },
		_options: { onSelectAnnotations: () => selected++ },
		_renderAnnotations() {},
		_tryUseTool() {
			if (!this._touchAnnotationStartPosition) return false;
			assert.notEqual(this._previewAnnotation, null);
			added++;
			return true;
		},
	});
	return { view, classes, added: () => added, selected: () => selected };
}

function release(pointerType) {
	return { type: 'pointerup', pointerId: 1, pointerType, button: 0, isPrimary: true, target: { closest: () => null } };
}

test('paginated swipes ignore other pointers and finish on the owning release', () => {
	for (let ending of ['_handlePointerUp', '_handlePointerCancel', '_handlePointerOut']) {
		let amount = '0';
		let turns = 0;
		let selection = { isCollapsed: true };
		let flow = Object.assign(Object.create(PaginatedFlow.prototype), {
			_touchPointerID: null,
			_iframeDocument: { getSelection: () => selection },
			_iframeWindow: { getSelection: () => selection },
			_swipeIndicators: { style: { setProperty: (name, value) => amount = value } },
			_view: { selectedAnnotationIDs: [] },
			canNavigateRight: () => true,
			navigateRight: () => turns++,
			_onManualNavigation() {},
		});
		let target = { closest: () => null };
		let owner = { pointerId: 0, pointerType: 'touch', isPrimary: true, buttons: 1,
			clientX: 400, clientY: 100, target, composedPath: () => [target], preventDefault() {} };
		flow._handlePointerDown(owner);
		let pen = { ...owner, pointerId: 2, pointerType: 'pen', clientX: 150 };
		for (let handler of ['_handlePointerMove', '_handlePointerUp', '_handlePointerCancel', '_handlePointerOut']) {
			flow[handler](pen);
		}
		assert.equal(amount, '0');
		assert.equal(turns, 0);
		flow._handlePointerMove({ ...owner, clientX: 250 });
		assert.equal(amount, '-1.5');
		flow[ending]({ ...owner, clientX: ending === '_handlePointerUp' ? 250 : 0 });
		assert.equal(turns, 1);
		assert.equal(amount, '0');
		flow._handlePointerUp(owner);
		assert.equal(turns, 1);
		flow._handlePointerDown(owner);
		selection.isCollapsed = false;
		flow._handleSelectionChange();
		selection.isCollapsed = true;
		flow._handlePointerUp({ ...owner, clientX: 250 });
		assert.equal(turns, 1);
		flow._handlePointerDown(owner);
		flow._handlePointerMove({ ...owner, clientX: 250 });
		// Capture-phase reset also runs when annotation handling consumes the new contact.
		flow._resetSwipe();
		assert.equal(amount, '0');
		flow._handlePointerUp({ ...owner, clientX: 250 });
		assert.equal(turns, 1);
	}
});

test('a palm does not start a swipe or finish the active pen highlight', () => {
	let { view, classes, added } = createView();
	let stopped = 0;
	view._handlePointerDown({ pointerType: 'touch', pointerId: 2, stopPropagation: () => stopped++ });
	assert.equal(stopped, 1);
	view._handlePointerUp(release('touch'));
	assert.equal(view._touchAnnotationPointerType, 'pen');
	assert.equal(classes.has('creating-touch-annotation'), true);
	view._handlePointerUp(release('pen'));
	assert.equal(added(), 1);
	assert.equal(view._touchAnnotationPointerType, null);
	assert.equal(classes.has('creating-touch-annotation'), false);
});

test('a pen release over an annotation completes or cancels the active selection', () => {
	for (let type of ['pointerup', 'pointercancel']) {
		let { view, classes, added, selected } = createView();
		let stopped = 0;
		let eventFor = (pointerType) => {
			let nativeEvent = { ...release(pointerType), type };
			return { ...nativeEvent, nativeEvent, stopPropagation: () => stopped++ };
		};
		view._handleAnnotationPointerUp('existing', eventFor('touch'));
		assert.equal(selected(), 0);
		assert.equal(view._touchAnnotationPointerType, 'pen');
		view._handleAnnotationPointerUp('existing', eventFor('mouse'));
		assert.equal(added(), 0);
		assert.equal(view._touchAnnotationPointerType, 'pen');
		assert.equal(selected(), type === 'pointerup' ? 1 : 0);
		view._handleAnnotationPointerUp('existing', eventFor('pen'));
		assert.equal(stopped, 3);
		assert.equal(added(), type === 'pointerup' ? 1 : 0);
		assert.equal(view._touchAnnotationPointerType, null);
		assert.equal(classes.has('creating-touch-annotation'), false);
	}
});
