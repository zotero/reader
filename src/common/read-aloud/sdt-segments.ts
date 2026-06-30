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

type ChainTextMapping = TextNodeSpan & {
	absStart: number;
	absEnd: number;
};

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
 * chains (paragraphs split across pages/columns), and concatenate each
 * chain's text nodes. Reference markers (citations, footnote markers) are
 * left out of the spoken text.
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
			if (node.refs || node.backRefs) {
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
				});
			}
			text += node.text;
		}
	}

	return { text, mappings };
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
