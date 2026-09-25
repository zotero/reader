/* global globalThis */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

let pdfViewSource = `
export default class FakePDFView {
	constructor(options) {
		this.options = options;
		this.calls = [];
		this.initializedPromise = Promise.resolve(true);
		globalThis.__mobilePDFView = this;
	}
	setAnnotations(value) { this.calls.push(['setAnnotations', value]); }
	setSelectedAnnotationIDs(value) { this.calls.push(['setSelectedAnnotationIDs', value]); }
	setOutline(value) { this.calls.push(['setOutline', value]); }
	setScrollMode(value) { this.calls.push(['setScrollMode', value]); }
	renderThumbnails(pageIndexes, options) { this.calls.push(['renderThumbnails', pageIndexes, options]); }
	enterPassword(value) {
		this.calls.push(['enterPassword', value]);
		return globalThis.__mobilePasswordAccepted !== false;
	}
}
`;

let sdtViewSource = `
export default class FakeSDTView {
	constructor(options) {
		this.options = options;
		this.calls = [];
		this.initializedPromise = Promise.resolve(globalThis.__mobileSDTViewInitialized ?? true);
		globalThis.__mobileSDTView = this;
	}
	setAnnotations(value) { this.calls.push(['setAnnotations', value]); }
	setTool(value) { this.calls.push(['setTool', value]); }
	setOutline(value) { this.calls.push(['setOutline', value]); }
	destroy() { this.calls.push(['destroy']); }
}
`;

let annotationManagerSource = `
export default class FakeAnnotationManager {
	constructor(options) {
		this.options = options;
		this.calls = [];
		this._annotations = options.annotations || [];
		globalThis.__mobileAnnotationManager = this;
	}
}
`;

let sdtDocumentSessionSource = `
export class SDTDocumentSession {
	constructor(options) {
		this.options = options;
		this.pack = null;
		globalThis.__mobileSDTDocumentSession = this;
	}
	setPack(pack) { this.pack = pack; }
	getDocument() { return Promise.resolve(globalThis.__mobileSDTDocument ?? null); }
}
`;

function dataModule(source) {
	return 'data:text/javascript,' + encodeURIComponent(source);
}

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('pdf/pdf-view')) {
			return nextResolve(dataModule(pdfViewSource), context);
		}
		if (specifier.endsWith('common/annotation-manager') || specifier.endsWith('./annotation-manager')) {
			return nextResolve(dataModule(annotationManagerSource), context);
		}
		if (specifier.endsWith('common/sdt/document-session.mjs')
				|| specifier.endsWith('./sdt/document-session.mjs')) {
			return nextResolve(dataModule(sdtDocumentSessionSource), context);
		}
		if (specifier.endsWith('dom/sdt/sdt-view')) {
			return nextResolve(dataModule(sdtViewSource), context);
		}
		if (specifier.endsWith('dom/epub/epub-view')
				|| specifier.endsWith('dom/snapshot/snapshot-view')) {
			return nextResolve('data:text/javascript,export default class {};', context);
		}
		if (specifier.endsWith('common/sdt/position-mapper') || specifier.endsWith('./sdt/position-mapper')) {
			return nextResolve(dataModule(`
				export let getTextNodeSpans = () => [];
				export let getBlockNodeByRef = (content, ref) => content[ref[0]] ?? null;
			`), context);
		}
		if (specifier.endsWith('common/read-aloud/sdt-segments') || specifier.endsWith('./read-aloud/sdt-segments')) {
			return nextResolve('data:text/javascript,export let buildSDTReadAloudSegments = () => []; export let getSDTLang = () => null;', context);
		}
		let error;
		for (let candidate of [specifier, specifier + '.js', specifier + '.mjs', specifier + '.ts']) {
			try {
				let resolved = nextResolve(candidate, context);
				return resolved.url.endsWith('.ts') ? { ...resolved, format: 'module-typescript' } : resolved;
			}
			catch (e) {
				error ||= e;
			}
		}
		throw error;
	},
});

globalThis.window = {
	HTMLElement: function HTMLElement() {},
	getComputedStyle: () => ({
		getPropertyValue(name) {
			return {
				'font-family': 'Mobile Sans',
				'--color-focus-border': '#00f',
				'--width-focus-border': '2px',
			}[name];
		},
	}),
};
globalThis.document = { body: {} };

const { default: View } = await import('../../src/common/view.js');

function createMobileView(overrides = {}) {
	let callbacks = {
		onInitialized() {},
		onSaveAnnotations() {},
		onDeleteAnnotations() {},
		onChangeViewState() {},
		onChangeViewStats() {},
		onFindResult() {},
		onSetOutline() {},
		onRequestPassword() {},
		onSetPageLabels() {},
		onRenderThumbnail() {},
		onRenderAnnotationImage() {},
	};
	let view = new View({
		type: 'pdf',
		platform: 'android',
		annotations: [],
		container: {},
		data: { url: 'https://example.com/document.pdf' },
		...callbacks,
		...overrides,
	});
	return {
		annotationManager: globalThis.__mobileAnnotationManager,
		pdfView: globalThis.__mobilePDFView,
		sdtDocumentSession: globalThis.__mobileSDTDocumentSession,
		view,
	};
}

test('mobile View wires Android PDF integration and immediate annotation saving', () => {
	let onDeleteAnnotations = () => {};
	let outlines = [];
	let { annotationManager, pdfView, sdtDocumentSession, view } = createMobileView({
		onDeleteAnnotations,
		onSetOutline: outline => outlines.push(outline),
		colorScheme: 'dark',
	});

	assert.equal(pdfView.options.mobile, true);
	assert.equal(pdfView.options.primary, true);
	assert.equal(pdfView.options.platform, 'android');
	assert.equal(pdfView.options.colorScheme, 'dark');
	assert.equal(pdfView.options.createSDTIntegration, undefined);
	assert.equal(sdtDocumentSession.options.documentType, 'pdf');
	assert.equal(sdtDocumentSession.options.retainReader, false);
	assert.equal(annotationManager.options.saveNewAnnotationsImmediately, true);
	assert.equal(annotationManager.options.onDelete, onDeleteAnnotations);
	assert.equal(window.computedFontFamily, 'Mobile Sans');
	assert.equal(window.computedColorFocusBorder, '#00f');
	assert.equal(window.computedWidthFocusBorder, '2px');
	pdfView.options.onSetOutline([{ title: 'Section' }]);
	view.setScrollMode(2);
	view.renderThumbnails([1, 2], { maxWidth: 80, maxHeight: 64 });
	assert.deepEqual(outlines, [[{ title: 'Section' }]]);
	assert.deepEqual(pdfView.calls, [
		['setOutline', [{ title: 'Section' }]],
		['setScrollMode', 2],
		['renderThumbnails', [1, 2], { maxWidth: 80, maxHeight: 64 }],
	]);
});

test('mobile View stores SDT packs in its shared document session', async () => {
	let { sdtDocumentSession, view } = createMobileView();
	let pack = { bytes: new Uint8Array([1]), packVersion: 1, schemaMajorVersion: 1 };
	let document = { structure: {}, mapper: {} };
	globalThis.__mobileSDTDocument = document;
	view.setSDTPack(pack);
	assert.equal(sdtDocumentSession.pack, pack);
	assert.equal(await view._loadSDT(), document);
});

test('mobile View recreates a password-protected PDF when no active request can resume', () => {
	globalThis.__mobilePasswordAccepted = false;
	let replacements = 0;
	let annotation = { id: 'A', type: 'highlight' };
	let { pdfView: initialPDFView, view } = createMobileView({
		annotations: [annotation],
		selectedAnnotationIDs: ['A'],
		container: { replaceChildren: () => replacements++ },
	});
	view.enterPassword('replacement');
	let replacementPDFView = globalThis.__mobilePDFView;
	assert.notEqual(replacementPDFView, initialPDFView);
	assert.equal(replacements, 1);
	assert.deepEqual(initialPDFView.calls, [['enterPassword', 'replacement']]);
	assert.equal(replacementPDFView.options.password, 'replacement');
	assert.deepEqual(replacementPDFView.calls, [
		['setAnnotations', [annotation]],
		['setSelectedAnnotationIDs', ['A']],
	]);
	globalThis.__mobilePasswordAccepted = true;
});

function createStandaloneView(overrides = {}) {
	globalThis.__mobileSDTView = null;
	let { view, ...rest } = createMobileView({
		type: 'sdt',
		sourceType: 'pdf',
		data: undefined,
		...overrides,
	});
	return { ...rest, view };
}

function createStandaloneSDT() {
	return {
		structure: {
			content: [
				{ type: 'paragraph' },
				{ type: 'image', anchor: { pageRects: [[1, 100, 200, 300, 400]] } },
			],
			catalog: {
				outline: [],
				pages: [
					{ label: 'i', viewRect: [0, 0, 612, 792], contentRange: [[0], [1]] },
					{ viewRect: [0, 0, 612, 792], contentRange: [[1], [2]] },
				],
			},
		},
		mapper: {
			getSortIndex: position => `sortIndex-${position.pageIndex}`,
		},
	};
}

test('standalone Reading Mode requires a supported source type', () => {
	assert.throws(() => createStandaloneView({ sourceType: 'snapshot' }), /not supported for 'snapshot'/);
});

test('standalone Reading Mode creates its view once the SDT pack is set', async () => {
	let initialized = 0;
	let annotations = [
		{ id: 'H', type: 'highlight' },
		{ id: 'I', type: 'ink' },
		{ id: 'N', type: 'note' },
	];
	let { sdtDocumentSession, view } = createStandaloneView({
		annotations,
		tool: { type: 'ink', color: '#f00' },
		onInitialized: () => initialized++,
		// Skip the empty text annotation cleanup, which the fake manager lacks
		onDeleteAnnotations: undefined,
	});
	assert.equal(sdtDocumentSession.options.documentType, 'pdf');
	assert.equal(globalThis.__mobileSDTView, null);
	// Calls before the view exists are safe
	view.setTool({ type: 'underline' });
	view.selectAnnotations(['H']);

	globalThis.__mobileSDTDocument = createStandaloneSDT();
	view.setSDTPack({ bytes: new Uint8Array([1]), packVersion: 1, schemaMajorVersion: 1 });
	await view._standaloneQueue;

	let sdtView = globalThis.__mobileSDTView;
	assert.equal(view._view, sdtView);
	assert.equal(initialized, 1);
	assert.equal(sdtView.options.data.paged, true);
	assert.deepEqual(sdtView.options.tool, { type: 'underline' });
	assert.deepEqual(sdtView.options.selectedAnnotationIDs, ['H']);
	assert.deepEqual(sdtView.options.annotations.map(x => x.id), ['H', 'N']);
	// Only text annotation tools work in Reading Mode
	view.setTool({ type: 'ink', color: '#f00' });
	assert.deepEqual(sdtView.calls.at(-1), ['setTool', { type: 'pointer' }]);
});

test('standalone Reading Mode derives annotation metadata and page stats from the SDT', async () => {
	let stats = [];
	let { view } = createStandaloneView({
		pageLabels: [],
		onChangeViewStats: value => stats.push(value),
	});
	globalThis.__mobileSDTDocument = createStandaloneSDT();
	view.setSDTPack({ bytes: new Uint8Array([1]), packVersion: 1, schemaMajorVersion: 1 });
	await view._standaloneQueue;
	let { data, onChangeViewStats } = globalThis.__mobileSDTView.options;

	assert.deepEqual(
		data.getSourceAnnotationMeta({ pageIndex: 0, rects: [[0, 0, 1, 1]] }),
		{ sortIndex: 'sortIndex-0', pageLabel: 'i' }
	);
	// App-provided page labels take precedence, and pages without one are numbered
	view.setPageLabels(['A']);
	assert.equal(data.getSourceAnnotationMeta({ pageIndex: 0, rects: [] }).pageLabel, 'A');
	assert.equal(data.getSourceAnnotationMeta({ pageIndex: 1, rects: [] }).pageLabel, '2');

	onChangeViewStats({ canZoomIn: true });
	data.syncBaseView(1);
	await new Promise(resolve => setTimeout(resolve, 150));
	assert.deepEqual(stats.at(-1), { canZoomIn: true, pageIndex: 1, pageLabel: '2', pagesCount: 2 });
});

test('standalone Reading Mode requests figure crops from the app', async () => {
	let requests = [];
	let { view } = createStandaloneView({
		onRequestPageRegionImages: request => requests.push(request),
	});
	globalThis.__mobileSDTDocument = createStandaloneSDT();
	view.setSDTPack({ bytes: new Uint8Array([1]), packVersion: 1, schemaMajorVersion: 1 });
	await view._standaloneQueue;

	let [crop] = globalThis.__mobileSDTView.options.data.getBlockCrops([1]);
	let image = crop.render();
	assert.equal(requests.length, 1);
	assert.equal(requests[0].pageIndex, 1);
	assert.deepEqual(requests[0].rects, [[100, 200, 300, 400]]);
	assert.ok(requests[0].scale > 0);
	view.setPageRegionImages(requests[0].requestID, ['data:image/png;base64,AAAA']);
	assert.equal(await image, 'data:image/png;base64,AAAA');
});

test('standalone Reading Mode reports when the SDT is unavailable', async () => {
	let failed = 0;
	let initialized = 0;
	let { view } = createStandaloneView({
		onInitialized: () => initialized++,
		onInitializeFailed: () => failed++,
	});
	globalThis.__mobileSDTDocument = null;
	view.setSDTPack({ bytes: new Uint8Array([1]), packVersion: 1, schemaMajorVersion: 1 });
	await view._standaloneQueue;
	assert.equal(view._view, null);
	assert.equal(failed, 1);
	assert.equal(initialized, 0);
});
