import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
			if (!resolved) throw error;
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
const { PDFSDTIntegration } = await import('../../src/pdf/sdt-integration.mjs');
const { PDFSearchController } = await import('../../src/pdf/pdf-search-controller.mjs');
moduleHooks.deregister();

function deferred() {
	let resolve;
	let promise = new Promise(res => resolve = res);
	return { promise, resolve };
}

function createReader() {
	return {
		header: { schemaVersion: '1.0.0' },
		getMetadata: async () => ({ processor: { type: 'pdf' } }),
		getCatalog: async () => ({
			pages: [{
				label: '1',
				viewRect: [0, 0, 100, 100],
				rotation: 0,
				userUnit: 1,
				contentRange: [[0], [1]],
			}],
			outline: [],
		}),
		getTopLevelBlockCount: () => 1,
	};
}

function createIntegration(firstPageReadyPromise, loadReader, {
	getLoadedDocument = () => null,
	validation,
} = {}) {
	let documentData = {
		firstPageReadyPromise,
		getValidation: () => validation,
		setSemanticDocument(document) {
			this.document = document;
		},
	};
	let search = { setEligibleSDT() {} };
	let session = {
		getReader: loadReader,
		getLoadedDocument,
	};
	return {
		documentData,
		integration: new PDFSDTIntegration({
			session,
			documentData,
			search,
		}),
	};
}

test('each PDF view opens its own lazy document after its first page is ready', async () => {
	let firstPage = deferred();
	let reader = createReader();
	let loads = 0;
	let loadReader = async () => {
		loads++;
		return reader;
	};
	let first = createIntegration(firstPage.promise, loadReader);
	let firstResult = first.integration.start();
	await Promise.resolve();
	assert.equal(loads, 0);

	let validation = { pageCount: 1, pages: [] };
	firstPage.resolve(validation);
	let firstDocument = await firstResult;
	let second = createIntegration(Promise.resolve(validation), loadReader);
	let secondDocument = await second.integration.start();

	assert.equal(first.documentData.document, firstDocument);
	assert.equal(second.documentData.document, secondDocument);
	assert.notEqual(firstDocument, secondDocument);
	assert.equal(loads, 2);
});

test('retries when the shared reader was temporarily unavailable', async () => {
	let reader = null;
	let owner = createIntegration(
		Promise.resolve({ pageCount: 1, pages: [] }),
		async () => reader
	);
	assert.equal(await owner.integration.start(), null);

	reader = createReader();
	assert.ok(await owner.integration.start());
});

test('does not retry document or search data that failed validation', async (t) => {
	t.mock.method(console, 'warn', () => {});
	let documentLoads = 0;
	let invalidDocument = createIntegration(
		Promise.resolve({ pageCount: 2, pages: [] }),
		async () => {
			documentLoads++;
			return createReader();
		}
	);
	assert.equal(await invalidDocument.integration.start(), null);
	assert.equal(await invalidDocument.integration.start(), null);
	assert.equal(documentLoads, 1);

	let searchLoads = 0;
	let validation = { pageCount: 1, pages: [] };
	let invalidSearch = createIntegration(
		Promise.resolve(validation),
		async () => createReader(),
		{
			validation,
			getLoadedDocument: () => {
				searchLoads++;
				return {
					structure: {
						metadata: { processor: { type: 'pdf' } },
						catalog: { pages: [] },
						content: [],
					},
				};
			},
		}
	);
	assert.equal(await invalidSearch.integration.prepareSearch(), null);
	invalidSearch.integration.trimMemory();
	assert.equal(await invalidSearch.integration.prepareSearch(), null);
	assert.equal(searchLoads, 1);
});

test('skips SDT search results that cannot be represented as PDF positions', () => {
	let controller = new PDFSearchController({ initialState: {} });
	let sdt = {
		mapper: {
			textNodeSpansToSourcePosition: () => null,
		},
	};
	controller.setEligibleSDT(sdt);
	let session = controller._sessions.transition({
		active: true,
		query: 'needle',
	}).session;

	assert.equal(controller._mapSDTResult(
		session,
		new AbortController(),
		{ spans: [] }
	), null);
});

test('publishes the inactive state when a PDF search closes', () => {
	let inactive = {
		active: false,
		query: '',
		caseSensitive: false,
		entireWord: false,
		highlightAll: true,
		result: null,
	};
	let active = { ...inactive, active: true, query: 'term' };
	let states = [];
	let controller = new PDFSearchController({
		initialState: inactive,
		pages: [],
		onState: state => states.push(state),
	});

	controller.setState(active);
	assert.equal(controller.state, active);
	controller.setState(inactive);

	assert.equal(controller.state, inactive);
	assert.deepEqual(states, [inactive]);
});
