import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
				for (let extension of ['.js', '.mjs', '.ts']) {
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
		if (resolved.url.startsWith(PROJECT_ROOT) && resolved.url.endsWith('.ts')) {
			return { ...resolved, format: 'module-typescript' };
		}
		if (resolved.url.startsWith(PROJECT_ROOT) && /\.m?js$/.test(resolved.url)) {
			return { ...resolved, format: 'module' };
		}
		return resolved;
	},
});

const [
	{ PDFPositionMapper },
	{ getTextNodeSpans },
] = await Promise.all([
	import('../../src/common/sdt/pdf-position-mapper.ts'),
	import('../../src/common/sdt/position-mapper.ts'),
]);
moduleHooks.deregister();

function readFixture() {
	return JSON.parse(readFileSync(
		new URL('../../structured-document-text/test/fixtures/pdf/1.json', import.meta.url)
	));
}

test('maps valid PDF positions and rejects unrepresentable ranges', () => {
	let structure = readFixture();
	let length = structure.content[0].content[0].text.length;
	let sdtPosition = {
		start: [0, 0, 0],
		end: [0, 0, length],
	};
	let mapper = new PDFPositionMapper(structure);
	let sourcePosition = mapper.sdtToSourcePosition(sdtPosition);
	assert.ok(sourcePosition);
	assert.deepEqual(mapper.sourceToSDTPosition(sourcePosition), sdtPosition);
	assert.deepEqual(mapCompletePDFRange([0, 1]), {
		pageIndex: 0,
		rects: [[0, 0, 10, 10]],
		nextPageRects: [[0, 0, 10, 10]],
	});
	assert.equal(mapCompletePDFRange([0, 1, 2]), null);
	assert.equal(mapCompletePDFRange([0, 2]), null);
});

function createPDFStructure(pageIndexes) {
	let pageCount = Math.max(...pageIndexes) + 1;
	return {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
				viewRect: [0, 0, 100, 100],
				contentRange: [
					[Math.min(pageIndex, pageIndexes.length - 1)],
					[Math.min(pageIndex + 1, pageIndexes.length)],
				],
			})),
		},
		content: pageIndexes.map(pageIndex => ({
			type: 'paragraph',
			content: [{
				text: 'x',
				anchor: { pageRects: [[pageIndex, 0, 0, 10, 10]] },
			}],
		})),
	};
}

function mapCompletePDFRange(pageIndexes) {
	let mapper = new PDFPositionMapper(createPDFStructure(pageIndexes));
	return mapper.sdtToSourcePosition({
		start: [0, 0, 0],
		end: [pageIndexes.length - 1, 0, 1],
	});
}

test('does not use block geometry for unanchored whitespace', () => {
	let structure = {
		metadata: { processor: { type: 'pdf' } },
		catalog: {
			pages: [{
				viewRect: [0, 0, 100, 100],
				contentRange: [[0], [1]],
			}],
		},
		content: [{
			type: 'paragraph',
			anchor: { pageRects: [[0, 0, 0, 10, 10]] },
			content: [{ text: '   ' }],
		}],
	};
	let spans = getTextNodeSpans(structure, {
		start: [0, 0, 0],
		end: [0, 0, 3],
	});
	assert.equal(new PDFPositionMapper(structure).textNodeSpansToSourcePosition(spans), null);
});

test('bounds and clears expanded PDF run-data caches', () => {
	let structure = createPDFStructure([0, 0, 0]);
	let mapper = new PDFPositionMapper(structure, {
		maxRunDataCacheWeight: 2,
	});
	for (let blockIndex = 0; blockIndex < structure.content.length; blockIndex++) {
		let spans = getTextNodeSpans(structure, {
			start: [blockIndex, 0, 0],
			end: [blockIndex, 0, 1],
		});
		assert.ok(mapper.textNodeSpansToSourcePosition(spans));
	}

	assert.equal(mapper._runDataCache.size, 2);
	assert.equal(mapper._runDataCacheWeight, 2);
	mapper.clearCache();
	assert.equal(mapper._runDataCache.size, 0);
	assert.equal(mapper._runDataCacheWeight, 0);
});
