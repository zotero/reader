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
		if (specifier.endsWith('dom/epub/epub-view') || specifier.endsWith('dom/snapshot/snapshot-view')) {
			return nextResolve('data:text/javascript,export default class {};', context);
		}
		if (specifier.endsWith('common/sdt/position-mapper') || specifier.endsWith('./sdt/position-mapper')) {
			return nextResolve('data:text/javascript,export let getTextNodeSpans = () => [];', context);
		}
		if (specifier.endsWith('common/read-aloud/sdt-segments') || specifier.endsWith('./read-aloud/sdt-segments')) {
			return nextResolve('data:text/javascript,export let buildSDTReadAloudSegments = () => []; export let getSDTLang = () => null;', context);
		}
		let error;
		for (let candidate of [specifier, specifier + '.js', specifier + '.mjs']) {
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
