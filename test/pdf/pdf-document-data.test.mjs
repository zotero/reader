import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocumentData } from '../../src/pdf/pdf-document-data.mjs';

function createPDF() {
	let pdfDocument = {
		numPages: 1,
		getPageLabels: async () => ['i'],
		getPageData: async () => ({ chars: [], viewBox: [0, 0, 100, 100] }),
		getOutline: async () => [],
	};
	let pdfPage = {
		view: [0, 0, 100, 100],
		rotate: 0,
		userUnit: 1,
		getAnnotations: async () => [{ rect: [0, 0, 10, 10], url: 'https://example.com' }],
	};
	return { pdfDocument, pdfPage };
}

async function createDocumentData(options = {}) {
	let { pdfDocument, pdfPage } = createPDF();
	let data = new PDFDocumentData({
		resolveDestination: async () => null,
		...options,
	});
	data.setDocument(pdfDocument);
	data.registerPage(0, pdfPage);
	await data.ensurePage(0, pdfPage);
	return data;
}

test('keeps the native PDF page usable without semantic data', async () => {
	let metadata = [];
	let data = await createDocumentData({ onMetadata: value => metadata.push(value) });
	await Promise.resolve();

	assert.deepEqual(data.pages[0].viewBox, [0, 0, 100, 100]);
	assert.equal(data.pages[0].overlays[0].url, 'https://example.com');
	assert.equal(Object.hasOwn(data.pages[0], 'semanticFlowRevision'), false);
	assert.deepEqual(metadata.at(-1).pageLabels, ['i']);

	let resolveOutline;
	let outlinePromise = new Promise(resolve => resolveOutline = resolve);
	let outlineData = new PDFDocumentData({
		onMetadata: value => value.outline && resolveOutline(value.outline),
	});
	outlineData.setOutlineActive(true);
	outlineData.setDocument({
		numPages: 1,
		getPageLabels: async () => ['1'],
		getOutline: async () => [{
			title: 'Website',
			items: [],
			url: null,
			unsafeUrl: '../chapter.pdf#intro',
		}],
	});

	assert.deepEqual(await outlinePromise, [{
		title: 'Website',
		items: [],
		url: '../chapter.pdf#intro',
	}]);
});

test('owns semantic page projection independently for each PDF view', async () => {
	let projections = 0;
	let semanticDocument = {
		pageCount: 1,
		pageLabels: ['1'],
		outline: [],
		composePage(pageData, semanticPage) {
			return {
				...pageData,
				overlays: [...semanticPage.overlays, ...pageData.overlays],
				semanticFlowRevision: 1,
			};
		},
		async projectPage(pageIndex) {
			projections++;
			return {
				pageIndex,
				overlays: [{ type: 'citation', position: { pageIndex, rects: [[1, 1, 2, 2]] } }],
				textFlowRects: {},
			};
		},
	};
	let first = await createDocumentData();
	let second = await createDocumentData();

	first.setSemanticDocument(semanticDocument);
	second.setSemanticDocument(semanticDocument);
	await Promise.all([
		first.ensureSemanticPage(0),
		second.ensureSemanticPage(0),
	]);

	assert.equal(projections, 2);
	assert.equal(first.pages[0].overlays[0].type, 'citation');
	assert.equal(second.pages[0].overlays[0].type, 'citation');
	first.releasePage(0);
	assert.ok(second.pages[0]);
});
