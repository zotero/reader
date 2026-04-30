import type { StructuredDocumentText } from '../../../structured-document-text/schema';
import { getNestedBlockPlainText } from '../../../structured-document-text/src/text';
import { getSentenceBoundaries } from 'sentencex-ts';
import type {
	ReadAloudGranularity,
	ReadAloudSegment,
	SDTPosition,
} from '../types';
import { splitTextToChunks } from './segment-split';
import { detectLang } from '../lib/detect-lang';
import { getBaseLanguage } from './lang';
import type { PositionIndex } from '../../dom/sdt/lib/position-index';

/**
 * One leaf block's concatenated text with its text-node mappings. The
 * mappings let us convert offsets in the concatenated text back to
 * (textIndex, charOffset) within the block.
 */
interface BlockText {
	blockRefPath: string;
	text: string;
	mappings: TextNodeMapping[];
}

/**
 * Footprint of one SDT text node within its block's concatenated text:
 * text node `textIndex` covers chars [absStart, absEnd) of the concatenation.
 */
interface TextNodeMapping {
	textIndex: number;
	absStart: number;
	absEnd: number;
}

/**
 * Index of every leaf block's concatenated text, keyed by blockRefPath. The
 * reader builds this once per loaded SDT and passes it to getSubSDTPosition()
 * when it needs to convert an API word-timestamp into an SDTPosition.
 *
 * Opaque to consumers; the value type isn't exported because nothing
 * outside this module needs to look inside.
 */
export type ReadAloudBlockIndex = ReadonlyMap<string, BlockText>;

/**
 * Extract language from SDT metadata, falling back to content detection.
 */
export function getSDTLang(sdt: StructuredDocumentText): string {
	let lang = sdt.metadata?.language
		|| sdt.metadata?.Language
		|| sdt.metadata?.['dc:language'];
	if (typeof lang === 'string' && lang) {
		return getBaseLanguage(lang);
	}

	// Fall back to content detection on first ~25 blocks
	let sampleText = '';
	let count = 0;
	for (let block of sdt.content) {
		if (block.artifact) continue;
		let text = getNestedBlockPlainText(block);
		if (text) {
			sampleText += text + '\n';
			count++;
			if (count >= 25) break;
		}
	}
	return detectLang(sampleText) || 'en';
}

export function buildSDTReadAloudSegments(
	sdt: StructuredDocumentText,
	index: PositionIndex,
	granularity: ReadAloudGranularity,
	lang?: string,
): ReadAloudSegment[] {
	let blockTexts = buildBlockTexts(index);
	let detectedLang = lang || getSDTLang(sdt);
	let segments: ReadAloudSegment[] = [];

	for (let block of blockTexts) {
		let blockSegments = segmentBlock(block, granularity, detectedLang);
		if (blockSegments.length) {
			blockSegments[0].anchor = 'paragraphStart';
		}
		segments.push(...blockSegments);
	}

	return segments;
}

/**
 * Build the per-block index that `getSubSDTPosition` consumes. Cheap and only
 * needs to run once per loaded SDT.
 */
export function buildReadAloudBlockIndex(index: PositionIndex): ReadAloudBlockIndex {
	let map = new Map<string, BlockText>();
	for (let block of buildBlockTexts(index)) {
		map.set(block.blockRefPath, block);
	}
	return map;
}

/**
 * Group PositionIndex entries into per-block concatenated text + mappings.
 * Reference-marker and back-reference text nodes are dropped from the
 * concatenated text, but their textIndex slots remain because PositionIndex
 * still counts them — keeping SDTPositions interchangeable across consumers.
 */
function buildBlockTexts(index: PositionIndex): BlockText[] {
	let byPath = new Map<string, BlockText>();
	let order: string[] = [];
	for (let entry of index.entries) {
		let block = byPath.get(entry.blockRefPath);
		if (!block) {
			block = { blockRefPath: entry.blockRefPath, text: '', mappings: [] };
			byPath.set(entry.blockRefPath, block);
			order.push(entry.blockRefPath);
		}
		if (entry.textNode.refs || entry.textNode.backRefs) continue;
		let nodeText = entry.textNode.text;
		if (!nodeText) continue;
		block.mappings.push({
			textIndex: entry.textIndex,
			absStart: block.text.length,
			absEnd: block.text.length + nodeText.length,
		});
		block.text += nodeText;
	}
	return order
		.map(path => byPath.get(path)!)
		.filter(b => b.text.trim());
}

/**
 * Segment a single block's text into ReadAloudSegments.
 */
function segmentBlock(
	block: BlockText,
	granularity: ReadAloudGranularity,
	lang: string,
): ReadAloudSegment[] {
	let sentences = splitToSentences(block.text, lang);

	if (sentences.length === 0) {
		// If sentence splitting failed, treat the whole block as one segment
		let text = block.text.trim().replace(/\s+/g, ' ');
		if (!text) return [];
		let pos = offsetRangeToSDTPosition(block, 0, block.text.length);
		if (!pos) return [];
		return [{
			text,
			position: pos,
			granularity,
			anchor: null,
		}];
	}

	if (granularity === 'paragraph') {
		return segmentBlockAsParagraphs(block, sentences, granularity);
	}
	return segmentBlockAsSentences(block, sentences, granularity);
}

/**
 * Split text into sentence ranges.
 * Returns [start, end) pairs into the text.
 */
function splitToSentences(text: string, lang: string): [number, number][] {
	return getSentenceBoundaries(lang || 'en', text)
		.filter(b => /\S/.test(b.text))
		.map(b => [b.startIndex, b.endIndex]);
}

/**
 * For sentence granularity: each sentence (possibly split further by max length)
 * becomes one segment.
 */
function segmentBlockAsSentences(
	block: BlockText,
	sentences: [number, number][],
	granularity: ReadAloudGranularity,
): ReadAloudSegment[] {
	let segments: ReadAloudSegment[] = [];

	for (let [sentStart, sentEnd] of sentences) {
		let sentText = block.text.slice(sentStart, sentEnd);
		let chunks = splitTextToChunks(sentText);

		for (let [chunkStart, chunkEnd] of chunks) {
			let text = sentText.slice(chunkStart, chunkEnd).trim().replace(/\s+/g, ' ');
			if (!text) continue;

			let sourceStart = sentStart + chunkStart;
			let sourceEnd = sentStart + chunkEnd;
			let pos = offsetRangeToSDTPosition(block, sourceStart, sourceEnd);
			if (!pos) continue;

			segments.push({
				text,
				position: pos,
				granularity,
				anchor: null,
			});
		}
	}

	return segments;
}

/**
 * Resolve a char range in the segment's normalized text to an SDTPosition
 * pointing at the corresponding chars in the underlying block.
 *
 * Two coordinate systems are involved: the TTS API works in the normalized
 * text we sent (whitespace collapsed and trimmed), while SDTPositions address
 * (text node, char offset) inside the original block text. We re-derive the
 * normalized-to-raw mapping on demand by walking the segment's source slice in
 * lockstep with its normalized form. Out-of-range indices are clamped.
 *
 * Returns null if the segment's block isn't in the index (e.g., the SDT was
 * reloaded after the segments were built).
 */
export function getSubSDTPosition(
	blocks: ReadAloudBlockIndex,
	segment: ReadAloudSegment,
	charStart: number,
	charEnd: number,
): SDTPosition | null {
	let block = blocks.get(segment.position.startBlockRefPath);
	if (!block) return null;

	let sourceRange = sourceRangeForSegment(block, segment.position);
	if (!sourceRange) return null;

	let normalizedLength = segment.text.length;
	let clampedStart = Math.max(0, Math.min(charStart, normalizedLength));
	let clampedEnd = Math.max(clampedStart, Math.min(charEnd, normalizedLength));

	// Walk the source slice and the normalized text together, recording the
	// raw offset where each requested normalized index sits
	let rawSlice = block.text.slice(sourceRange.start, sourceRange.end);
	let rawOffsetAtStart = -1;
	let rawOffsetAtEnd = -1;
	let rawOffset = 0;
	while (rawOffset < rawSlice.length && /\s/.test(rawSlice[rawOffset])) {
		rawOffset++;
	}
	for (let normalizedIndex = 0; normalizedIndex <= normalizedLength; normalizedIndex++) {
		if (normalizedIndex === clampedStart) rawOffsetAtStart = rawOffset;
		if (normalizedIndex === clampedEnd) {
			rawOffsetAtEnd = rawOffset;
			break;
		}
		if (normalizedIndex === normalizedLength) break;
		if (segment.text[normalizedIndex] === ' '
				&& rawOffset < rawSlice.length
				&& /\s/.test(rawSlice[rawOffset])) {
			while (rawOffset < rawSlice.length && /\s/.test(rawSlice[rawOffset])) {
				rawOffset++;
			}
		}
		else {
			rawOffset++;
		}
	}
	if (rawOffsetAtStart < 0 || rawOffsetAtEnd < 0) return null;

	return offsetRangeToSDTPosition(
		block,
		sourceRange.start + rawOffsetAtStart,
		sourceRange.start + rawOffsetAtEnd,
	);
}

/**
 * Translate a segment's SDTPosition (text-node-relative offsets) back to the
 * [start, end) range it covers in the block's concatenated text. The block was
 * already looked up by startBlockRefPath, so endBlockRefPath equality is
 * implicit for any well-formed in-block segment.
 */
function sourceRangeForSegment(
	block: BlockText,
	position: SDTPosition,
): { start: number; end: number } | null {
	let startMapping = block.mappings.find(m => m.textIndex === position.startTextIndex);
	let endMapping = block.mappings.find(m => m.textIndex === position.endTextIndex);
	if (!startMapping || !endMapping) return null;
	return {
		start: startMapping.absStart + position.startCharOffset,
		end: endMapping.absStart + position.endCharOffset,
	};
}

/**
 * For paragraph granularity, two segments: first sentence + rest of block.
 */
function segmentBlockAsParagraphs(
	block: BlockText,
	sentences: [number, number][],
	granularity: ReadAloudGranularity,
): ReadAloudSegment[] {
	if (sentences.length <= 1) {
		// Single sentence: treat as one paragraph segment
		return segmentBlockAsSentences(block, sentences, granularity);
	}

	let segments: ReadAloudSegment[] = [];

	// First sentence
	let [firstStart, firstEnd] = sentences[0];
	let firstSlice = block.text.slice(firstStart, firstEnd);
	let firstChunks = splitTextToChunks(firstSlice);
	for (let [chunkStart, chunkEnd] of firstChunks) {
		let text = firstSlice.slice(chunkStart, chunkEnd).trim().replace(/\s+/g, ' ');
		if (!text) continue;
		let pos = offsetRangeToSDTPosition(block, firstStart + chunkStart, firstStart + chunkEnd);
		if (!pos) continue;
		segments.push({ text, position: pos, granularity, anchor: null });
	}

	// Rest of block (all remaining sentences joined)
	let restStart = sentences[1][0];
	let restEnd = sentences[sentences.length - 1][1];
	let restSlice = block.text.slice(restStart, restEnd);
	let restChunks = splitTextToChunks(restSlice);
	for (let [chunkStart, chunkEnd] of restChunks) {
		let text = restSlice.slice(chunkStart, chunkEnd).trim().replace(/\s+/g, ' ');
		if (!text) continue;
		let pos = offsetRangeToSDTPosition(block, restStart + chunkStart, restStart + chunkEnd);
		if (!pos) continue;
		segments.push({ text, position: pos, granularity, anchor: null });
	}

	return segments;
}

/**
 * Convert a character range [start, end) in a block's concatenated text to an
 * SDTPosition by locating the start and end text-node mappings.
 */
function offsetRangeToSDTPosition(
	block: BlockText,
	start: number,
	end: number,
): SDTPosition | null {
	let startMapping = findMappingForOffset(block.mappings, start);
	let endMapping = findMappingForOffset(block.mappings, Math.max(start, end - 1));
	if (!startMapping || !endMapping) return null;

	return {
		startBlockRefPath: block.blockRefPath,
		startTextIndex: startMapping.textIndex,
		startCharOffset: start - startMapping.absStart,
		endBlockRefPath: block.blockRefPath,
		endTextIndex: endMapping.textIndex,
		endCharOffset: end - endMapping.absStart,
	};
}

/**
 * Find the mapping entry that contains the given absolute offset.
 */
function findMappingForOffset(mappings: TextNodeMapping[], offset: number): TextNodeMapping | null {
	for (let i = mappings.length - 1; i >= 0; i--) {
		if (mappings[i].absStart <= offset) {
			return mappings[i];
		}
	}
	return mappings.length > 0 ? mappings[0] : null;
}

/**
 * Compare two SDTPositions by their start coordinates.
 * Returns negative if a < b, positive if a > b, zero if equal.
 */
export function compareSDTPositions(a: SDTPosition, b: SDTPosition): number {
	let aPath = a.startBlockRefPath.split('.').map(Number);
	let bPath = b.startBlockRefPath.split('.').map(Number);
	for (let i = 0; i < Math.max(aPath.length, bPath.length); i++) {
		let ai = aPath[i] ?? -1;
		let bi = bPath[i] ?? -1;
		if (ai !== bi) return ai - bi;
	}
	if (a.startTextIndex !== b.startTextIndex) return a.startTextIndex - b.startTextIndex;
	return a.startCharOffset - b.startCharOffset;
}

/**
 * Find the segment index closest to a given SDT position.
 */
export function findSegmentIndexForSDTPosition(
	segments: ReadAloudSegment[],
	sdtPos: SDTPosition,
): number | null {
	if (!segments.length) return null;

	for (let i = 0; i < segments.length; i++) {
		let segPos = segments[i].position as SDTPosition;
		// Find the first segment whose end is at or past the target start
		let cmp = compareSDTPositions(
			{
				startBlockRefPath: segPos.endBlockRefPath,
				startTextIndex: segPos.endTextIndex,
				startCharOffset: segPos.endCharOffset,
				endBlockRefPath: segPos.endBlockRefPath,
				endTextIndex: segPos.endTextIndex,
				endCharOffset: segPos.endCharOffset,
			},
			sdtPos,
		);
		if (cmp >= 0) {
			return i;
		}
	}

	return segments.length - 1;
}

/**
 * Find the segment index for a source-format position by converting through the mapper.
 */
export function findSegmentIndexForSourcePosition(
	segments: ReadAloudSegment[],
	sourcePosition: unknown,
	mapper: { sourceToSDTPosition(position: unknown): SDTPosition | null },
): number | null {
	let sdtPos = mapper.sourceToSDTPosition(sourcePosition);
	if (!sdtPos) return null;
	return findSegmentIndexForSDTPosition(segments, sdtPos);
}
