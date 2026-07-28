import assert from 'node:assert/strict';
import test from 'node:test';

import {
	alignTextUnits,
	buildReaderUnitMap,
	getMappedSelectionEndpoints,
	getMatchingSelectionRanges,
	getNormalizedUnits,
	selectionTextMatches
} from '../../src/pdf/native-text-selection-map.mjs';

function createEndpointMap(expectedNode, expectedOffset, expectedAffinity, readerOffset) {
	return {
		getReaderOffset(node, offset, affinity) {
			assert.equal(node, expectedNode);
			assert.equal(offset, expectedOffset);
			assert.equal(affinity, expectedAffinity);
			return readerOffset;
		}
	};
}

test('maps forward selection endpoints across pages', () => {
	let anchorNode = {};
	let focusNode = {};
	let selectionInfo = {
		selection: {
			anchorNode,
			anchorOffset: 2,
			focusNode,
			focusOffset: 7
		},
		anchorPageIndex: 1,
		focusPageIndex: 3,
		anchorIsStart: true
	};
	let endpoints = getMappedSelectionEndpoints(
		selectionInfo,
		createEndpointMap(anchorNode, 2, 'start', 4),
		createEndpointMap(focusNode, 7, 'end', 11)
	);
	assert.deepEqual(endpoints, {
		anchor: { pageIndex: 1, offset: 4 },
		focus: { pageIndex: 3, offset: 11 }
	});
});

test('maps reverse selection endpoints across pages', () => {
	let anchorNode = {};
	let focusNode = {};
	let selectionInfo = {
		selection: {
			anchorNode,
			anchorOffset: 5,
			focusNode,
			focusOffset: 1
		},
		anchorPageIndex: 4,
		focusPageIndex: 2,
		anchorIsStart: false
	};
	let endpoints = getMappedSelectionEndpoints(
		selectionInfo,
		createEndpointMap(anchorNode, 5, 'end', 9),
		createEndpointMap(focusNode, 1, 'start', 3)
	);
	assert.deepEqual(endpoints, {
		anchor: { pageIndex: 4, offset: 9 },
		focus: { pageIndex: 2, offset: 3 }
	});
});

test('normalizes whitespace, ligatures, and composed diacritics', () => {
	assert.deepEqual(
		getNormalizedUnits(`A \t\uFB03 caf\u00E9`),
		['A', 'f', 'f', 'i', 'c', 'a', 'f', 'e', '\u0301']
	);
	assert.equal(selectionTextMatches('office café', `o\uFB03ce cafe\u0301`), true);
});

test('matches PDF.js line-end hyphenation to Reader dehyphenation', () => {
	assert.equal(
		selectionTextMatches(
			'al-\nternative and efﬁcient',
			'alternative and efficient'
		),
		true
	);
	assert.equal(selectionTextMatches('a se-', 'a se'), true);
	assert.equal(selectionTextMatches('run-time', 'runtime'), false);
});

test('maps whitespace-free DOM units onto Reader character offsets', () => {
	let map = buildReaderUnitMap([
		{ c: 'a' },
		{ c: ' ' },
		{ c: 'b' }
	]);
	assert.deepEqual(map.readerUnits, ['a', 'b']);
	assert.deepEqual(map.readerStartOffsets, [0, 2, 3]);
	assert.deepEqual(map.readerEndOffsets, [0, 2, 3]);
	assert.deepEqual(
		alignTextUnits(getNormalizedUnits('a \n b'), map.readerUnits),
		[0, 1, 2]
	);
});

test('preserves character boundaries for ligatures and diacritics', () => {
	let ligatureMap = buildReaderUnitMap([{ c: '\uFB03' }]);
	assert.deepEqual(ligatureMap.readerUnits, ['f', 'f', 'i']);
	assert.deepEqual(ligatureMap.readerStartOffsets, [0, 0, 0, 1]);
	assert.deepEqual(ligatureMap.readerEndOffsets, [0, 1, 1, 1]);

	let diacriticMap = buildReaderUnitMap([{ c: '\u00E9' }]);
	assert.deepEqual(diacriticMap.readerUnits, ['e', '\u0301']);
	assert.deepEqual(diacriticMap.readerStartOffsets, [0, 0, 1]);
	assert.deepEqual(diacriticMap.readerEndOffsets, [0, 1, 1]);
});

test('aligns RTL text without changing logical order', () => {
	let domUnits = getNormalizedUnits('שלום עולם');
	let readerUnits = getNormalizedUnits('שלוםעולם');
	assert.deepEqual(
		alignTextUnits(domUnits, readerUnits),
		Array.from({ length: readerUnits.length + 1 }, (_, index) => index)
	);
});

test('uses geometry fallback only when mapped text does not match', () => {
	let mappedRanges = [{ text: 'wrong' }];
	let fallbackRanges = [{ text: 'office café' }];
	let fallbackCalls = 0;
	let result = getMatchingSelectionRanges(
		`o\uFB03ce cafe\u0301`,
		mappedRanges,
		ranges => ranges.map(range => range.text).join('\n'),
		() => {
			fallbackCalls++;
			return fallbackRanges;
		}
	);
	assert.equal(result, fallbackRanges);
	assert.equal(fallbackCalls, 1);
});

test('does not calculate fallback when mapped text matches', () => {
	let mappedRanges = [{ text: 'selected text' }];
	let fallbackCalls = 0;
	let result = getMatchingSelectionRanges(
		'selected text',
		mappedRanges,
		ranges => ranges.map(range => range.text).join('\n'),
		() => {
			fallbackCalls++;
			return [{ text: 'fallback' }];
		}
	);
	assert.equal(result, mappedRanges);
	assert.equal(fallbackCalls, 0);
});

test('rejects selection when mapped and fallback text both differ', () => {
	let result = getMatchingSelectionRanges(
		'native text',
		[{ text: 'mapped text' }],
		ranges => ranges.map(range => range.text).join('\n'),
		() => [{ text: 'fallback text' }]
	);
	assert.equal(result, null);
});
