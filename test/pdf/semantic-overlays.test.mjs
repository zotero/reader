import assert from 'node:assert/strict';
import test from 'node:test';

import { charsToTextNodes } from '../../structured-document-text/src/pdf/encode.js';
import {
	buildAnnotationLinkOverlays,
	loadPDFPageSources,
} from '../../src/pdf/pdf-page-data.mjs';
import {
	applyTextFlowClasses,
	composePDFPageOverlays,
	LazyPDFSDTDocument,
	validatePDFSDTDocument,
} from '../../src/pdf/semantic-overlays.mjs';

const UNSAFE_URL = ['java', 'script:alert(1)'].join('');

function deferred() {
	let resolve;
	let promise = new Promise(res => resolve = res);
	return { promise, resolve };
}

function createReaderIndex(blockCount) {
	return {
		chunkBlockStarts: blockCount ? [0, blockCount] : [0],
	};
}

function createMapper() {
	return {
		textNodeSpansToSourcePosition(spans) {
			let pageRects = spans.flatMap(span => span.node.anchor?.pageRects || []);
			if (!pageRects.length) {
				return null;
			}
			let pageIndexes = [...new Set(pageRects.map(rect => rect[0]))].sort((a, b) => a - b);
			if (pageIndexes.length > 2
					|| (pageIndexes.length === 2 && pageIndexes[1] !== pageIndexes[0] + 1)) {
				return null;
			}
			let position = {
				pageIndex: pageIndexes[0],
				rects: pageRects
					.filter(rect => rect[0] === pageIndexes[0])
					.map(rect => rect.slice(1)),
			};
			if (pageIndexes[1] === pageIndexes[0] + 1) {
				position.nextPageRects = pageRects
					.filter(rect => rect[0] === pageIndexes[1])
					.map(rect => rect.slice(1));
			}
			return position;
		},
	};
}

async function openStructureDocument(structure, expectedDocument, options = {}) {
	let content = structure.content;
	let catalog = {
		...structure.catalog,
		pages: structure.catalog.pages.map(page => (page.contentRange
			? page
			: { ...page, contentRange: [[0], [content.length]] })),
	};
	let reader = {
		header: { schemaVersion: structure.schemaVersion ?? '1.0.0' },
		index: createReaderIndex(content.length),
		getTopLevelBlockCount: () => content.length,
		getMetadata: async () => structure.metadata,
		getCatalog: async () => catalog,
		getBlocks: async (start, end) => content.slice(start, end + 1),
		getBlock: async ref => content[ref[0]],
	};
	expectedDocument ??= { pageCount: catalog.pages.length, pages: [] };
	return LazyPDFSDTDocument.open(reader, expectedDocument, {
		createMapper,
		...options,
	});
}

async function projectStructurePage(
	structure,
	pageIndex = 0,
	expectedDocument,
	options = {}
) {
	expectedDocument ??= {
		pageCount: structure.catalog.pages.length,
		pages: [],
	};
	let document = await openStructureDocument(structure, expectedDocument, options);
	let page = await document.projectPage(pageIndex, expectedDocument, options);
	return { document, page };
}

test('keeps native PDF link annotations independent from structured page data', async () => {
	let overlays = await buildAnnotationLinkOverlays([
		{ rect: [0, 0, 10, 10], url: 'https://example.com' },
		{ rect: [10, 0, 20, 10], unsafeUrl: UNSAFE_URL },
		{ rect: [20, 0, 30, 10], dest: 'chapter-1' },
		{ rect: [40, 0, 40, 10], url: 'https://invalid.example' },
		{ rect: [50, 0, 60, 10], dest: 'missing' },
		{
			rect: [70, 0, 100, 10],
			quadPoints: new Float32Array([
				70,
				10,
				80,
				10,
				70,
				0,
				80,
				0,
				90,
				10,
				100,
				10,
				90,
				0,
				100,
				0,
			]),
			url: 'https://quad.example',
		},
	], 2, async (dest) => {
		return dest === 'chapter-1'
			? { pageIndex: 4, rects: [[1, 2, 1, 2]] }
			: null;
	});

	assert.deepEqual(overlays, [
		{
			type: 'external-link',
			source: 'annotation',
			url: 'https://example.com',
			position: { pageIndex: 2, rects: [[0, 0, 10, 10]] },
		},
		{
			type: 'internal-link',
			source: 'annotation',
			destinationPosition: { pageIndex: 4, rects: [[1, 2, 1, 2]] },
			position: { pageIndex: 2, rects: [[20, 0, 30, 10]] },
		},
		{
			type: 'external-link',
			source: 'annotation',
			url: 'https://quad.example',
			position: {
				pageIndex: 2,
				rects: [[70, 0, 80, 10], [90, 0, 100, 10]],
			},
		},
	]);

	let pageData = deferred();
	let annotations = [{ rect: [0, 0, 10, 10], url: 'https://example.com' }];
	let sources = loadPDFPageSources({
		getPageData: () => pageData.promise,
	}, {
		getAnnotations: () => annotations,
	}, 0);
	assert.deepEqual(await sources.annotations, {
		status: 'fulfilled',
		value: annotations,
	});
	pageData.resolve({ chars: [] });
	assert.deepEqual(await sources.pageData, {
		status: 'fulfilled',
		value: { chars: [] },
	});

	let throwing = loadPDFPageSources({
		getPageData() {
			throw new Error('unsupported');
		},
	}, {
		getAnnotations: () => annotations,
	}, 0);
	assert.equal((await throwing.pageData).status, 'rejected');
	assert.deepEqual(await throwing.annotations, {
		status: 'fulfilled',
		value: annotations,
	});
});

test('preserves native PDF links alongside overlapping semantic links', () => {
	let semanticOverlay = {
		type: 'external-link',
		source: 'sdt',
		url: 'https://semantic.example',
		position: { pageIndex: 0, rects: [[0, 0, 10, 10]] },
	};
	let fallbackOverlay = {
		type: 'external-link',
		source: 'annotation',
		url: 'https://native.example',
		position: { pageIndex: 0, rects: [[5, 5, 15, 15]] },
	};
	assert.deepEqual(
		composePDFPageOverlays([fallbackOverlay], [semanticOverlay]),
		[semanticOverlay, fallbackOverlay]
	);
});

test('opens PDF SDT metadata without materializing content and reads only a requested page', async () => {
	let content = [
		{
			type: 'paragraph',
			content: [{
				text: 'Page one',
				target: { url: 'https://example.com' },
				anchor: { pageRects: [[0, 0, 0, 10, 10]] },
			}],
		},
		{
			type: 'paragraph',
			content: [{
				text: 'Page two',
				anchor: { pageRects: [[1, 0, 0, 10, 10]] },
			}],
		},
	];
	let blockReads = [];
	let reader = {
		header: { schemaVersion: '1.0.0' },
		index: createReaderIndex(content.length),
		getTopLevelBlockCount: () => content.length,
		getMetadata: async () => ({
			processor: { type: 'pdf' },
			source: { contentType: 'application/pdf', hash: '0'.repeat(32) },
		}),
		getCatalog: async () => ({
			pages: [
				{ viewRect: [0, 0, 100, 100], textSource: 'ocr', contentRange: [[0], [1]] },
				{ viewRect: [0, 0, 100, 100], contentRange: [[1], [2]] },
			],
			outline: [{ title: 'Second page', ref: [1] }],
		}),
		async getBlocks(start, end) {
			blockReads.push([start, end]);
			return content.slice(start, end + 1);
		},
		materialize() {
			throw new Error('must stay lazy');
		},
	};
	let validation = {
		pageCount: 2,
		pages: [{
			pageIndex: 0,
			viewRect: [0, 0, 100, 100],
			rotation: 0,
			userUnit: 1,
		}],
	};

	let document = await LazyPDFSDTDocument.open(reader, validation, {
		createMapper,
	});
	assert.deepEqual(blockReads, []);
	assert.deepEqual(document.pageLabels, ['1', '2']);
	assert.equal(document.outline[0].location.position.pageIndex, 1);

	let page = await document.projectPage(0, validation);
	assert.deepEqual(blockReads, [[0, 0]]);
	assert.equal(page.pageIndex, 0);
	assert.equal(page.overlays[0].url, 'https://example.com');

	let resolvedOutline = await document.resolveOutline();
	assert.deepEqual(blockReads, [[0, 0], [1, 1]]);
	assert.deepEqual(
		resolvedOutline[0].location.position.rects,
		[[0, 0, 10, 10]]
	);
});

test('leaves an incomplete citation to the native PDF fallback', async () => {
	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [{
				viewRect: [0, 0, 100, 100],
				contentRange: [[0], [2]],
			}],
			outline: [],
		},
		content: [
			{
				type: 'paragraph',
				content: [{
					text: '[1, ?]',
					refs: [[1], [9]],
					anchor: { pageRects: [[0, 0, 0, 20, 10]] },
				}],
			},
			{
				type: 'paragraph',
				reference: true,
				content: [{
					text: 'Reference',
					anchor: { pageRects: [[0, 0, 20, 40, 30]] },
				}],
			},
		],
	};

	let { page } = await projectStructurePage(structure);
	assert.deepEqual(page.overlays, []);
});

test('prunes valid nested page ranges and rejects invalid ones', async () => {
	let outsidePage = () => {
		let child = { type: 'paragraph' };
		Object.defineProperty(child, 'content', {
			get() {
				throw new Error('walked outside the requested page range');
			},
		});
		return child;
	};
	let visible = {
		type: 'paragraph',
		content: [{
			text: 'Visible page',
			anchor: {
				pageRects: [[0, 0, 0, 50, 10]],
			},
		}],
	};
	let content = [{
		type: 'list',
		flowClass: 'auxiliary',
		content: [outsidePage(), visible, outsidePage()],
	}];
	let catalogPage = {
		viewRect: [0, 0, 100, 100],
		contentRange: [[0, 1], [0, 2]],
	};
	let reader = {
		header: { schemaVersion: '1.0.0' },
		index: createReaderIndex(content.length),
		getTopLevelBlockCount: () => content.length,
		getMetadata: async () => ({ processor: { type: 'pdf' } }),
		getCatalog: async () => ({
			pages: [catalogPage],
			outline: [],
		}),
		async getBlocks(start, end) {
			return content.slice(start, end + 1);
		},
	};
	let validation = {
		pageCount: 1,
		pages: [{
			pageIndex: 0,
			viewRect: [0, 0, 100, 100],
			rotation: 0,
			userUnit: 1,
		}],
	};
	let document = await LazyPDFSDTDocument.open(reader, validation, {
		createMapper,
	});
	let page = await document.projectPage(0, validation);
	assert.deepEqual(page.textFlowRects, {});

	catalogPage.contentRange = [[1], [0]];
	await assert.rejects(
		document.projectPage(0, validation),
		/Invalid SDT page content range/
	);

	catalogPage.contentRange = [[0], [0]];
	let emptyPage = await document.projectPage(0, validation);
	assert.deepEqual(emptyPage.overlays, []);
	assert.deepEqual(emptyPage.textFlowRects, {});
});

test('targeted projection does not fall back to cross-page block geometry', async () => {
	let [firstText] = charsToTextNodes(0, [{
		c: 'A',
		rect: [0, 0, 10, 10],
		axisDir: 0,
	}]);
	let [secondText] = charsToTextNodes(1, [{
		c: 'B',
		rect: [20, 20, 30, 30],
		axisDir: 0,
	}]);
	let block = {
		type: 'paragraph',
		flowClass: 'auxiliary',
		anchor: {
			pageRects: [
				[0, 0, 0, 50, 50],
				[1, 0, 0, 50, 50],
			],
		},
		content: [firstText, secondText],
	};
	let coarseBlock = {
		type: 'paragraph',
		flowClass: 'auxiliary',
		anchor: { pageRects: [[0, 60, 60, 80, 80]] },
		content: [{ text: 'Unanchored' }],
	};
	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [
				{ viewRect: [0, 0, 100, 100], contentRange: [[0], [2]] },
				{ viewRect: [0, 0, 100, 100], contentRange: [[0], [2]] },
			],
			outline: [],
		},
		content: [block, coarseBlock],
	};
	let expected = { pageCount: 2 };
	let { page } = await projectStructurePage(structure, 0, expected);
	assert.deepEqual(page.textFlowRects, {
		auxiliary: [[0, 0, 10, 10]],
	});
});

test('projects PDF SDT links, citations, and exact text-flow geometry', async () => {
	let [auxiliaryText] = charsToTextNodes(0, [{
		c: 'A',
		rect: [10, 90, 15, 100],
		axisDir: 0,
	}]);
	auxiliaryText.anchor.pageRects = [[0, 10, 90, 15, 100]];
	let [excludedText] = charsToTextNodes(0, [{
		c: 'H',
		rect: [0, 90, 5, 100],
		axisDir: 0,
	}]);
	excludedText.anchor.pageRects = [[0, 0, 90, 5, 100]];

	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [
				{ viewRect: [0, 0, 100, 100], contentRange: [[0], [5]] },
				{ viewRect: [0, 0, 100, 100], contentRange: [[3], [4]] },
			],
			outline: [],
		},
		content: [
			{
				type: 'paragraph',
				anchor: { pageRects: [[0, 0, 70, 40, 80]] },
				content: [
					{
						text: 'Website',
						target: { url: 'https://example.com' },
						anchor: { pageRects: [[0, 0, 70, 20, 80]] },
					},
					{
						text: '[1]',
						refs: [[1]],
						anchor: { pageRects: [[0, 21, 70, 30, 80]] },
					},
					{
						text: 'Figure 1',
						refs: [[2]],
						anchor: { pageRects: [[0, 31, 70, 40, 80]] },
					},
				],
			},
			{
				type: 'paragraph',
				reference: true,
				anchor: { pageRects: [[1, 0, 60, 60, 70]] },
				content: [{
					text: 'Reference entry',
					style: { bold: true },
					anchor: { pageRects: [[1, 0, 60, 60, 70]] },
				}],
			},
			{
				type: 'image',
				anchor: { pageRects: [[1, 10, 10, 50, 50]] },
				content: [{
					text: 'Figure 1',
					anchor: { pageRects: [[1, 10, 10, 50, 50]] },
				}],
			},
			{
				type: 'paragraph',
				flowClass: 'auxiliary',
				anchor: { pageRects: [[0, 10, 90, 15, 100]] },
				content: [auxiliaryText],
			},
			{
				type: 'paragraph',
				flowClass: 'excluded',
				anchor: { pageRects: [[0, 0, 90, 5, 100]] },
				content: [excludedText],
			},
		],
	};

	let { page } = await projectStructurePage(structure);
	assert.equal(page.overlays[0].type, 'external-link');
	assert.equal(page.overlays[1].type, 'citation');
	assert.equal(page.overlays[1].references[0].text, 'Reference entry');
	assert.equal(page.overlays[1].references[0].chars[0].bold, true);
	assert.equal(page.overlays[2].type, 'internal-link');
	assert.equal(page.overlays[2].destinationPosition.pageIndex, 1);
	assert.deepEqual(page.textFlowRects, {
		auxiliary: [[10, 90, 15, 100]],
		excluded: [[0, 90, 5, 100]],
	});
	let classified = applyTextFlowClasses([
		{ c: 'H', rect: [0, 90, 5, 100] },
		{ c: 'A', rect: [10, 90, 15, 100] },
		{ c: 'B', rect: [0, 50, 5, 60], flowClass: 'excluded' },
	], page.textFlowRects);
	assert.equal(classified[0].flowClass, 'excluded');
	assert.equal(classified[1].flowClass, 'auxiliary');
	assert.equal('flowClass' in classified[2], false);
});

test('projects safe targets and rejects unsafe or out-of-range targets', async () => {
	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [
				{ label: 'A-1', viewRect: [0, 0, 100, 100] },
				{ viewRect: [0, 0, 200, 200] },
			],
			outline: [
				{
					title: 'Chapter',
					source: 'native',
					target: { position: { pageIndex: 1, rect: [10, 20, 30, 40] } },
					children: [{
						title: 'Website',
						source: 'detected',
						target: { url: 'HTTPS://example.com' },
					}],
				},
				{
					title: 'Unsafe',
					target: { url: UNSAFE_URL },
				},
			],
		},
		content: [
			{
				type: 'paragraph',
				content: [{
					text: 'Go',
					target: { position: { pageIndex: 1, rect: [10, 20, 30, 40] } },
					anchor: { pageRects: [[0, 1, 2, 8, 10]] },
				}],
			},
			{
				type: 'paragraph',
				content: [{
					text: 'Unsafe',
					target: { url: UNSAFE_URL },
					anchor: { pageRects: [[0, 10, 2, 18, 10]] },
				}],
			},
			{
				type: 'paragraph',
				content: [{
					text: 'Invalid',
					target: { position: { pageIndex: 99 } },
					anchor: { pageRects: [[0, 20, 2, 28, 10]] },
				}],
			},
		],
	};

	let document = await openStructureDocument(structure);
	let page = await document.projectPage(0, { pageCount: 2, pages: [] });
	assert.deepEqual(page.overlays, [{
		type: 'internal-link',
		source: 'sdt',
		destinationPosition: {
			pageIndex: 1,
			rects: [[10, 20, 30, 40]],
		},
		position: {
			pageIndex: 0,
			rects: [[1, 2, 8, 10]],
		},
	}]);
	assert.deepEqual(document.pageLabels, ['A-1', '2']);
	assert.deepEqual(await document.resolveOutline(), [
		{
			title: 'Chapter',
			source: 'native',
			location: {
				position: {
					pageIndex: 1,
					rects: [[10, 20, 30, 40]],
				},
			},
			items: [{
				title: 'Website',
				source: 'detected',
				url: 'HTTPS://example.com',
				items: [],
			}],
		},
		{
			title: 'Unsafe',
			items: [],
		},
	]);
});

test('indexes cross-page SDT interactions on every affected PDF page', async () => {
	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [
				{ viewRect: [0, 0, 100, 100] },
				{ viewRect: [0, 0, 100, 100] },
			],
			outline: [],
		},
		content: [{
			type: 'paragraph',
			anchor: { pageRects: [[0, 0, 0, 20, 10], [1, 0, 90, 20, 100]] },
			content: [{
				text: 'cross-page link',
				target: { url: 'https://example.com' },
				anchor: { pageRects: [[0, 0, 0, 20, 10], [1, 0, 90, 20, 100]] },
			}],
		}],
	};
	let pages = await Promise.all([0, 1].map(async pageIndex => (
		(await projectStructurePage(structure, pageIndex)).page
	)));
	assert.deepEqual(
		pages.map(page => page.overlays[0].position),
		[
			{ pageIndex: 0, rects: [[0, 0, 20, 10]] },
			{ pageIndex: 1, rects: [[0, 90, 20, 100]] },
		]
	);
});

test('yields during projection and honors cancellation', async () => {
	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [{ viewRect: [0, 0, 100, 100] }],
			outline: [],
		},
		content: Array.from({ length: 10 }, (_, index) => ({
			type: 'paragraph',
			content: [{
				text: String(index),
				anchor: { pageRects: [[0, index, 0, index + 1, 1]] },
			}],
		})),
	};
	let abortController = new AbortController();
	let yields = 0;
	await assert.rejects(projectStructurePage(structure, 0, undefined, {
		signal: abortController.signal,
		yieldAfter: 1,
		maxWorkMs: 0,
		yieldControl: async () => {
			yields++;
			abortController.abort();
		},
	}), { name: 'AbortError' });
	assert.equal(yields, 1);
});

test('rejects SDT from another processor, page count, or page geometry', () => {
	let structure = {
		metadata: { processor: { type: 'epub', version: 1 } },
		catalog: { pages: [], outline: [] },
		content: [],
	};
	assert.throws(
		() => validatePDFSDTDocument(structure, { pageCount: 0 }),
		/Expected PDF SDT/
	);

	structure.metadata.processor.type = 'pdf';
	assert.throws(
		() => validatePDFSDTDocument(structure, { pageCount: 1 }),
		/page count/
	);

	structure.catalog.pages = [{
		viewRect: [0, 0, 100, 100],
		contentRange: [[0], [0]],
	}];
	assert.throws(() => validatePDFSDTDocument(structure, {
		pageCount: 1,
		pages: [{
			pageIndex: 0,
			viewRect: [0, 0, 200, 100],
			rotation: 0,
			userUnit: 1,
		}],
	}), /page geometry/);

	structure.schemaVersion = '1.0.0';
	validatePDFSDTDocument(structure, {
		pageCount: 1,
		pages: [{
			pageIndex: 0,
			viewRect: [0, 0, 100, 100],
			rotation: 90,
			userUnit: 2,
		}],
	});
	structure.schemaVersion = '1.1.0';
	assert.throws(() => validatePDFSDTDocument(structure, {
		pageCount: 1,
		pages: [{
			pageIndex: 0,
			viewRect: [0, 0, 100, 100],
			rotation: 90,
			userUnit: 2,
		}],
	}), /page geometry/);
});
