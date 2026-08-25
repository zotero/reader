import {
	getPartBoundarySeparator,
	shouldDropHardHyphenAtPartBoundary,
} from '../../structured-document-text/src/parts.js';
import {
	isLeafBlock,
	refKey,
} from '../../structured-document-text/src/range.js';

const DEFAULT_YIELD_EVERY = 100;
const SNIPPET_CONTEXT_LENGTH = 40;

export function createSDTSearchData(structure, options = {}) {
	return {
		structure: {
			schemaVersion: structure.schemaVersion,
			metadata: structure.metadata,
			catalog: structure.catalog,
			content: [],
		},
		searchIndex: new SDTSearchIndex(structure, options),
	};
}

export async function createReaderSDTSearchData(reader, options = {}) {
	let [metadata, catalog] = await Promise.all([
		reader.getMetadata(),
		reader.getCatalog(),
	]);
	return createSDTSearchData({
		schemaVersion: reader.header.schemaVersion,
		metadata,
		catalog,
		content: [],
	}, {
		...options,
		reader,
	});
}

/**
 * Immutable, lazily built search index over the logical text of an SDT
 * document. Results remain in SDT document order and retain enough mapping
 * information for each view to project them into its own coordinate system.
 */
export class SDTSearchIndex {
	constructor(structure, {
		yieldControl = () => new Promise(resolve => setTimeout(resolve)),
		yieldEvery = DEFAULT_YIELD_EVERY,
		maxWorkMs = 4,
		reader = null,
		signal = null,
	} = {}) {
		this._structure = structure;
		this._reader = reader;
		this._buildSignal = signal;
		this._yieldControl = yieldControl;
		this._yieldEvery = Math.max(1, yieldEvery);
		this._maxWorkMs = Math.max(0, maxWorkMs);
		this._chainsPromise = null;
	}

	prepare() {
		if (!this._chainsPromise) {
			let promise = this._buildChains();
			let trackedPromise = promise.catch((error) => {
				if (this._chainsPromise === trackedPromise) {
					this._chainsPromise = null;
				}
				throw error;
			});
			this._chainsPromise = trackedPromise;
		}
		return this._chainsPromise;
	}

	async search(query, {
		caseSensitive = false,
		entireWord = false,
		mapResult = null,
		signal,
	} = {}) {
		throwIfAborted(signal);
		if (!query) {
			return [];
		}

		let chains = await this.prepare();
		throwIfAborted(signal);

		let term = makeSearchPattern(query);
		if (!term) {
			return [];
		}
		let regexp = new RegExp(term, caseSensitive ? 'gu' : 'giu');
		let results = [];
		let checkpoint = createCheckpoint(this, signal);

		for (let i = 0; i < chains.length; i++) {
			let chain = chains[i];
			regexp.lastIndex = 0;
			let normalized = normalizeWithOffsets(chain.text);
			let normalizedText = normalized.text;
			let match;
			while ((match = regexp.exec(normalizedText))) {
				let normalizedStart = match.index;
				let normalizedEnd = normalizedStart + match[0].length;
				if (!entireWord || isEntireWord(normalizedText, normalizedStart, normalizedEnd)) {
					let start = normalized.startOffsets[normalizedStart];
					let end = normalized.endOffsets[normalizedEnd];
					if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
						let spans = getTextSpans(chain, start, end);
						if (spans.length) {
							let result = {
								spans,
								text: chain.text.slice(start, end),
								snippet: makeSnippet(chain.text, start, end),
							};
							if (mapResult) {
								result = mapResult(result);
							}
							if (result !== null && result !== undefined) {
								results.push(result);
							}
						}
					}
				}
				let pending = checkpoint();
				if (pending) {
					await pending;
				}
			}
			let pending = checkpoint();
			if (pending) {
				await pending;
			}
		}

		return results;
	}

	async _buildChains() {
		let checkpoint = createCheckpoint(this, this._buildSignal);
		let entries = this._reader
			? await collectReaderSearchEntries(this._reader, checkpoint)
			: await collectStructureSearchEntries(this._structure, checkpoint);
		if (!entries.length) {
			this._structure = null;
			this._reader = null;
			return [];
		}
		let entriesByRef = new Map();
		for (let entry of entries) {
			entriesByRef.set(refKey(entry.ref), entry);
		}
		let chains = [];
		for (let entry of entries) {
			// Entries consumed by an earlier part chain are cleared below so
			// their detached SDT blocks can be collected while the final index
			// is still being assembled.
			if (!entry) {
				continue;
			}
			let pending = checkpoint();
			if (pending) {
				await pending;
			}
			let parts = getSearchPartChain(entry, entriesByRef);
			if (!parts.length) {
				parts = [entry];
			}
			for (let part of parts) {
				let key = refKey(part.ref);
				entries[part.orderIndex] = null;
				entriesByRef.delete(key);
			}
			let chain = buildChainText(parts);
			if (chain.text.trim() && chain.mappings.length) {
				chains.push(chain);
			}
		}
		this._structure = null;
		this._reader = null;
		return chains;
	}
}

function createCheckpoint(index, signal) {
	let count = 0;
	let deadline = performance.now() + index._maxWorkMs;
	return () => {
		throwIfAborted(signal);
		if (++count < index._yieldEvery) {
			return null;
		}
		count = 0;
		if (index._maxWorkMs > 0 && performance.now() < deadline) {
			return null;
		}
		return Promise.resolve(index._yieldControl()).then(() => {
			deadline = performance.now() + index._maxWorkMs;
			throwIfAborted(signal);
		});
	};
}

async function collectReaderSearchEntries(reader, checkpoint) {
	let entries = [];
	let chunkStarts = reader.index.chunkBlockStarts;
	for (let chunkIndex = 0; chunkIndex < chunkStarts.length - 1; chunkIndex++) {
		let pending = checkpoint();
		if (pending) {
			await pending;
		}
		let start = chunkStarts[chunkIndex];
		let blocks = await reader.getBlocks(start, chunkStarts[chunkIndex + 1] - 1);
		for (let [offset, block] of blocks.entries()) {
			await collectTopLevelSearchEntries(
				block,
				start + offset,
				entries,
				checkpoint
			);
		}
	}
	return entries;
}

async function collectStructureSearchEntries(structure, checkpoint) {
	let entries = [];
	for (let [index, block] of (structure?.content || []).entries()) {
		await collectTopLevelSearchEntries(block, index, entries, checkpoint);
	}
	return entries;
}

async function collectTopLevelSearchEntries(
	topLevelBlock,
	topLevelIndex,
	entries,
	checkpoint
) {
	if (!topLevelBlock || typeof topLevelBlock !== 'object') {
		return;
	}
	let flowClass = topLevelBlock.flowClass ?? 'body';
	if (flowClass === 'excluded') {
		return;
	}
	let stack = [{ node: topLevelBlock, ref: [topLevelIndex] }];
	while (stack.length) {
		let pending = checkpoint();
		if (pending) {
			await pending;
		}
		let { node, ref } = stack.pop();
		if (!node || typeof node !== 'object' || typeof node.text === 'string') {
			continue;
		}
		if (isLeafBlock(node)) {
			entries.push({
				orderIndex: entries.length,
				ref,
				flowClass,
				block: detachSearchBlock(node),
			});
			continue;
		}
		for (let index = (node.content?.length ?? 0) - 1; index >= 0; index--) {
			let child = node.content[index];
			if (child && typeof child === 'object' && typeof child.text !== 'string') {
				stack.push({
					node: child,
					ref: [...ref, index],
				});
			}
		}
	}
}

function detachSearchBlock(block) {
	let anchor = detachSearchAnchor(block.anchor);
	return {
		...(anchor
			? { anchor }
			: {}),
		...(Array.isArray(block.previousPart)
			? { previousPart: block.previousPart }
			: {}),
		...(Array.isArray(block.nextPart)
			? { nextPart: block.nextPart }
			: {}),
		content: (block.content || []).map((node) => {
			if (typeof node?.text !== 'string') {
				return null;
			}
			let anchor = detachSearchAnchor(node.anchor);
			return {
				text: node.text,
				...(anchor ? { anchor } : {}),
			};
		}),
	};
}

function detachSearchAnchor(anchor) {
	if (!anchor || typeof anchor !== 'object') {
		return null;
	}
	let detached = {};
	if (typeof anchor.textMap === 'string') {
		detached.textMap = anchor.textMap;
	}
	if (Array.isArray(anchor.pageRects)) {
		// SDT input is immutable. Sharing this required leaf data avoids a
		// second geometry copy without retaining its parent node or tree.
		detached.pageRects = anchor.pageRects;
	}
	return Object.keys(detached).length ? detached : null;
}

function getSearchPartChain(entry, entriesByRef) {
	let currentRef = [...entry.ref];
	let rootSeen = new Set();
	while (currentRef) {
		let key = refKey(currentRef);
		if (rootSeen.has(key)) {
			break;
		}
		rootSeen.add(key);
		let current = entriesByRef.get(key);
		if (!Array.isArray(current?.block.previousPart)) {
			break;
		}
		currentRef = [...current.block.previousPart];
	}

	let chain = [];
	let seen = new Set();
	while (currentRef) {
		let key = refKey(currentRef);
		if (seen.has(key)) {
			break;
		}
		seen.add(key);
		let current = entriesByRef.get(key);
		if (!current || current.flowClass !== entry.flowClass) {
			break;
		}
		chain.push(current);
		if (!Array.isArray(current.block.nextPart)) {
			break;
		}
		currentRef = [...current.block.nextPart];
	}
	return chain;
}

function buildChainText(parts) {
	let text = '';
	let mappings = [];

	for (let i = 0; i < parts.length; i++) {
		let { ref, block } = parts[i];
		if (i > 0) {
			let previousBlock = parts[i - 1].block;
			if (shouldDropHardHyphenAtPartBoundary(previousBlock, block) && text.endsWith('-')) {
				text = text.slice(0, -1);
				let last = mappings.at(-1);
				if (last) {
					last.trailingText = '-';
					last.absEnd--;
					if (last.absEnd <= last.absStart) {
						mappings.pop();
					}
				}
			}
			text += getPartBoundarySeparator(previousBlock, block);
		}

		if (!Array.isArray(block.content)) {
			continue;
		}
		for (let j = 0; j < block.content.length; j++) {
			let node = block.content[j];
			if (typeof node?.text !== 'string' || !node.text) {
				continue;
			}
			if (/\S/.test(node.text)) {
				mappings.push({
					blockRef: ref,
					textIndex: j,
					blockAnchor: block.anchor ?? null,
					nodeAnchor: node.anchor ?? null,
					absStart: text.length,
					absEnd: text.length + node.text.length,
				});
			}
			text += node.text;
		}
	}

	return { text, mappings };
}

function getTextSpans(chain, startOffset, endOffset) {
	let spans = [];
	for (let mapping of chain.mappings) {
		let start = Math.max(startOffset, mapping.absStart);
		let end = Math.min(endOffset, mapping.absEnd);
		if (end <= start) {
			continue;
		}
		let block = mapping.blockAnchor
			? { anchor: mapping.blockAnchor }
			: {};
		let node = {
			text: chain.text.slice(mapping.absStart, mapping.absEnd)
				+ (mapping.trailingText ?? ''),
			...(mapping.nodeAnchor
				? { anchor: mapping.nodeAnchor }
				: {}),
		};
		spans.push({
			block,
			blockRef: [...mapping.blockRef],
			node,
			ref: [...mapping.blockRef, mapping.textIndex],
			start: start - mapping.absStart,
			end: end - mapping.absStart,
		});
	}
	return spans;
}

function makeSnippet(text, start, end) {
	let from = Math.max(0, start - SNIPPET_CONTEXT_LENGTH);
	let to = Math.min(text.length, end + SNIPPET_CONTEXT_LENGTH);
	let snippet = text.slice(from, to).trim();
	if (from > 0) {
		snippet = '…' + snippet;
	}
	if (to < text.length) {
		snippet += '…';
	}
	return snippet;
}

function normalizeWithOffsets(value) {
	let text = '';
	let startOffsets = [0];
	let endOffsets = [0];
	let sourceOffset = 0;
	for (let character of value) {
		let sourceStart = sourceOffset;
		let sourceEnd = sourceStart + character.length;
		let replacement = character
			.normalize('NFKD')
			.replace(/[\u2018\u2019]/g, "'")
			.replace(/[\u201C\u201D]/g, '"');
		let normalizedStart = text.length;
		text += replacement;
		let normalizedEnd = text.length;
		startOffsets[normalizedStart] = sourceStart;
		endOffsets[normalizedStart] = sourceStart;
		for (let i = normalizedStart + 1; i < normalizedEnd; i++) {
			startOffsets[i] = sourceStart;
			endOffsets[i] = sourceEnd;
		}
		startOffsets[normalizedEnd] = sourceEnd;
		endOffsets[normalizedEnd] = sourceEnd;
		sourceOffset = sourceEnd;
	}
	return { text, startOffsets, endOffsets };
}

function makeSearchPattern(value) {
	let normalized = normalizeWithOffsets(value).text;
	let pattern = '';
	let afterLatinLetter = false;
	let characters = [...normalized];
	for (let index = 0; index < characters.length; index++) {
		let character = characters[index];
		if (/\s/u.test(character)) {
			while (index + 1 < characters.length && /\s/u.test(characters[index + 1])) {
				index++;
			}
			pattern += '\\s+';
			afterLatinLetter = false;
			continue;
		}
		if (/\p{P}/u.test(character)) {
			let punctuation = character;
			while (index + 1 < characters.length && /\p{P}/u.test(characters[index + 1])) {
				punctuation += characters[++index];
			}
			if (pattern) {
				pattern += '\\s*';
			}
			pattern += escapeRegExp(punctuation);
			if (index + 1 < characters.length) {
				pattern += '\\s*';
			}
			afterLatinLetter = false;
			continue;
		}
		if (afterLatinLetter && /\p{M}/u.test(character)) {
			continue;
		}
		pattern += escapeRegExp(character);
		afterLatinLetter = /\p{Script=Latin}/u.test(character);
		if (afterLatinLetter) {
			// Reader has no match-diacritics option. Match PDF.js's default
			// behavior for Latin text while preserving meaningful marks in
			// other scripts.
			pattern += '\\p{M}*';
		}
	}
	return pattern;
}

function isEntireWord(text, start, end) {
	let first = characterAt(text, start);
	let last = characterBefore(text, end);
	let before = characterBefore(text, start);
	let after = characterAt(text, end);
	return (!before || characterType(before) !== characterType(first))
		&& (!after || characterType(after) !== characterType(last));
}

function characterAt(text, index) {
	let codePoint = text.codePointAt(index);
	return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}

function characterBefore(text, index) {
	if (index <= 0) {
		return '';
	}
	let start = index - 1;
	let code = text.charCodeAt(start);
	if (start > 0 && code >= 0xDC00 && code <= 0xDFFF) {
		let previous = text.charCodeAt(start - 1);
		if (previous >= 0xD800 && previous <= 0xDBFF) {
			start--;
		}
	}
	return text.slice(start, index);
}

function characterType(character) {
	let codePoint = character.codePointAt(0);
	if (/\s/u.test(character)) {
		return 'space';
	}
	if ((codePoint >= 0x3400 && codePoint <= 0x9FFF)
			|| (codePoint >= 0xF900 && codePoint <= 0xFAFF)) {
		return 'han';
	}
	if (codePoint >= 0x30A0 && codePoint <= 0x30FF) {
		return 'katakana';
	}
	if (codePoint >= 0x3040 && codePoint <= 0x309F) {
		return 'hiragana';
	}
	if (codePoint >= 0xFF60 && codePoint <= 0xFF9F) {
		return 'halfwidth-katakana';
	}
	if ((codePoint & 0xFF80) === 0x0E00) {
		return 'thai';
	}
	return /[\p{L}\p{M}\p{N}_]/u.test(character) ? 'word' : 'punctuation';
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function throwIfAborted(signal) {
	if (signal?.aborted) {
		throw new DOMException('The operation was aborted', 'AbortError');
	}
}
