import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createReaderSDTSearchData,
	SDTSearchIndex,
} from '../../src/pdf/sdt-search.mjs';

function text(text, extra = {}) {
	return { type: 'text', text, ...extra };
}

function block(content, extra = {}) {
	return { type: 'p', content, ...extra };
}

function structure(content) {
	return { content };
}

function createReader(content, chunkBlockStarts = [0, content.length]) {
	let reads = [];
	return {
		header: { schemaVersion: '1.0.0' },
		index: { chunkBlockStarts },
		getTopLevelBlockCount: () => content.length,
		getMetadata: async () => ({ processor: { type: 'pdf' } }),
		getCatalog: async () => ({ pages: [] }),
		async getBlocks(start, end) {
			reads.push([start, end]);
			return content.slice(start, end + 1);
		},
		get reads() {
			return reads;
		},
	};
}

test('searches logical SDT content in document order and skips excluded flow', async () => {
	let index = new SDTSearchIndex(structure([
		block([text('Second needle')]),
		block([text('hidden needle')], { flowClass: 'excluded' }),
		block([text('Third NEEDLE')]),
	]), { yieldControl: async () => {} });

	let results = await index.search('needle');
	assert.deepEqual(results.map(result => result.text), ['needle', 'NEEDLE']);
	assert.deepEqual(results.map(result => result.spans.map(span => ({
		ref: span.ref,
		start: span.start,
		end: span.end,
	}))), [
		[{ ref: [0, 0], start: 7, end: 13 }],
		[{ ref: [2, 0], start: 6, end: 12 }],
	]);
});

test('matches across part boundaries and maps dehyphenated text to both parts', async () => {
	let index = new SDTSearchIndex(structure([
		block([text('inter-')], { nextPart: [1] }),
		block([text('national')], { previousPart: [0] }),
	]), { yieldControl: async () => {} });

	let [result] = await index.search('international');
	assert.equal(result.text, 'international');
	assert.deepEqual(result.spans.map(span => ({
		ref: span.ref,
		start: span.start,
		end: span.end,
		text: span.node.text,
	})), [
		{ ref: [0, 0], start: 0, end: 5, text: 'inter-' },
		{ ref: [1, 0], start: 0, end: 8, text: 'national' },
	]);
});

test('builds equivalent detached search data one pack chunk at a time', async () => {
	let content = [
		block([text('inter-', {
			style: { bold: true },
			anchor: { pageRects: [[0, 0, 0, 10, 10]] },
		})], { nextPart: [2] }),
		block([text('hidden')], { flowClass: 'excluded' }),
		block([text('national', {
			refs: [[9]],
			anchor: { pageRects: [[1, 0, 0, 10, 10]] },
		})], { previousPart: [0] }),
	];
	let reader = createReader(content, [0, 1, 2, 3]);
	let data = await createReaderSDTSearchData(reader, {
		yieldControl: async () => {},
	});
	await data.searchIndex.prepare();
	let [result] = await data.searchIndex.search('international');

	assert.deepEqual(reader.reads, [[0, 0], [1, 1], [2, 2]]);
	assert.deepEqual(data.structure.content, []);
	assert.equal(data.searchIndex._reader, null);
	assert.equal(data.searchIndex._structure, null);
	assert.deepEqual(result.spans.map(span => ({
		ref: span.ref,
		start: span.start,
		end: span.end,
		nodeKeys: Object.keys(span.node).sort(),
		blockKeys: Object.keys(span.block).sort(),
	})), [
		{
			ref: [0, 0],
			start: 0,
			end: 5,
			nodeKeys: ['anchor', 'text'],
			blockKeys: [],
		},
		{
			ref: [2, 0],
			start: 0,
			end: 8,
			nodeKeys: ['anchor', 'text'],
			blockKeys: [],
		},
	]);
});

test('supports normalized case-sensitive whole-word search across scripts', async () => {
	let index = new SDTSearchIndex(structure([
		block([text('“Alpha” alphabet alpha café cafeteria 中文 文本中文')]),
	]), { yieldControl: async () => {} });

	assert.equal((await index.search('"alpha"')).length, 1);
	assert.equal((await index.search('alpha', { entireWord: true })).length, 2);
	assert.equal((await index.search('Alpha', {
		caseSensitive: true,
		entireWord: true,
	})).length, 1);
	assert.equal((await index.search('café', { entireWord: true })).length, 1);
	assert.equal((await index.search('caf', { entireWord: true })).length, 0);
	assert.equal((await index.search('中文', { entireWord: true })).length, 1);
});

test('normalizes PDF text without losing source offsets', async () => {
	let index = new SDTSearchIndex(structure([
		block([text('foo   bar; foo . bar; foo, bar; end.  next')]),
		block([text('oﬃce café cafe\u0301')]),
	]), { yieldControl: async () => {} });

	assert.deepEqual(
		(await index.search('foo bar')).map(result => result.text),
		['foo   bar']
	);
	assert.deepEqual(
		(await index.search('foo.bar')).map(result => result.text),
		['foo . bar']
	);
	assert.deepEqual(
		(await index.search('foo,bar')).map(result => result.text),
		['foo, bar']
	);
	assert.deepEqual(
		(await index.search('end.')).map(result => result.text),
		['end.']
	);

	let [ligature] = await index.search('office');
	assert.equal(ligature.text, 'oﬃce');
	assert.deepEqual(
		ligature.spans.map(({ start, end }) => [start, end]),
		[[0, 4]]
	);

	let accents = await index.search('cafe');
	assert.deepEqual(accents.map(result => result.text), ['café', 'cafe\u0301']);
	assert.deepEqual(accents.map(result => result.spans.map(({ start, end }) => [start, end])), [
		[[5, 9]],
		[[10, 15]],
	]);
	assert.equal((await index.search('café')).length, 2);
});

test('searches linked visible text once without indexing targets or joining unrelated blocks', async () => {
	let index = new SDTSearchIndex(structure([
		block([
			text('See '),
			text('Figure', {
				refs: [[2]],
				target: { url: 'https://target.example/needle' },
			}),
			text(' needle'),
		]),
		block([text('inter')]),
		block([text('net')]),
		block([text('body')], { nextPart: [4] }),
		block([text('footnote')], {
			flowClass: 'auxiliary',
			previousPart: [3],
		}),
	]), { yieldControl: async () => {} });

	let [result] = await index.search('Figure needle');
	assert.equal(result.text, 'Figure needle');
	assert.deepEqual(result.spans.map(span => span.ref), [[0, 1], [0, 2]]);
	assert.equal((await index.search('target.example')).length, 0);
	assert.equal((await index.search('internet')).length, 0);
	assert.equal((await index.search('bodyfootnote')).length, 0);
	assert.equal((await index.search('body')).length, 1);
	assert.equal((await index.search('footnote')).length, 1);
});

test('cancels a search without invalidating the shared immutable index', async () => {
	let releases = [];
	let blocking = true;
	let index = new SDTSearchIndex(structure([
		block([text('needle')]),
		block([text('needle')]),
	]), {
		yieldEvery: 1,
		maxWorkMs: 0,
		yieldControl: () => (blocking
			? new Promise(resolve => releases.push(resolve))
			: Promise.resolve()),
	});
	let controller = new AbortController();
	let pending = index.search('needle', { signal: controller.signal });
	await new Promise(resolve => setTimeout(resolve));
	releases.shift()?.();
	await new Promise(resolve => setTimeout(resolve));
	blocking = false;
	controller.abort();
	releases.shift()?.();
	await assert.rejects(pending, error => error.name === 'AbortError');

	while (releases.length) {
		releases.shift()();
	}
	assert.equal((await index.search('needle')).length, 2);
});
