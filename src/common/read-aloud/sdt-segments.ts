import { getSentenceBoundaries } from 'sentencex-ts';
import type {
	ContentBlockNode,
	RefPath,
	StructuredDocumentText,
	TextNode,
} from '../../../structured-document-text/schema';
import {
	getPartBoundarySeparator,
	getPartChain,
	shouldDropHardHyphenAtPartBoundary,
} from '../../../structured-document-text/src/parts';
import {
	compareRefs,
	refKey,
	walkContentRangeLeafBlocks,
} from '../../../structured-document-text/src/range';
import type {
	ReadAloudGranularity,
	ReadAloudSegment,
	SDTPosition,
} from '../types';
import type { TextNodeSpan } from '../sdt/position-mapper';
import { splitTextToChunks } from './segment-split';
import { detectLang } from '../lib/detect-lang';
import { getBaseLanguage } from './lang';

/**
 * The concatenated text of one logical paragraph (a part chain), with
 * mappings from character offsets back to SDT text nodes.
 */
interface ChainText {
	text: string;
	mappings: ChainTextMapping[];
}

// `[absStart, absEnd)` in the chain text always corresponds to
// `[start, end)` in the node text, so `absEnd - absStart === end - start`
type ChainTextMapping = TextNodeSpan & {
	absStart: number;
	absEnd: number;
	hasRefs?: boolean;
};

type TextRange = {
	start: number;
	end: number;
};

// Drop a bracket/parenthesis group when at least this fraction of its
// non-whitespace content is linked text. Heuristic tuned so citation and
// note marker groups and parenthesized figure/table pointers drop --
// including author-year citations where only the year is linked (~0.27) --
// while prose asides that merely contain a link (~0.21 and below) survive
const LINK_GROUP_COVERAGE_THRESHOLD = 0.25;

interface SegmentSource {
	chain: ChainText;
	rawStart: number;
	rawEnd: number;
}

/**
 * Read Aloud segments built from SDT content -- the single source of segments
 * for all view types. Segment positions are SDTPositions; the reader
 * materializes view-displayable source positions separately.
 */
export class SDTReadAloudSegments {
	segments: ReadAloudSegment[] = [];

	private _sources = new WeakMap<ReadAloudSegment, SegmentSource>();

	/**
	 * Resolve a character range of a segment's normalized text (as sent to
	 * the TTS API) to an SDTPosition. Used for word-level highlighting from
	 * API word timestamps.
	 *
	 * The TTS API works in the normalized text (whitespace collapsed and
	 * trimmed), while SDT positions address the original text, so we walk
	 * the two in lockstep to translate offsets.
	 */
	getWordPosition(segment: ReadAloudSegment, charStart: number, charEnd: number): SDTPosition | null {
		let source = this._sources.get(segment);
		if (!source) {
			return null;
		}
		let rawOffsets = normalizedOffsetsToRawOffsets(segment, source, charStart, charEnd);
		if (!rawOffsets) {
			return null;
		}

		return makePosition(source.chain, rawOffsets.rawStart, rawOffsets.rawEnd);
	}

	getSegmentTextSpans(segment: ReadAloudSegment): TextNodeSpan[] {
		let source = this._sources.get(segment);
		if (!source) {
			return [];
		}
		return getTextSpans(source.chain, source.rawStart, source.rawEnd);
	}

	getParagraphTextSpans(segment: ReadAloudSegment): TextNodeSpan[] {
		let source = this._sources.get(segment);
		if (!source) {
			return [];
		}
		return getTextSpans(source.chain, 0, source.chain.text.length);
	}

	getWordTextSpans(segment: ReadAloudSegment, charStart: number, charEnd: number): TextNodeSpan[] {
		let source = this._sources.get(segment);
		if (!source) {
			return [];
		}
		let rawOffsets = normalizedOffsetsToRawOffsets(segment, source, charStart, charEnd);
		if (!rawOffsets) {
			return [];
		}
		return getTextSpans(source.chain, rawOffsets.rawStart, rawOffsets.rawEnd);
	}

	getSegmentsTextSpans(segments: ReadAloudSegment[]): TextNodeSpan[] {
		let spans: TextNodeSpan[] = [];
		for (let segment of segments) {
			spans.push(...this.getSegmentTextSpans(segment));
		}
		return spans;
	}

	addSegment(
		chain: ChainText,
		rawStart: number,
		rawEnd: number,
		granularity: ReadAloudGranularity,
	): boolean {
		let text = normalizeText(chain.text.slice(rawStart, rawEnd));
		if (!text) {
			return false;
		}
		let position = makePosition(chain, rawStart, rawEnd);
		if (!position) {
			return false;
		}
		let segment: ReadAloudSegment = {
			text,
			position,
			granularity,
			anchor: null,
		};
		this.segments.push(segment);
		this._sources.set(segment, { chain, rawStart, rawEnd });
		return true;
	}
}

export function buildSDTReadAloudSegments(
	structure: StructuredDocumentText,
	granularity: ReadAloudGranularity,
	lang?: string,
): SDTReadAloudSegments {
	let chains = collectChainTexts(structure);
	let resolvedLang = lang || getSDTLang(structure);
	let result = new SDTReadAloudSegments();
	for (let chain of chains) {
		let firstIndex = result.segments.length;
		segmentChain(result, chain, granularity, resolvedLang);
		if (result.segments.length > firstIndex) {
			result.segments[firstIndex].anchor = 'paragraphStart';
		}
	}
	return result;
}

/**
 * Get the document language from SDT metadata, falling back to detection
 * from content.
 */
export function getSDTLang(structure: StructuredDocumentText): string {
	let props = structure.metadata.source.properties as Record<string, unknown> | undefined;
	let lang = props?.language || props?.Language || props?.['dc:language'];
	if (typeof lang === 'string' && lang) {
		return getBaseLanguage(lang);
	}
	let sample = '';
	for (let chain of collectChainTexts(structure)) {
		sample += chain.text + '\n';
		if (sample.length > 2500) {
			break;
		}
	}
	return detectLang(sample) || 'en';
}

/**
 * Find the index of the first segment whose end is at or past the given
 * position's start.
 *
 * With exact = false, falls back to the last segment when nothing reaches
 * the position. With exact = true, returns null instead.
 */
export function findSegmentIndexForSDTPosition(
	segments: ReadAloudSegment[],
	position: SDTPosition,
	{ exact = false }: { exact?: boolean } = {},
): number | null {
	for (let i = 0; i < segments.length; i++) {
		if (compareRefs(segments[i].position.end as RefPath, position.start as RefPath) >= 0) {
			return i;
		}
	}
	if (exact) {
		return null;
	}
	return segments.length ? segments.length - 1 : null;
}

/**
 * Collect the text of every logical paragraph: walk leaf blocks, join part
 * chains (paragraphs split across pages/columns), concatenate each chain's
 * text nodes, and omit linked bracket groups and superscript markers from
 * the spoken text.
 */
function collectChainTexts(structure: StructuredDocumentText): ChainText[] {
	let chains: ChainText[] = [];
	let emitted = new Set<string>();
	let include = (ref: number[]) => structure.content[ref[0]]?.flowClass !== 'excluded';

	walkContentRangeLeafBlocks(
		structure.content,
		[[0], [structure.content.length]],
		({ ref }) => {
			let leafRef = ref as number[];
			if (!include(leafRef) || emitted.has(refKey(leafRef))) {
				return;
			}
			let chain = getPartChain(structure, leafRef as RefPath, { include })
				.map(part => ({ ref: part.ref, block: part.block as ContentBlockNode }));
			if (chain.some(part => emitted.has(refKey(part.ref)))) {
				return;
			}
			for (let part of chain) {
				emitted.add(refKey(part.ref));
			}
			let chainText = buildChainText(chain);
			if (chainText.text.trim()) {
				chains.push(chainText);
			}
		}
	);
	return chains;
}

function buildChainText(chain: { ref: number[], block: ContentBlockNode }[]): ChainText {
	let text = '';
	let mappings: ChainText['mappings'] = [];

	for (let i = 0; i < chain.length; i++) {
		let { ref, block } = chain[i];
		if (i > 0) {
			let prevBlock = chain[i - 1].block;
			if (shouldDropHardHyphenAtPartBoundary(prevBlock, block) && text.endsWith('-')) {
				text = text.slice(0, -1);
				let last = mappings[mappings.length - 1];
				if (last) {
					last.absEnd--;
					last.end--;
					if (last.absEnd <= last.absStart) {
						mappings.pop();
					}
				}
			}
			text += getPartBoundarySeparator(prevBlock, block);
		}

		let nodes = block.content as TextNode[] | undefined;
		if (!nodes) {
			continue;
		}
		for (let j = 0; j < nodes.length; j++) {
			let node = nodes[j];
			if (typeof node?.text !== 'string' || !node.text) {
				continue;
			}
			// Whitespace-only nodes keep their text (word separation) but get
			// no mapping, so positions snap inward to nodes with visible text
			// and never anchor to unrendered whitespace
			if (/\S/.test(node.text)) {
				mappings.push({
					block,
					blockRef: [...ref],
					node,
					ref: [...ref, j],
					start: 0,
					end: node.text.length,
					absStart: text.length,
					absEnd: text.length + node.text.length,
					hasRefs: !!node.refs?.length,
				});
			}
			text += node.text;
		}
	}

	return compactChainText(text, mappings, getElidedRanges(text, mappings));
}

/**
 * Ranges of the chain text that Read Aloud skips: bracket/parenthesis
 * groups that are mostly linked text, and superscript link markers.
 */
function getElidedRanges(text: string, mappings: ChainTextMapping[]): TextRange[] {
	let ranges: TextRange[] = [];
	for (let [open, close] of [['[', ']'], ['(', ')']] as const) {
		let stack: number[] = [];
		for (let i = 0; i < text.length; i++) {
			if (text[i] === open) {
				stack.push(i);
			}
			else if (text[i] === close && stack.length) {
				let start = stack.pop()!;
				if (isLinkGroup(text, mappings, start, i + 1)) {
					ranges.push({ start, end: i + 1 });
				}
			}
		}
	}
	for (let mapping of mappings) {
		if (mapping.hasRefs && mapping.node.style?.sup) {
			ranges.push({ start: mapping.absStart, end: mapping.absEnd });
		}
	}
	return mergeRanges(ranges);
}

function isLinkGroup(text: string, mappings: ChainTextMapping[], start: number, end: number): boolean {
	let linkedChars = 0;
	for (let mapping of mappings) {
		if (!mapping.hasRefs) {
			continue;
		}
		let from = Math.max(start, mapping.absStart);
		let to = Math.min(end, mapping.absEnd);
		for (let i = from; i < to; i++) {
			if (/\S/.test(text[i])) {
				linkedChars++;
			}
		}
	}
	if (!linkedChars) {
		return false;
	}
	let contentChars = 0;
	for (let i = start + 1; i < end - 1; i++) {
		if (/\S/.test(text[i])) {
			contentChars++;
		}
	}
	return contentChars > 0 && linkedChars / contentChars >= LINK_GROUP_COVERAGE_THRESHOLD;
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
	let sorted = ranges
		.filter(range => range.end > range.start)
		.sort((a, b) => a.start - b.start || a.end - b.end);
	let merged: TextRange[] = [];
	for (let range of sorted) {
		let last = merged[merged.length - 1];
		if (last && range.start <= last.end) {
			last.end = Math.max(last.end, range.end);
		}
		else {
			merged.push({ ...range });
		}
	}
	return merged;
}

/**
 * Remove the given ranges from the chain text and re-split the mappings
 * around them.
 */
function compactChainText(text: string, mappings: ChainTextMapping[], ranges: TextRange[]): ChainText {
	if (!ranges.length) {
		return { text, mappings };
	}

	// Complement of the elided ranges: each kept slice of the raw text,
	// annotated with where it lands in the compacted text
	let kept: { start: number, end: number, compactedStart: number }[] = [];
	let cursor = 0;
	let compactedLength = 0;
	for (let range of [...ranges, { start: text.length, end: text.length }]) {
		if (range.start > cursor) {
			kept.push({ start: cursor, end: range.start, compactedStart: compactedLength });
			compactedLength += range.start - cursor;
		}
		cursor = Math.max(cursor, range.end);
	}

	let compactedMappings: ChainTextMapping[] = [];
	for (let mapping of mappings) {
		for (let slice of kept) {
			let start = Math.max(mapping.absStart, slice.start);
			let end = Math.min(mapping.absEnd, slice.end);
			if (end <= start || !/\S/.test(text.slice(start, end))) {
				continue;
			}
			compactedMappings.push({
				...mapping,
				start: mapping.start + start - mapping.absStart,
				end: mapping.start + end - mapping.absStart,
				absStart: slice.compactedStart + start - slice.start,
				absEnd: slice.compactedStart + end - slice.start,
			});
		}
	}

	return {
		text: kept.map(slice => text.slice(slice.start, slice.end)).join(''),
		mappings: compactedMappings,
	};
}

function segmentChain(
	result: SDTReadAloudSegments,
	chain: ChainText,
	granularity: ReadAloudGranularity,
	lang: string,
) {
	let sentences = getSentenceBoundaries(lang || 'en', chain.text)
		.filter(boundary => /\S/.test(boundary.text))
		.map(boundary => [boundary.startIndex, boundary.endIndex] as [number, number]);

	if (!sentences.length) {
		sentences = [[0, chain.text.length]];
	}

	let pieces: [number, number][];
	if (granularity === 'paragraph' && sentences.length > 1) {
		// First sentence, then the rest of the paragraph
		pieces = [
			sentences[0],
			[sentences[1][0], sentences[sentences.length - 1][1]],
		];
	}
	else {
		pieces = sentences;
	}

	for (let [start, end] of pieces) {
		let pieceText = chain.text.slice(start, end);
		for (let [chunkStart, chunkEnd] of splitTextToChunks(pieceText)) {
			result.addSegment(chain, start + chunkStart, start + chunkEnd, granularity);
		}
	}
}

function makePosition(chain: ChainText, rawStart: number, rawEnd: number): SDTPosition | null {
	let start = offsetToPoint(chain, rawStart, false);
	let end = offsetToPoint(chain, rawEnd, true);
	if (!start || !end) {
		return null;
	}
	return { start, end };
}

/**
 * Convert a character offset in a chain's text to an SDT content point.
 * Offsets that land between mappings (part separators, skipped reference
 * markers) snap inward.
 */
function offsetToPoint(chain: ChainText, offset: number, isEnd: boolean): number[] | null {
	let { mappings } = chain;
	if (!mappings.length) {
		return null;
	}
	if (isEnd) {
		// Last mapping that starts before the offset
		for (let i = mappings.length - 1; i >= 0; i--) {
			let mapping = mappings[i];
			if (mapping.absStart < offset) {
				return [...mapping.ref, Math.min(offset, mapping.absEnd) - mapping.absStart];
			}
		}
		return [...mappings[0].ref, 0];
	}
	// First mapping that ends past the offset
	for (let mapping of mappings) {
		if (mapping.absEnd > offset) {
			return [...mapping.ref, Math.max(offset, mapping.absStart) - mapping.absStart];
		}
	}
	let last = mappings[mappings.length - 1];
	return [...last.ref, last.absEnd - last.absStart];
}

function getTextSpans(chain: ChainText, rawStart: number, rawEnd: number): TextNodeSpan[] {
	let spans: TextNodeSpan[] = [];
	for (let mapping of chain.mappings) {
		let start = Math.max(rawStart, mapping.absStart);
		let end = Math.min(rawEnd, mapping.absEnd);
		if (end <= start) {
			continue;
		}
		spans.push({
			block: mapping.block,
			blockRef: [...mapping.blockRef],
			node: mapping.node,
			ref: [...mapping.ref],
			start: mapping.start + start - mapping.absStart,
			end: mapping.start + end - mapping.absStart,
		});
	}
	return spans;
}

function normalizedOffsetsToRawOffsets(
	segment: ReadAloudSegment,
	source: SegmentSource,
	charStart: number,
	charEnd: number,
): { rawStart: number, rawEnd: number } | null {
	let { chain, rawStart, rawEnd } = source;
	let rawSlice = chain.text.slice(rawStart, rawEnd);
	let normalized = segment.text;
	let clampedStart = Math.max(0, Math.min(charStart, normalized.length));
	let clampedEnd = Math.max(clampedStart, Math.min(charEnd, normalized.length));

	let rawOffsetAtStart = -1;
	let rawOffsetAtEnd = -1;
	let rawOffset = 0;
	while (rawOffset < rawSlice.length && /\s/.test(rawSlice[rawOffset])) {
		rawOffset++;
	}
	for (let i = 0; i <= normalized.length; i++) {
		if (i === clampedStart) {
			rawOffsetAtStart = rawOffset;
		}
		if (i === clampedEnd) {
			rawOffsetAtEnd = rawOffset;
			break;
		}
		if (i === normalized.length) {
			break;
		}
		if (normalized[i] === ' ' && rawOffset < rawSlice.length && /\s/.test(rawSlice[rawOffset])) {
			while (rawOffset < rawSlice.length && /\s/.test(rawSlice[rawOffset])) {
				rawOffset++;
			}
		}
		else {
			rawOffset++;
		}
	}
	if (rawOffsetAtStart < 0 || rawOffsetAtEnd < 0) {
		return null;
	}
	return {
		rawStart: rawStart + rawOffsetAtStart,
		rawEnd: rawStart + rawOffsetAtEnd,
	};
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}
