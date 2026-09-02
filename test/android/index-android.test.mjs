/* global globalThis */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

let fakeViewSource = `
export default class FakeView {
	constructor(options) {
		this.options = options;
		this.calls = [];
		this.selectedIDs = [];
		this.focusedTextAnnotationID = null;
		globalThis.__androidView = this;
	}
	_record(name, ...args) {
		this.calls.push([name, ...args]);
		globalThis.__androidTimeline.push([name, ...args]);
	}
	selectAnnotations(ids) {
		this.selectedIDs = ids.slice();
		this._record('selectAnnotations', ids);
	}
	getSelectedAnnotationIDs() { return this.selectedIDs.slice(); }
	getFocusedTextAnnotationID() { return this.focusedTextAnnotationID; }
	finishTextAnnotationEditing() {
		this._record('finishTextAnnotationEditing');
		return true;
	}
	setTool(tool) { this._record('setTool', tool); }
	unsetAnnotations(ids) { this._record('unsetAnnotations', ids); }
	setAnnotations(annotations) { this._record('setAnnotations', annotations); }
	find(params) { this._record('find', params); }
	navigate(location) { this._record('navigate', location); }
	setPageLabels(labels) { this._record('setPageLabels', labels); }
	renderThumbnails(pageIndexes, options) { this._record('renderThumbnails', pageIndexes, options); }
	renderAnnotationImages(ids) { this._record('renderAnnotationImages', ids); }
	enterPassword(password) { this._record('enterPassword', password); }
}
`;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('common/view')) {
			let url = 'data:text/javascript,' + encodeURIComponent(fakeViewSource);
			return nextResolve(url, context);
		}
		return nextResolve(specifier, context);
	},
});

let styleProperties = new Map();
globalThis.window = {};
globalThis.document = {
	documentElement: {
		style: {
			setProperty: (name, value) => styleProperties.set(name, value),
		},
	},
	getElementById: () => ({ id: 'view' }),
};
globalThis.onmessage = null;
globalThis.__androidTimeline = [];
let animationFrames = [];
globalThis.requestAnimationFrame = callback => animationFrames.push(callback);

await import('../../src/index.android.js');

let portMessages = [];
let port = {
	postMessage(message) {
		let parsed = JSON.parse(message);
		portMessages.push(parsed);
		globalThis.__androidTimeline.push(['postMessage', parsed]);
	},
};
globalThis.onmessage({ data: 'initPort', ports: [port] });
let portInitializationEvents = textEvents();

function encode(value) {
	return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
}

function textEvents() {
	return portMessages
		.filter(({ handlerName }) => handlerName === 'textHandler')
		.map(({ message }) => message);
}

function createView(overrides = {}) {
	portMessages = [];
	animationFrames = [];
	globalThis.__androidTimeline = [];
	window.createView(encode({
		type: 'pdf',
		url: 'https://example.com/document.pdf',
		annotations: [],
		...overrides,
	}));
	return globalThis.__androidView;
}

test('Android host-port initialization is acknowledged before view creation', () => {
	assert.deepEqual(portInitializationEvents, [{ event: 'onInitialized', params: {} }]);
});

test('Android view creation exposes every PDF UI callback through the host port', () => {
	let view = createView({ colorScheme: 'dark', viewState: { pageIndex: 2 } });
	assert.equal(view.options.platform, 'android');
	assert.deepEqual(view.options.data, { url: 'https://example.com/document.pdf' });
	assert.equal(view.options.url, undefined);
	assert.equal(view.options.colorScheme, 'dark');
	assert.deepEqual(view.options.viewState, { pageIndex: 2 });

	let cases = [
		['onInitialized', [], { event: 'onViewContentInitialized', params: {} }],
		['onSetOutline', [[{ title: 'A' }]], { event: 'onSetOutline', params: { outline: [{ title: 'A' }] } }],
		['onRequestPassword', [], { event: 'onRequestPassword', params: {} }],
		['onInitThumbnails', [[{ pageIndex: 0 }]], { event: 'onInitThumbnails', params: { thumbnails: [{ pageIndex: 0 }] } }],
		['onRenderThumbnail', [{ pageIndex: 0, image: 'thumbnail' }], { event: 'onRenderThumbnail', params: { thumbnail: { pageIndex: 0, image: 'thumbnail' } } }],
		['onRenderAnnotationImage', [{ id: 'A', image: 'image' }], { event: 'onRenderAnnotationImage', params: { id: 'A', image: 'image' } }],
		['onSetPageLabels', [['i', '1']], { event: 'onSetPageLabels', params: { pageLabels: ['i', '1'] } }],
		['onSetSelectionPopup', [{ rect: [1, 2, 3, 4] }], { event: 'onSetSelectionPopup', params: { rect: [1, 2, 3, 4] } }],
		['onSetSelectionPopup', [null], { event: 'onSetSelectionPopup', params: null }],
		['onSetAnnotationPopup', [{ ids: ['A'] }], { event: 'onSetAnnotationPopup', params: { ids: ['A'] } }],
		['onOpenLink', ['https://example.com'], { event: 'onOpenLink', params: { url: 'https://example.com' } }],
		['onFindResult', [{ index: 1, total: 2 }], { event: 'onFindResult', params: { index: 1, total: 2 } }],
		['onChangeViewState', [{ pageIndex: 2 }], { event: 'onChangeViewState', params: { state: { pageIndex: 2 } } }],
		['onChangeViewStats', [{ canCopy: true }], { event: 'onChangeViewStats', params: { stats: { canCopy: true } } }],
		['onBackdropTap', [], { event: 'onBackdropTap', params: {} }],
	];

	for (let [callback, args, expected] of cases) {
		portMessages = [];
		view.options[callback](...args);
		assert.deepEqual(textEvents(), [expected], callback);
	}

	portMessages = [];
	view.options.onDeleteAnnotations([]);
	assert.deepEqual(textEvents(), []);
	view.options.onDeleteAnnotations(['A']);
	assert.deepEqual(textEvents(), [{ event: 'onDeleteAnnotations', params: { ids: ['A'] } }]);
});

test('Android annotation selection preserves host ordering and inline-editing focus', () => {
	let view = createView();
	view.options.onSelectAnnotations(['A'], null);
	assert.deepEqual(globalThis.__androidTimeline.slice(-2).map(x => x[0]), [
		'postMessage',
		'selectAnnotations',
	]);
	assert.deepEqual(textEvents().at(-1), {
		event: 'onSelectAnnotations',
		params: { ids: ['A'] },
	});

	portMessages = [];
	globalThis.__androidTimeline = [];
	view.options.onSelectAnnotations(['B'], null, { inlineTextEditing: true });
	assert.deepEqual(view.selectedIDs, ['B']);
	assert.deepEqual(textEvents(), []);
	assert.equal(animationFrames.length, 1);
	animationFrames.shift()();
	assert.deepEqual(globalThis.__androidTimeline.map(x => x[0]), [
		'selectAnnotations',
		'postMessage',
	]);
	assert.deepEqual(textEvents(), [{
		event: 'onSelectAnnotations',
		params: { ids: ['B'], inlineTextEditing: true },
	}]);
});

test('Android save delivery selects only a newly created note outside inline text editing', () => {
	let view = createView();
	let newNote = {
		id: 'new-note',
		type: 'note',
		dateCreated: '2026-08-26T10:00:00Z',
		dateModified: '2026-08-26T10:00:00Z',
	};
	globalThis.__androidTimeline = [];
	view.options.onSaveAnnotations([{ id: 'updated', type: 'highlight' }, newNote]);
	assert.equal(textEvents()[0].event, 'onSaveAnnotations');
	assert.deepEqual(view.selectedIDs, ['new-note']);
	assert.deepEqual(globalThis.__androidTimeline.slice(-2).map(x => x[0]), [
		'postMessage',
		'selectAnnotations',
	]);

	view.selectedIDs = [];
	view.options.onSaveAnnotations([{ ...newNote, dateModified: '2026-08-26T10:01:00Z' }]);
	assert.deepEqual(view.selectedIDs, []);

	view.focusedTextAnnotationID = 'text';
	view.options.onSaveAnnotations([{ ...newNote, id: 'another-note' }]);
	assert.deepEqual(view.selectedIDs, []);
});

test('Android PDF UI commands decode their inputs and delegate to the view', () => {
	let view = createView();
	window.setContainerInsets({ top: 4, right: 3, bottom: 2, left: 1 });
	assert.deepEqual(Object.fromEntries(styleProperties), {
		'--safe-area-inset-top': '4px',
		'--safe-area-inset-right': '3px',
		'--safe-area-inset-bottom': '2px',
		'--safe-area-inset-left': '1px',
	});

	window.setTool({ type: 'highlight', color: '#ffd400' });
	window.clearTool();
	assert.equal(window.finishTextAnnotationEditing(), true);
	window.updateAnnotations({
		deletions: encode(['deleted']),
		insertions: encode([{ id: 'inserted' }]),
		modifications: encode([{ id: 'modified' }]),
	});
	window.search({ term: encode('žodis 🔎') });
	window.select({ key: 'selected' });
	window.navigate({ location: encode({ pageIndex: 3 }) });
	window.setPageLabels({ pageLabels: encode(['i', '1']) });
	window.renderThumbnails([0, 2]);
	window.renderThumbnails([1], { maxWidth: 80, maxHeight: 64 });
	window.renderAnnotationImages(['image', 'ink']);
	window.enterPassword({ password: encode('slaptažodis') });

	assert.deepEqual(view.calls, [
		['setTool', { type: 'highlight', color: '#ffd400' }],
		['setTool', undefined],
		['finishTextAnnotationEditing'],
		['unsetAnnotations', ['deleted']],
		['setAnnotations', [{ id: 'inserted' }, { id: 'modified' }]],
		['find', { query: 'žodis 🔎', highlightAll: true, caseSensitive: false, entireWord: false }],
		['selectAnnotations', ['selected']],
		['navigate', { annotationID: 'selected' }],
		['navigate', { pageIndex: 3 }],
		['setPageLabels', ['i', '1']],
		['renderThumbnails', [0, 2], undefined],
		['renderThumbnails', [1], { maxWidth: 80, maxHeight: 64 }],
		['renderAnnotationImages', ['image', 'ink']],
		['enterPassword', 'slaptažodis'],
	]);
});
