/* global globalThis */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

globalThis.window ??= {};
window.computedFontFamily = 'sans-serif';

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('!!raw-loader!')) {
			return nextResolve('data:text/javascript,export default "";', context);
		}
		if (specifier.endsWith('common/view')) {
			return nextResolve('data:text/javascript,export default {};', context);
		}
		if (specifier.endsWith('common/sdt/position-mapper')) {
			return nextResolve('data:text/javascript,export let getBlockNodeByRef = () => null;', context);
		}
		if (specifier.endsWith('common/lib/history')) {
			return nextResolve('data:text/javascript,export class History {};', context);
		}
		if (specifier.endsWith('common/read-aloud/jump-button')) {
			return nextResolve('data:text/javascript,export class ReadAloudJumpButton {};', context);
		}
		if (specifier.endsWith('dom/common/lib/selector')) {
			return nextResolve('data:text/javascript,export let isSelector = () => false;', context);
		}
		let error;
		for (let candidate of [specifier, specifier + '.js', specifier + '.mjs', specifier + '.ts']) {
			try {
				return nextResolve(candidate, context);
			}
			catch (e) {
				error ||= e;
			}
		}
		throw error;
	},
});

const [
	{ default: PDFView },
	{ PDFNativeTextSelection },
] = await Promise.all([
	import('../../src/pdf/pdf-view.js'),
	import('../../src/pdf/native-text-selection.js'),
]);

function createRoot() {
	let attributes = new Set();
	return {
		hasAttribute: name => attributes.has(name),
		toggleAttribute(name, force) {
			if (force) {
				attributes.add(name);
			}
			else {
				attributes.delete(name);
			}
		},
	};
}

function createClassList(...names) {
	let values = new Set(names);
	return { contains: name => values.has(name) };
}

function createNativeSelectionFixture() {
	let root = createRoot();
	let page = { dataset: { pageNumber: '1' } };
	let textLayer = {
		nodeType: 1,
		classList: createClassList('textLayer'),
		draggable: true,
		isConnected: true,
		closest(selector) {
			if (selector === '.textLayer') {
				return this;
			}
			if (selector === '.page') {
				return page;
			}
			return null;
		},
	};
	let listeners = new Map();
	let selection = null;
	let document = {
		documentElement: root,
		addEventListener(type, listener) {
			listeners.set(type, listener);
		},
		removeEventListener(type, listener) {
			if (listeners.get(type) === listener) {
				listeners.delete(type);
			}
		},
		querySelectorAll: selector => (selector === '.textLayer' ? [textLayer] : []),
	};
	let win = {
		document,
		Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
		getSelection: () => selection,
		setTimeout,
		clearTimeout,
		requestAnimationFrame: callback => setTimeout(callback, 0),
		cancelAnimationFrame: clearTimeout,
	};
	let selectedAnnotationIDs = ['annotation'];
	let view = {
		_iframeWindow: win,
		_mobile: true,
		_tool: { type: 'pointer' },
		_pdfPages: [],
		_selectionRanges: [],
		get _selectedAnnotationIDs() {
			return selectedAnnotationIDs;
		},
		_onSelectAnnotations(ids) {
			selectedAnnotationIDs = ids;
		},
		_setSelectionRanges(ranges) {
			this._selectionRanges = ranges || [];
		},
		_render() {},
		_updateViewStats() {},
		pointerEventToPosition: () => null,
		getSelectableAnnotations: () => [],
		_getSelectableOverlay: () => null,
	};
	return {
		listeners,
		root,
		setSelection: value => selection = value,
		textLayer,
		view,
	};
}

test('native PDF selection is enabled for the mobile pointer tool and cleared for annotation tools', () => {
	let { listeners, root, textLayer, view } = createNativeSelectionFixture();
	let nativeSelection = new PDFNativeTextSelection(view);

	assert.equal(nativeSelection.enabled, true);
	assert.equal(root.hasAttribute('data-native-text-selection'), true);
	assert.equal(textLayer.draggable, false);
	assert.equal(listeners.has('selectionchange'), true);

	view._selectionRanges = [{ collapsed: false }];
	view._tool = { type: 'highlight' };
	nativeSelection.updateEnabledState();
	assert.equal(nativeSelection.enabled, false);
	assert.equal(root.hasAttribute('data-native-text-selection'), false);
	assert.equal(textLayer.draggable, true);
	assert.deepEqual(view._selectionRanges, []);

	nativeSelection.destroy();
	assert.equal(listeners.has('selectionchange'), false);
});

test('native selection owns text-layer input, but annotations still win hit testing', () => {
	let { setSelection, textLayer, view } = createNativeSelectionFixture();
	let nativeSelection = new PDFNativeTextSelection(view);

	assert.equal(nativeSelection.handlePointerDown({ type: 'pointerdown', pointerType: 'pen', target: textLayer }), false);
	assert.equal(nativeSelection.handlePointerDown({ type: 'mousedown', target: textLayer }), true);
	assert.deepEqual(view._selectedAnnotationIDs, []);
	assert.equal(nativeSelection.shouldAllowNativeTouch({ target: textLayer }), true);

	let textNode = {
		nodeType: 3,
		parentElement: textLayer,
		isConnected: true,
	};
	let selection = {
		anchorNode: textNode,
		anchorOffset: 0,
		focusNode: textNode,
		focusOffset: 1,
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => ({ startContainer: textNode, startOffset: 0 }),
		removeAllRanges() {
			this.rangeCount = 0;
			this.isCollapsed = true;
		},
	};
	setSelection(selection);
	view.pointerEventToPosition = () => ({ pageIndex: 0, rects: [[0, 0, 1, 1]] });
	view.getSelectableAnnotations = () => [{ id: 'annotation' }];
	let annotationTarget = { nodeType: 1, closest: () => null };

	assert.equal(nativeSelection.handlePointerDown({ type: 'pointerdown', target: annotationTarget }), false);
	assert.equal(selection.rangeCount, 0);
	nativeSelection.destroy();
});

test('native selection synchronizes Reader state and restores transient Android handle ranges', () => {
	let { root, setSelection, textLayer, view } = createNativeSelectionFixture();
	let nativeSelection = new PDFNativeTextSelection(view);
	let textNode = {
		nodeType: 3,
		parentElement: textLayer,
		isConnected: true,
	};
	let range = { startContainer: textNode, startOffset: 0 };
	let selection = {
		anchorNode: textNode,
		anchorOffset: 0,
		focusNode: textNode,
		focusOffset: 8,
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => range,
		toString: () => 'selected',
	};
	setSelection(selection);
	view._pdfPages = [{ chars: [{ c: 'selected' }] }];
	let mappedRanges = [{ collapsed: false, text: 'selected' }];
	nativeSelection._getMappedSelectionRanges = () => mappedRanges;
	nativeSelection._getSelectionRangesByRects = () => null;

	assert.equal(nativeSelection.syncNow(), true);
	assert.equal(root.hasAttribute('data-native-text-selection-mapped'), true);
	assert.equal(view._selectionRanges, mappedRanges);

	let restored;
	let sentinel = {
		nodeType: 1,
		classList: createClassList('textLayer', 'selecting'),
	};
	setSelection({
		anchorNode: sentinel,
		isCollapsed: true,
		rangeCount: 1,
		setBaseAndExtent(...args) {
			restored = args;
		},
	});
	nativeSelection._handleSelectionChange();
	assert.deepEqual(restored, [textNode, 0, textNode, 8]);
	nativeSelection.destroy();
});

test('native selection maps a PDF.js text layer and falls back to range geometry', () => {
	let { root, setSelection, textLayer, view } = createNativeSelectionFixture();
	let popups = [];
	view._setSelectionRanges = PDFView.prototype._setSelectionRanges;
	view._getAnnotationFromSelectionRanges = PDFView.prototype._getAnnotationFromSelectionRanges;
	view._getPageLabel = () => '1';
	view.getClientRectForPopup = () => [1, 2, 3, 4];
	view._onSetSelectionPopup = popup => popups.push(popup);
	let textDiv = {
		nodeType: 1,
		parentElement: textLayer,
		closest: selector => (selector === '.textLayer' ? textLayer : null),
	};
	let textNode = {
		nodeType: 3,
		nodeValue: 'A \uFB03 B',
		parentElement: textDiv,
		isConnected: true,
	};
	textDiv.parentElement = textLayer;
	textLayer.contains = node => node === textDiv;
	textLayer.closest = (selector) => {
		if (selector === '.textLayer') {
			return textLayer;
		}
		if (selector === '.page') {
			return { dataset: { pageNumber: '1' } };
		}
		return null;
	};
	view._iframeWindow.NodeFilter = { SHOW_TEXT: 4 };
	view._iframeWindow.document.createTreeWalker = (rootNode) => {
		assert.equal(rootNode, textDiv);
		let returned = false;
		return {
			nextNode() {
				if (returned) {
					return null;
				}
				returned = true;
				return textNode;
			},
		};
	};
	view._iframeWindow.document.createRange = () => ({
		setStart() {},
		setEnd() {},
		getClientRects: () => [{
			left: 4,
			top: 0,
			right: 5,
			bottom: 1,
			width: 1,
			height: 1,
		}],
	});
	view._iframeWindow.PDFViewerApplication = {
		pdfViewer: {
			getPageView: (pageIndex) => {
				assert.equal(pageIndex, 0);
				return {
					div: { getBoundingClientRect: () => ({
						left: 0,
						top: 0,
						right: 10,
						bottom: 10,
					}) },
					viewport: { transform: [1, 0, 0, 1, 0, 0] },
					textLayer: { highlighter: { textDivs: [textDiv] } },
				};
			},
		},
	};
	let chars = [
		{ c: 'A', spaceAfter: true },
		{ c: 'f' },
		{ c: 'f' },
		{ c: 'i', spaceAfter: true },
		{ c: 'B', lineBreakAfter: true },
	].map((char, index) => ({
		...char,
		pageIndex: 0,
		offset: index,
		rect: [index, 0, index + 1, 1],
		inlineRect: [index, 0, index + 1, 1],
	}));
	view._pdfPages = [{ chars, viewBox: [0, 0, 10, 10] }];
	let range = {
		startContainer: textNode,
		startOffset: 0,
		endContainer: textNode,
		endOffset: textNode.nodeValue.length,
		commonAncestorContainer: textNode,
		intersectsNode: node => node === textNode,
	};
	let selectionText = textNode.nodeValue;
	setSelection({
		anchorNode: textNode,
		anchorOffset: 0,
		focusNode: textNode,
		focusOffset: textNode.nodeValue.length,
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => range,
		toString: () => selectionText,
	});

	let nativeSelection = new PDFNativeTextSelection(view);
	assert.equal(nativeSelection.syncNow(), true);
	assert.equal(root.hasAttribute('data-native-text-selection-mapped'), true);
	assert.equal(view._selectionRanges.length, 1);
	assert.equal(view._selectionRanges[0].anchorOffset, 0);
	assert.equal(view._selectionRanges[0].headOffset, chars.length);
	assert.equal(view._selectionRanges[0].text, 'A ffi B');
	assert.deepEqual(popups.at(-1), {
		rect: [1, 2, 3, 4],
		annotation: {
			type: 'highlight',
			color: undefined,
			sortIndex: view._selectionRanges[0].sortIndex,
			pageLabel: '1',
			position: view._selectionRanges[0].position,
			text: 'A ffi B',
		},
	});

	// Simulate a text-layer mismatch. The browser range covers only the last
	// glyph, so geometry must recover the usable Reader selection.
	selectionText = 'B';
	assert.equal(nativeSelection.syncNow(), true);
	assert.equal(view._selectionRanges[0].anchorOffset, chars.length - 1);
	assert.equal(view._selectionRanges[0].headOffset, chars.length);
	assert.equal(view._selectionRanges[0].text, 'B');
	assert.equal(popups.at(-1).annotation.text, 'B');
	nativeSelection.destroy();
});

test('native selection lazily prepares missing PDF page text before synchronizing', async () => {
	let { root, setSelection, textLayer, view } = createNativeSelectionFixture();
	let nativeSelection = new PDFNativeTextSelection(view);
	let textNode = { nodeType: 3, parentElement: textLayer, isConnected: true };
	setSelection({
		anchorNode: textNode,
		anchorOffset: 0,
		focusNode: textNode,
		focusOffset: 8,
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => ({ startContainer: textNode, startOffset: 0 }),
		toString: () => 'selected',
	});
	view._pdfPages = [{}];
	let prepared = [];
	view._ensureBasicPageData = async (pageIndex) => {
		prepared.push(pageIndex);
		view._pdfPages[pageIndex].chars = [{ c: 'selected' }];
	};
	let mappedRanges = [{ collapsed: false, text: 'selected' }];
	nativeSelection._getMappedSelectionRanges = () => mappedRanges;
	nativeSelection._getSelectionRangesByRects = () => null;

	assert.equal(nativeSelection.syncNow(), false);
	assert.equal(root.hasAttribute('data-native-text-selection-mapped'), false);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(prepared, [0]);
	assert.equal(root.hasAttribute('data-native-text-selection-mapped'), true);
	assert.equal(view._selectionRanges, mappedRanges);
	nativeSelection.destroy();
});

test('native selection remaps a text layer after page rerendering', async () => {
	let { setSelection, textLayer, view } = createNativeSelectionFixture();
	let nativeSelection = new PDFNativeTextSelection(view);
	let textNode = { nodeType: 3, parentElement: textLayer, isConnected: true };
	setSelection({
		anchorNode: textNode,
		anchorOffset: 0,
		focusNode: textNode,
		focusOffset: 1,
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => ({ startContainer: textNode, startOffset: 0 }),
	});
	let prepared = [];
	let scheduled = 0;
	view._ensureBasicPageData = async pageIndex => prepared.push(pageIndex);
	nativeSelection.scheduleSync = () => scheduled++;
	nativeSelection.handleTextLayerRendered(textLayer);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(textLayer.draggable, false);
	assert.deepEqual(prepared, [0]);
	assert.equal(scheduled, 1);
	nativeSelection.destroy();
});

test('native selection defers browser-owned gestures while keeping context-menu state synchronized', () => {
	let { setSelection, textLayer, view } = createNativeSelectionFixture();
	let cleared = 0;
	view._clearPointerAction = () => cleared++;
	let nativeSelection = new PDFNativeTextSelection(view);
	let textNode = { nodeType: 3, parentElement: textLayer, isConnected: true };
	setSelection({
		anchorNode: textNode,
		anchorOffset: 0,
		focusNode: textNode,
		focusOffset: 1,
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => ({ startContainer: textNode, startOffset: 0 }),
	});
	assert.equal(nativeSelection.shouldDeferEvent({ target: textLayer }), true);
	let syncs = 0;
	nativeSelection.syncNow = () => {
		syncs++;
		return true;
	};
	assert.equal(nativeSelection.handleContextMenu({ target: textLayer }), true);
	assert.equal(syncs, 1);
	assert.equal(cleared, 1);
	nativeSelection.destroy();
});

test('mobile PDF initialization installs native-selection and touch-transform event ownership', async () => {
	let listeners = [];
	let eventBusListeners = [];
	let root = createRoot();
	let defaultView = {
		requestAnimationFrame: () => 1,
		addEventListener(type) {
			listeners.push([`auto:${type}`]);
		},
	};
	let viewerContainer = {
		ownerDocument: { defaultView },
		scrollLeft: 0,
		scrollTop: 0,
	};
	let document = {
		documentElement: root,
		body: {
			addEventListener(type) {
				listeners.push([`body:${type}`]);
			},
			append() {},
		},
		addEventListener(type) {
			listeners.push([`document:${type}`]);
		},
		removeEventListener() {},
		querySelectorAll: () => [],
		createElement: () => ({ style: {} }),
		getElementById: () => viewerContainer,
	};
	let win = {
		document,
		Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
		addEventListener(type, _listener, options) {
			listeners.push([type, options]);
		},
		getSelection: () => null,
		setTimeout,
		clearTimeout,
		requestAnimationFrame: () => 1,
		cancelAnimationFrame() {},
		PDFViewerApplication: {
			initializedPromise: Promise.resolve(),
			eventBus: { on: type => eventBusListeners.push(type) },
			pdfViewer: { linkService: {} },
		},
	};
	let view = Object.create(PDFView.prototype);
	Object.assign(view, {
		_iframeWindow: win,
		_mobile: true,
		_tool: { type: 'pointer' },
		_selectionRanges: [],
		_selectedAnnotationIDs: [],
		_pdfPages: [],
		_destroyed: false,
		_onKeyUp() {},
		_handlePointerMove() {},
		_searchController: { initializePDF: value => assert.equal(value, win.PDFViewerApplication.pdfViewer.linkService) },
		_options: {},
	});

	await PDFView.prototype._init.call(view);
	assert.equal(view._nativeTextSelection instanceof PDFNativeTextSelection, true);
	assert.equal(listeners.some(([type]) => type === 'touchmove'), true);
	assert.equal(listeners.some(([type]) => type === 'touchend'), true);
	assert.equal(listeners.some(([type]) => type === 'lostpointercapture'), true);
	assert.equal(listeners.some(([type]) => type === 'resize'), true);
	assert.equal(eventBusListeners.includes('textlayerrendered'), true);
	view._nativeTextSelection.destroy();
});

test('destroying a mobile PDF view releases native selection', () => {
	let calls = [];
	let previousRemoveEventListener = window.removeEventListener;
	window.removeEventListener = (...args) => calls.push(['removeEventListener', ...args]);
	let view = {
		_destroyed: false,
		_handleWebViewerLoaded() {},
		_sdtLifecycle: { destroy: () => calls.push(['sdt']) },
		_searchController: { destroy: () => calls.push(['search']) },
		_documentData: { destroy: () => calls.push(['document']) },
		_resolveInitializedPromise: value => calls.push(['initialized', value]),
		_resolvePageLabels: () => calls.push(['pageLabels']),
		_overlayPopupDelayer: { destroy: () => calls.push(['popup']) },
		_nativeTextSelection: { destroy: () => calls.push(['nativeSelection']) },
		_clearPendingBackdropTap() {},
	};
	try {
		PDFView.prototype.destroy.call(view);
	}
	finally {
		window.removeEventListener = previousRemoveEventListener;
	}

	assert.equal(calls.filter(([name]) => name === 'popup').length, 1);
	assert.equal(calls.filter(([name]) => name === 'nativeSelection').length, 1);
});

test('primary mobile PDF document initialization requests outline data', async () => {
	let pdfDocument = { id: 'pdf-document' };
	let outlineRequests = 0;
	let initialized = 0;
	let view = {
		_destroyed: false,
		_mobile: true,
		_primary: true,
		_preview: false,
		_tool: { type: 'pointer' },
		_viewState: null,
		_location: null,
		_iframeWindow: {
			PDFViewerApplication: {
				pdfDocument,
				pdfViewer: { currentScaleValue: null },
			},
		},
		_documentData: {
			setDocument() {},
			setOutlineActive: value => outlineRequests += Number(value),
		},
		_searchController: { setDocument() {} },
		_findController: { setDocument() {} },
		_initNativeOutline: () => outlineRequests++,
		_initProcessedData: async () => {},
		setTool() {},
		_resolveInitializedPromise: () => initialized++,
	};

	await PDFView.prototype._handleDocumentInit.call(view);
	assert.equal(view._iframeWindow.PDFViewerApplication.pdfViewer.currentScaleValue, 'page-width');
	assert.equal(initialized, 1);
	assert.equal(outlineRequests, 1);
});

test('PDF text-layer and annotation selection changes stay synchronized with native selection', () => {
	let renderedLayers = [];
	let clears = 0;
	let domClears = 0;
	let renders = 0;
	let popups = 0;
	let textLayer = {};
	let view = {
		_nativeTextSelection: {
			handleTextLayerRendered: layer => renderedLayers.push(layer),
			clear: () => clears++,
		},
		_iframeWindow: { getSelection: () => ({ removeAllRanges: () => domClears++ }) },
		_render: () => renders++,
		_onSetAnnotationPopup: () => popups++,
	};
	PDFView.prototype._handleTextLayerRendered.call(view, {
		source: { div: { querySelector: () => textLayer } },
	});
	PDFView.prototype.clearSelection.call(view);
	PDFView.prototype.setSelectedAnnotationIDs.call(view, ['annotation']);
	assert.deepEqual(renderedLayers, [textLayer]);
	assert.equal(clears, 2);
	assert.equal(domClears, 1);
	assert.deepEqual(view._selectedAnnotationIDs, ['annotation']);
	assert.equal(renders, 1);
	assert.equal(popups, 1);
});

function createPointerView(platform = 'android', annotation = { id: 'annotation', type: 'highlight' }) {
	let selected = [];
	let currentPosition = { pageIndex: 0, rects: [[10, 10, 11, 11]] };
	let view = {
		_options: { platform },
		_tool: { type: 'pointer' },
		_nativeTextSelection: null,
		_creationTimeout: null,
		_pendingBackdropTap: null,
		_pointerDownTriggered: false,
		_touchTransform: null,
		_selectedAnnotationIDs: [],
		_selectionRanges: [],
		_iframeWindow: { getSelection: () => ({ removeAllRanges() {} }) },
		_autoScroll: { enable() {}, disable() {} },
		_overlayPopupDelayer: { close: callback => callback() },
		_isSelectionCollapsed: () => true,
		_clearFocus() {},
		pointerEventToPosition: () => currentPosition,
		getPageByIndex: () => ({}),
		getActionAtPosition: () => ({
			action: { type: 'none', triggered: false, selection: false },
			selectAnnotations: currentPosition ? [annotation] : [],
		}),
		getSelectableAnnotations: () => (currentPosition ? [annotation] : []),
		_getSelectableOverlay: () => null,
		_shouldHandleBackdropTap: () => false,
		_getEdgePageTurnDirection: () => null,
		_isDoubleTapCandidate: () => false,
		_releaseTouchTransform() {},
		_onSelectAnnotations(ids) {
			selected.push(ids);
			this._selectedAnnotationIDs = ids;
		},
		_openAnnotationPopup() {},
		_onSetSelectionPopup() {},
		_onSetOverlayPopup() {},
		_onBackdropTap() {},
		_render() {},
		_updateViewStats() {},
		updateCursor() {},
	};
	return {
		selected,
		setPosition: position => currentPosition = position,
		view,
	};
}

function createPointerEvent(pointerType = 'touch') {
	return {
		button: 0,
		clientX: 10,
		clientY: 10,
		detail: 1,
		pointerId: 1,
		pointerType,
		shiftKey: false,
		target: {
			classList: createClassList(),
			closest: selector => (selector === '#viewerContainer' ? {} : null),
			setPointerCapture() {},
		},
		preventDefault() {},
		stopPropagation() {},
	};
}

function createEdgePageTurnView({
	platform = 'android',
	scrollMode = 1,
	spreadMode = 0,
	width = 1000,
	scale = 2.5,
	navigationResult = true,
} = {}) {
	let calls = { backdrop: 0, manual: 0, next: 0, previous: 0 };
	let pdfViewer = {
		currentScaleValue: scale,
		scrollMode,
		spreadMode,
		nextPage() {
			calls.next++;
			return navigationResult;
		},
		previousPage() {
			calls.previous++;
			return navigationResult;
		},
	};
	let view = {
		_options: { platform },
		_iframeWindow: {
			innerWidth: width,
			PDFViewerApplication: { pdfViewer },
		},
		_getEdgePageTurnDirection: PDFView.prototype._getEdgePageTurnDirection,
		navigateToNextPage: PDFView.prototype.navigateToNextPage,
		navigateToPreviousPage: PDFView.prototype.navigateToPreviousPage,
		_onManualNavigation: () => calls.manual++,
		_onBackdropTap: () => calls.backdrop++,
	};
	return { calls, pdfViewer, view };
}

test('Android PDF edge taps turn horizontal pages and preserve zoom', () => {
	let { calls, pdfViewer, view } = createEdgePageTurnView();
	PDFView.prototype._resolveBackdropTap.call(view, {}, 'previous');
	PDFView.prototype._resolveBackdropTap.call(view, {}, 'next');
	PDFView.prototype._resolveBackdropTap.call(view, {}, null);

	assert.deepEqual(calls, { backdrop: 1, manual: 2, next: 1, previous: 1 });
	assert.equal(pdfViewer.currentScaleValue, 2.5);
});

test('Android PDF edge zones scale on phones and cap on wider viewports', () => {
	let { view: phoneView } = createEdgePageTurnView({ width: 393 });
	assert.equal(phoneView._getEdgePageTurnDirection({ pointerType: 'touch' }, 78), 'previous');
	assert.equal(phoneView._getEdgePageTurnDirection({ pointerType: 'touch' }, 79), null);
	assert.equal(phoneView._getEdgePageTurnDirection({ pointerType: 'touch' }, 314), null);
	assert.equal(phoneView._getEdgePageTurnDirection({ pointerType: 'touch' }, 315), 'next');

	let { view: tabletView } = createEdgePageTurnView({ width: 1000 });
	assert.equal(tabletView._getEdgePageTurnDirection({ pointerType: 'touch' }, 96), 'previous');
	assert.equal(tabletView._getEdgePageTurnDirection({ pointerType: 'touch' }, 97), null);
	assert.equal(tabletView._getEdgePageTurnDirection({ pointerType: 'touch' }, 903), null);
	assert.equal(tabletView._getEdgePageTurnDirection({ pointerType: 'touch' }, 904), 'next');
});

test('PDF edge taps fall through outside Android horizontal touch input', () => {
	for (let options of [
		{ scrollMode: 0 },
		{ platform: 'zotero' },
		{ width: 0 },
	]) {
		let { calls, view } = createEdgePageTurnView(options);
		let event = { pointerType: 'touch' };
		let direction = view._getEdgePageTurnDirection(event, 10);
		PDFView.prototype._resolveBackdropTap.call(view, event, direction);
		assert.deepEqual(calls, { backdrop: 1, manual: 0, next: 0, previous: 0 });
	}

	let { calls, view } = createEdgePageTurnView();
	let event = { pointerType: 'mouse' };
	let direction = view._getEdgePageTurnDirection(event, 10);
	PDFView.prototype._resolveBackdropTap.call(view, event, direction);
	assert.deepEqual(calls, { backdrop: 1, manual: 0, next: 0, previous: 0 });
});

test('Android PDF edge taps delegate every spread mode to PDF.js', () => {
	for (let spreadMode of [0, 1, 2]) {
		let { calls, pdfViewer, view } = createEdgePageTurnView({ spreadMode, scale: 3 });
		PDFView.prototype._resolveBackdropTap.call(view, {}, 'previous');
		PDFView.prototype._resolveBackdropTap.call(view, {}, 'next');

		assert.deepEqual(calls, { backdrop: 0, manual: 2, next: 1, previous: 1 });
		assert.equal(pdfViewer.currentScaleValue, 3);
	}
});

test('Android PDF edge taps support pen input', () => {
	let { calls, view } = createEdgePageTurnView();
	let event = { pointerType: 'pen' };
	let direction = view._getEdgePageTurnDirection(event, 990);
	PDFView.prototype._resolveBackdropTap.call(view, event, direction);
	assert.deepEqual(calls, { backdrop: 0, manual: 1, next: 1, previous: 0 });
});

test('Android PDF edge taps remain consumed at document boundaries', () => {
	for (let direction of ['previous', 'next']) {
		// PDF.js returns false when it cannot advance past the first or last page.
		let { calls, view } = createEdgePageTurnView({ navigationResult: false });
		PDFView.prototype._resolveBackdropTap.call(view, {}, direction);

		assert.equal(calls.backdrop, 0);
		assert.equal(calls.manual, 1);
		assert.equal(calls[direction], 1);
	}
});

function createBackdropTapEligibilityFixture() {
	let pointerDownPosition = {};
	let position = {};
	let event = {
		button: 0,
		clientX: 10,
		clientY: 10,
		isPrimary: true,
		target: { closest: () => ({}) },
	};
	let view = {
		_onBackdropTap() {},
		_pointerDownTap: {
			x: 10,
			y: 10,
			button: 0,
			inViewerContainer: true,
			hadSelection: false,
		},
		_scrolling: false,
		pointerDownPosition,
		action: { type: 'none', triggered: false },
		_getSelectableOverlay: () => null,
		getSelectableAnnotations: () => [],
		_isSelectionCollapsed: () => true,
	};
	return { event, position, view };
}

test('PDF edge page turns respect existing backdrop gesture exclusions', () => {
	let fixture = createBackdropTapEligibilityFixture();
	assert.equal(PDFView.prototype._shouldHandleBackdropTap.call(
		fixture.view, fixture.event, fixture.position
	), true);

	let cases = [
		['non-primary pointers', ({ event }) => event.isPrimary = false],
		['pre-existing selections', ({ view }) => view._pointerDownTap.hadSelection = true],
		['scrolling', ({ view }) => view._scrolling = true],
		['pointer movement', ({ event }) => event.clientX = 16],
		['annotation transforms', ({ view }) => view.action.triggered = true],
		['annotations', ({ view }) => view.getSelectableAnnotations = () => [{}]],
		['links', ({ view }) => view._getSelectableOverlay = () => ({ type: 'internal-link' })],
		['citations', ({ view }) => view._getSelectableOverlay = () => ({ type: 'citation' })],
		['text selection', ({ view }) => {
			view.action.type = 'selectText';
			view._isSelectionCollapsed = () => false;
		}],
		['cancelled pointers', ({ view }) => view._pointerDownTap = null],
	];
	for (let [name, mutate] of cases) {
		let fixture = createBackdropTapEligibilityFixture();
		mutate(fixture);
		assert.equal(PDFView.prototype._shouldHandleBackdropTap.call(
			fixture.view, fixture.event, fixture.position
		), false, name);
	}

	fixture = createBackdropTapEligibilityFixture();
	fixture.event.clientX = 18;
	fixture.event.clientY = 19;
	assert.equal(PDFView.prototype._shouldHandleBackdropTap.call(
		fixture.view, fixture.event, fixture.position
	), false);
	assert.equal(PDFView.prototype._shouldHandleBackdropTap.call(
		fixture.view, fixture.event, fixture.position, 10
	), true);
});

test('Android backdrop taps wait for a possible second tap', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
	let { calls, view } = createEdgePageTurnView();
	view._destroyed = false;
	view._pendingBackdropTap = null;
	view._iframeWindow.setTimeout = setTimeout;
	view._iframeWindow.clearTimeout = clearTimeout;
	view._resolveBackdropTap = PDFView.prototype._resolveBackdropTap;
	view._clearPendingBackdropTap = PDFView.prototype._clearPendingBackdropTap;
	let event = { clientX: 500, clientY: 20, pointerType: 'touch' };

	PDFView.prototype._scheduleBackdropTap.call(view, event, null);
	t.mock.timers.tick(299);
	assert.equal(calls.backdrop, 0);
	t.mock.timers.tick(1);
	assert.equal(calls.previous, 0);
	assert.equal(calls.backdrop, 1);
	assert.equal(view._pendingBackdropTap, null);
});

test('Android edge taps tolerate boundary drift and use the delayed pointer path', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
	let fixture = createPointerView();
	let calls = { backdrop: 0, manual: 0, previous: 0 };
	let pdfViewer = {
		currentScaleValue: 3,
		currentPageNumber: 2,
		pagesCount: 10,
		scrollMode: 1,
		spreadMode: 0,
		previousPage: () => calls.previous++,
	};
	Object.assign(fixture.view, {
		_scrolling: false,
		_iframeWindow: {
			innerWidth: 1000,
			setTimeout,
			clearTimeout,
			getSelection: () => ({ removeAllRanges() {} }),
			PDFViewerApplication: { pdfViewer },
		},
		_shouldHandleBackdropTap: PDFView.prototype._shouldHandleBackdropTap,
		_getEdgePageTurnDirection: PDFView.prototype._getEdgePageTurnDirection,
		_resolveBackdropTap: PDFView.prototype._resolveBackdropTap,
		_scheduleBackdropTap: PDFView.prototype._scheduleBackdropTap,
		_clearPendingBackdropTap: PDFView.prototype._clearPendingBackdropTap,
		navigateToPreviousPage: PDFView.prototype.navigateToPreviousPage,
		_onManualNavigation: () => calls.manual++,
		_onBackdropTap: () => calls.backdrop++,
		getActionAtPosition: () => ({
			action: { type: 'none', triggered: false },
			selectAnnotations: [],
		}),
		getSelectableAnnotations: () => [],
	});
	let event = createPointerEvent();
	event.clientX = 91;

	PDFView.prototype._handlePointerDown.call(fixture.view, event);
	event.clientX = 99;
	event.clientY = 19;
	PDFView.prototype._handlePointerUp.call(fixture.view, event);
	assert.deepEqual(calls, { backdrop: 0, manual: 0, previous: 0 });
	t.mock.timers.tick(300);
	assert.deepEqual(calls, { backdrop: 0, manual: 1, previous: 1 });
	assert.equal(pdfViewer.currentScaleValue, 3);
});

test('Android double taps suppress only their touch-generated compatibility mouse event', (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 1000 });
	let prevented = 0;
	let nativePointerDowns = 0;
	let view = {
		_options: { platform: 'android' },
		_suppressCompatibilityMouseUntil: 1300,
		_isDoubleTapCandidate: () => false,
		_nativeTextSelection: {
			handlePointerDown() {
				nativePointerDowns++;
				return true;
			},
		},
	};
	let compatibilityMouseEvent = {
		type: 'mousedown',
		sourceCapabilities: { firesTouchEvents: true },
		preventDefault: () => prevented++,
	};

	PDFView.prototype._handlePointerDown.call(view, compatibilityMouseEvent);
	assert.equal(prevented, 1);
	assert.equal(nativePointerDowns, 0);

	PDFView.prototype._handlePointerDown.call(view, {
		...compatibilityMouseEvent,
		sourceCapabilities: { firesTouchEvents: false },
	});
	assert.equal(nativePointerDowns, 1);
});

test('Android touch double-tap candidates wait for tap release before claiming the gesture', (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 1000 });
	let fixture = createPointerView();
	let clearedTimeout;
	let pageTurns = 0;
	let prevented = 0;
	fixture.view._pendingBackdropTap = { timeout: 42, callback: () => pageTurns++ };
	fixture.view._suppressCompatibilityMouseUntil = 0;
	fixture.view._iframeWindow.clearTimeout = timeout => clearedTimeout = timeout;
	fixture.view._isDoubleTapCandidate = () => true;
	fixture.view._shouldHandleBackdropTap = () => true;
	fixture.view._getEdgePageTurnDirection = () => 'previous';
	fixture.view._handleDoubleTapZoom = () => true;
	fixture.view._clearPendingBackdropTap = PDFView.prototype._clearPendingBackdropTap;
	fixture.view.getActionAtPosition = () => ({
		action: { type: 'none', triggered: false, selection: false },
		selectAnnotations: null,
	});
	fixture.view.getSelectableAnnotations = () => [];
	let event = createPointerEvent();
	event.type = 'pointerdown';
	event.preventDefault = () => prevented++;

	PDFView.prototype._handlePointerDown.call(fixture.view, event);
	assert.equal(clearedTimeout, 42);
	assert.equal(prevented, 0);
	assert.equal(fixture.view._suppressCompatibilityMouseUntil, 0);

	PDFView.prototype._handlePointerUp.call(fixture.view, event);
	assert.equal(prevented, 1);
	assert.equal(fixture.view._suppressCompatibilityMouseUntil, 1300);
	assert.equal(fixture.view._pendingBackdropTap, null);
	assert.equal(pageTurns, 0);
});

test('Android annotation touches select on tap release, not on scroll start', () => {
	let tap = createPointerView();
	let event = createPointerEvent();
	PDFView.prototype._handlePointerDown.call(tap.view, event);
	assert.deepEqual(tap.selected, []);
	PDFView.prototype._handlePointerUp.call(tap.view, event);
	assert.deepEqual(tap.selected, [['annotation']]);

	let scroll = createPointerView();
	PDFView.prototype._handlePointerDown.call(scroll.view, event);
	scroll.setPosition(null);
	PDFView.prototype._handlePointerUp.call(scroll.view, event);
	assert.deepEqual(scroll.selected, []);

	let desktop = createPointerView('zotero');
	PDFView.prototype._handlePointerDown.call(desktop.view, event);
	assert.deepEqual(desktop.selected, [['annotation']]);

	let androidMouse = createPointerView();
	let mouseEvent = createPointerEvent('');
	mouseEvent.type = 'mousedown';
	PDFView.prototype._handlePointerDown.call(androidMouse.view, mouseEvent);
	assert.deepEqual(androidMouse.selected, [['annotation']]);
});

test('Android text-tool touches create and focus an inline text annotation immediately', () => {
	let fixture = createPointerView();
	let selected = [];
	let added;
	let focused;
	let prevented = 0;
	fixture.view._tool = { type: 'text', color: '#ffd400', size: 12 };
	fixture.view._pdfPages = [];
	fixture.view._getPageLabel = () => '1';
	fixture.view.getActionAtPosition = () => ({
		action: { type: 'text', triggered: false, selection: false },
		selectAnnotations: [],
	});
	fixture.view._onAddAnnotation = (annotation, select) => {
		added = { annotation, select };
		return { ...annotation, id: 'text' };
	};
	fixture.view._onSelectAnnotations = (ids, _event, options) => selected.push({ ids, options });
	fixture.view._focusTextAnnotation = id => focused = id;
	let event = createPointerEvent();
	event.preventDefault = () => prevented++;

	PDFView.prototype._handlePointerDown.call(fixture.view, event);
	assert.equal(added.select, false);
	assert.equal(added.annotation.type, 'text');
	assert.equal(added.annotation.position.fontSize, 12);
	assert.deepEqual(selected, [{ ids: ['text'], options: { inlineTextEditing: true } }]);
	assert.equal(focused, 'text');
	assert.equal(prevented, 1);
	assert.equal(fixture.view.action.alreadySelectedAnnotations, true);
});

test('Android touch transforms capture the pointer before moving a selected annotation', () => {
	let fixture = createPointerView();
	let captured = [];
	let released = [];
	let prevented = 0;
	let action = {
		type: 'moveAndDrag',
		triggered: false,
		selection: false,
		annotation: {
			id: 'annotation',
			type: 'note',
			position: { pageIndex: 0, rects: [[0, 0, 10, 10]] },
		},
	};
	fixture.view._selectedAnnotationIDs = ['annotation'];
	fixture.view.getActionAtPosition = () => ({ action, selectAnnotations: null });
	let event = createPointerEvent();
	event.target.setPointerCapture = pointerID => captured.push(pointerID);
	event.target.hasPointerCapture = () => true;
	event.target.releasePointerCapture = pointerID => released.push(pointerID);
	event.preventDefault = () => prevented++;

	PDFView.prototype._handlePointerDown.call(fixture.view, event);
	assert.deepEqual(captured, [1]);
	assert.equal(fixture.view._touchTransform.pointerID, 1);
	assert.equal(prevented, 1);
	PDFView.prototype._releaseTouchTransform.call(fixture.view);
	assert.deepEqual(released, [1]);
	assert.equal(fixture.view._touchTransform, null);
});

test('tapping a selected text annotation enters editing without stealing an existing caret', () => {
	let annotation = { id: 'text', type: 'text' };
	let fixture = createPointerView('android', annotation);
	let blurred = 0;
	let focused = [];
	let prevented = 0;
	let stopped = 0;
	fixture.view._selectedAnnotationIDs = ['text'];
	fixture.view.getFocusedTextAnnotationID = () => 'other';
	fixture.view._getFocusedTextAnnotationNode = () => ({ blur: () => blurred++ });
	fixture.view._focusTextAnnotation = id => focused.push(id);
	let event = createPointerEvent();
	event.preventDefault = () => prevented++;
	event.stopPropagation = () => stopped++;
	PDFView.prototype._handlePointerDown.call(fixture.view, event);
	PDFView.prototype._handlePointerUp.call(fixture.view, event);
	assert.equal(blurred, 1);
	assert.deepEqual(focused, ['text']);
	assert.equal(prevented, 1);
	assert.equal(stopped, 1);

	let alreadyFocused = createPointerView('android', annotation);
	alreadyFocused.view._selectedAnnotationIDs = ['text'];
	alreadyFocused.view.getFocusedTextAnnotationID = () => 'text';
	alreadyFocused.view._getFocusedTextAnnotationNode = () => assert.fail('must keep current editor');
	alreadyFocused.view._focusTextAnnotation = () => assert.fail('must keep current caret');
	let caretEvent = createPointerEvent();
	let caretPrevents = 0;
	caretEvent.preventDefault = () => caretPrevents++;
	PDFView.prototype._handlePointerDown.call(alreadyFocused.view, caretEvent);
	PDFView.prototype._handlePointerUp.call(alreadyFocused.view, caretEvent);
	assert.equal(caretPrevents, 0);
});

test('Android annotation tools claim touch input without changing pointer or hand behavior', () => {
	let root = createRoot();
	let switchedTools = [];
	let nativeUpdates = 0;
	let view = {
		_options: { platform: 'android' },
		_tool: { type: 'pointer' },
		_iframeWindow: {
			PDFViewerApplication: {
				pdfCursorTools: { switchTool: tool => switchedTools.push(tool) },
			},
			document: { documentElement: root },
		},
		_nativeTextSelection: { updateEnabledState: () => nativeUpdates++ },
		_textAnnotationFocused: () => false,
		updateCursor() {},
	};

	PDFView.prototype.setTool.call(view, { type: 'highlight' });
	assert.equal(root.hasAttribute('data-android-annotation-tool'), true);
	PDFView.prototype.setTool.call(view, { type: 'pointer' });
	assert.equal(root.hasAttribute('data-android-annotation-tool'), false);
	PDFView.prototype.setTool.call(view, { type: 'hand' });
	assert.equal(root.hasAttribute('data-android-annotation-tool'), false);
	assert.deepEqual(switchedTools, [0, 0, 1]);
	assert.equal(nativeUpdates, 3);

	view._options.platform = 'zotero';
	PDFView.prototype.setTool.call(view, { type: 'highlight' });
	assert.equal(root.hasAttribute('data-android-annotation-tool'), false);
});

test('changing Android tools finishes an active text editor exactly once', () => {
	let root = createRoot();
	let finishes = 0;
	let view = {
		_options: { platform: 'android' },
		_tool: { type: 'pointer' },
		_iframeWindow: {
			PDFViewerApplication: { pdfCursorTools: { switchTool() {} } },
			document: { documentElement: root },
		},
		_nativeTextSelection: null,
		_textAnnotationFocused: () => true,
		finishTextAnnotationEditing: () => finishes++,
		updateCursor() {},
	};

	PDFView.prototype.setTool.call(view, { type: 'highlight' });
	PDFView.prototype.setTool.call(view, { type: 'highlight' });
	assert.equal(finishes, 1);
});

test('native touch-end handoff preserves scrolling and active transforms keep app ownership', () => {
	let pointerUps = 0;
	let cleared = 0;
	let prevented = 0;
	let view = {
		_touchTransform: null,
		_pointerDownTriggered: true,
		_nativeTextSelection: {
			handlePointerUp: () => pointerUps++,
			shouldAllowNativeTouch: () => true,
		},
		_clearPointerAction: () => cleared++,
	};
	let event = { cancelable: true, preventDefault: () => prevented++ };

	PDFView.prototype._handleTouchEnd.call(view, event);
	assert.equal(cleared, 1);
	assert.equal(prevented, 0);

	view._touchTransform = {};
	PDFView.prototype._handleTouchEnd.call(view, event);
	assert.equal(prevented, 1);
	assert.equal(view._pointerDownTriggered, false);
	assert.equal(pointerUps, 2);

	view._touchTransform = null;
	view._nativeTextSelection.shouldAllowNativeTouch = () => false;
	view._pointerDownTriggered = true;
	PDFView.prototype._handleTouchEnd.call(view, {
		cancelable: false,
		preventDefault: () => assert.fail('non-cancelable scrolling must not be interrupted'),
	});
	assert.equal(view._pointerDownTriggered, false);
});

test('native-selection gesture deferral leaves touch move and pointer-up to the browser', () => {
	let prevented = 0;
	let cleared = 0;
	let pendingTapClears = 0;
	let view = {
		_nativeTextSelection: {
			enabled: true,
			shouldDeferEvent: () => true,
			handlePointerUp() {},
		},
		_tool: { type: 'highlight' },
		_touchTransform: null,
		_pointerDownTap: { doubleTap: true },
		_clearPendingBackdropTap: () => pendingTapClears++,
		_clearPointerAction: () => cleared++,
	};
	let event = {
		target: { id: 'page' },
		preventDefault: () => prevented++,
	};
	PDFView.prototype._handleTouchMove.call(view, event);
	assert.equal(prevented, 0);
	PDFView.prototype._handlePointerUp.call(view, event);
	assert.equal(cleared, 1);
	assert.equal(pendingTapClears, 1);

	view._nativeTextSelection.shouldDeferEvent = () => false;
	view._touchTransform = {};
	PDFView.prototype._handleTouchMove.call(view, event);
	assert.equal(prevented, 1);
});

test('interrupted Android annotation transforms release pointer capture and reset interaction state', () => {
	let released = [];
	let renders = 0;
	let pendingTapClears = 0;
	let target = {
		hasPointerCapture: () => true,
		releasePointerCapture: pointerID => released.push(pointerID),
	};
	let view = {
		_touchTransform: { pointerID: 7, target },
		_nativeTextSelection: null,
		_dragging: false,
		action: { type: 'moveAndDrag' },
		pointerDownPosition: {},
		_pointerDownTriggered: true,
		_pointerDownTap: { doubleTap: true },
		_clearPendingBackdropTap: () => pendingTapClears++,
		_render: () => renders++,
		_releaseTouchTransform: PDFView.prototype._releaseTouchTransform,
		_handlePointerCancel: PDFView.prototype._handlePointerCancel,
	};

	PDFView.prototype._handleTouchTransformInterrupted.call(view, { pointerId: 8 });
	assert.equal(view._touchTransform.pointerID, 7);
	PDFView.prototype._handleTouchTransformInterrupted.call(view, { pointerId: 7 });
	assert.deepEqual(released, [7]);
	assert.equal(view._touchTransform, null);
	assert.equal(view.action, null);
	assert.equal(view.pointerDownPosition, null);
	assert.equal(view._pointerDownTriggered, false);
	assert.equal(pendingTapClears, 1);
	assert.equal(renders, 1);
});

test('native selection keeps keyboard range movement in the browser and invalid copies untouched', () => {
	let prevented = 0;
	let stopped = 0;
	let view = {
		_textAnnotationFocused: () => false,
		_nativeTextSelection: {
			enabled: true,
			hasSelection: () => true,
			syncNow: () => false,
		},
		_selectionRanges: [{ collapsed: false }],
		_selectedAnnotationIDs: [],
		_annotations: [],
		_readOnly: true,
		_focusedObject: null,
		_selectedOverlay: null,
		_onKeyDown() {},
	};
	let keyEvent = {
		key: 'ArrowLeft',
		code: 'ArrowLeft',
		shiftKey: true,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		target: { classList: createClassList() },
		preventDefault: () => prevented++,
		stopPropagation: () => stopped++,
	};
	PDFView.prototype._handleKeyDown.call(view, keyEvent);
	assert.equal(prevented, 0);
	assert.equal(stopped, 0);

	let copyEvent = {
		clipboardData: { setData: () => assert.fail('clipboard must not change') },
		preventDefault: () => prevented++,
		stopPropagation: () => stopped++,
	};
	PDFView.prototype._handleCopy.call(view, copyEvent);
	assert.equal(prevented, 0);
	assert.equal(stopped, 0);
});

test('Escape clears a native PDF selection through the shared selection lifecycle', () => {
	let prevented = 0;
	let clears = 0;
	let view = {
		_textAnnotationFocused: () => false,
		_nativeTextSelection: { enabled: true, hasSelection: () => true },
		_selectionRanges: [],
		_selectedAnnotationIDs: [],
		_annotations: [],
		_readOnly: true,
		_focusedObject: null,
		_selectedOverlay: null,
		action: null,
		pointerDownPosition: null,
		clearSelection: () => clears++,
		_render() {},
		_onKeyDown() {},
	};
	let event = {
		key: 'Escape',
		code: 'Escape',
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		target: { classList: createClassList() },
		preventDefault: () => prevented++,
		stopPropagation() {},
	};
	PDFView.prototype._handleKeyDown.call(view, event);
	assert.equal(prevented, 1);
	assert.equal(clears, 1);
});

test('PDF context menus defer to native Android selection before Reader hit testing', () => {
	let nativeCalls = 0;
	let view = {
		_options: { platform: 'android' },
		_nativeTextSelection: {
			handleContextMenu: () => {
				nativeCalls++;
				return true;
			},
		},
		pointerEventToPosition: () => assert.fail('Reader hit testing must not run'),
	};
	PDFView.prototype._handleContextMenu.call(view, {});
	assert.equal(nativeCalls, 1);
});

test('PDF password entry resumes an active request and reports when view recreation is needed', () => {
	let passwords = [];
	let view = {
		_password: null,
		_passwordUpdateCallback: password => passwords.push(password),
	};
	assert.equal(PDFView.prototype.enterPassword.call(view, 'secret'), true);
	assert.equal(view._password, 'secret');
	assert.equal(view._passwordUpdateCallback, null);
	assert.deepEqual(passwords, ['secret']);
	assert.equal(PDFView.prototype.enterPassword.call(view, 'replacement'), false);
	assert.equal(view._password, 'replacement');
});

test('PDF view buffers mobile annotation image requests until its renderer is initialized', async () => {
	let delivered = [];
	let eventHandlers = [];
	let view = {
		_pdfRenderer: null,
		_pendingAnnotationImageIDs: null,
		_onRenderAnnotationImage: value => delivered.push(value),
		_annotations: [],
		_primary: false,
		_preview: false,
		_iframeWindow: {
			PDFViewerApplication: {
				eventBus: { on: (...args) => eventHandlers.push(args) },
			},
		},
		_handleViewAreaUpdate() {},
		_updateViewStats() {},
	};
	PDFView.prototype.renderAnnotationImages.call(view, ['missing']);
	assert.deepEqual(view._pendingAnnotationImageIDs, ['missing']);
	await PDFView.prototype._init2.call(view);
	assert.deepEqual(delivered, [{ id: 'missing', image: '' }]);
	assert.equal(view._pendingAnnotationImageIDs, null);
	assert.equal(eventHandlers[0][0], 'updateviewarea');
});
