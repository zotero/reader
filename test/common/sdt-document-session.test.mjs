import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { packStructuredDocumentText } from '../../structured-document-text/src/pack/writer.js';
import {
	SDT_PACK_VERSION,
	SDT_SCHEMA_VERSION,
} from '../../structured-document-text/src/version.js';

let mapperSource = `
export function createPositionMapper(structure) {
	return { type: structure.metadata.processor.type };
}
`;
const moduleHooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('/create-position-mapper.ts')) {
			return nextResolve('data:text/javascript,' + encodeURIComponent(mapperSource), context);
		}
		return nextResolve(specifier, context);
	},
});
const { SDTDocumentSession } = await import('../../src/common/sdt/document-session.mjs');
moduleHooks.deregister();

function createStructure() {
	return {
		schemaVersion: SDT_SCHEMA_VERSION,
		metadata: {
			processor: { type: 'epub', version: 1 },
			dateCreated: '2000-01-01T00:00:00.000Z',
			source: {
				contentType: 'application/epub+zip',
				hash: '0123456789abcdef0123456789abcdef',
				properties: {},
			},
		},
		catalog: { pages: [], outline: [] },
		content: [{ type: 'paragraph', content: [{ text: 'Text' }] }],
	};
}

function createPack(structure, changes = {}) {
	return {
		ok: true,
		bytes: packStructuredDocumentText(structure, {
			deflate: bytes => deflateRawSync(bytes),
		}),
		packVersion: SDT_PACK_VERSION,
		schemaMajorVersion: Number(SDT_SCHEMA_VERSION.split('.')[0]),
		...changes,
	};
}

async function materialize(session) {
	return (await session.getDocument())?.structure ?? null;
}

async function quietWarnings(callback) {
	let originalWarn = console.warn;
	console.warn = () => {};
	try {
		return await callback();
	}
	finally {
		console.warn = originalWarn;
	}
}

test('opens and materializes a format-neutral pack after an unavailable pull', async () => {
	let structure = createStructure();
	let pack = createPack(structure);
	let calls = 0;
	let progress = [];
	let session = new SDTDocumentSession({
		onProgress: value => progress.push(value),
		getPack: async ({ onProgress }) => {
			calls++;
			onProgress(25);
			return calls === 1 ? { ok: false, reason: 'busy' } : pack;
		},
	});

	await quietWarnings(async () => assert.deepEqual(
		await Promise.all([session.getDocument(), session.getDocument()]),
		[null, null]
	));
	let [firstDocument, secondDocument] = await Promise.all([
		session.getDocument(),
		session.getDocument(),
	]);
	assert.equal(firstDocument, secondDocument);
	assert.equal(session.getLoadedDocument(), firstDocument);
	assert.deepEqual(firstDocument.structure, structure);
	assert.deepEqual(firstDocument.mapper, { type: 'epub' });
	assert.equal(calls, 2);
	assert.deepEqual(progress, [25, null, 25, null]);
});

test('rejects incompatible envelope versions and document types', async () => {
	let invalidPacks = [
		createPack(createStructure(), { packVersion: undefined }),
		createPack(createStructure(), { schemaMajorVersion: undefined }),
	];

	for (let pack of invalidPacks) {
		let session = new SDTDocumentSession({
			getPack: async () => pack,
		});
		await quietWarnings(async () => assert.equal(await session.getReader(), null));
	}

	let wrongType = new SDTDocumentSession({
		documentType: 'pdf',
		getPack: async () => createPack(createStructure()),
	});
	await quietWarnings(async () => assert.equal(await wrongType.getDocument(), null));
	assert.equal(wrongType.getLoadedDocument(), null);
});

test('reset aborts stale acquisition and starts a new session', async () => {
	let structure = createStructure();
	let staleResolve;
	let staleSignal;
	let calls = 0;
	let session = new SDTDocumentSession({
		getPack: ({ signal }) => {
			calls++;
			if (calls === 1) {
				staleSignal = signal;
				return new Promise(resolve => staleResolve = resolve);
			}
			return createPack(structure);
		},
	});

	let staleReader = session.getReader();
	await Promise.resolve();
	session.reset();
	assert.equal(staleSignal.aborted, true);
	staleResolve(createPack(structure));
	assert.equal(await staleReader, null);
	assert.deepEqual(await materialize(session), structure);
});

test('accepts a direct pack and can release its reader after materialization', async () => {
	let session = new SDTDocumentSession({
		retainReader: false,
	});
	session.setPack(createPack(createStructure()));
	let firstReader = await session.getReader();
	assert.ok(await session.getDocument());
	let secondReader = await session.getReader();
	assert.notEqual(secondReader, firstReader);
});
