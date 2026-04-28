import type {
	StructuredDocumentText,
	ContentBlockNode,
	TextNode,
	ListItemNode,
	TableRowNode,
} from '../../../structured-document-text/schema';
import { getNestedBlockPlainText } from '../../../structured-document-text/src/text';
import { getSentenceBoundaries } from 'sentencex-ts';
import type { ReadAloudGranularity, ReadAloudSegment, SDTPosition } from '../types';
import { splitTextToChunks } from './segment-split';
import { detectLang } from '../lib/detect-lang';
import { getBaseLanguage } from './lang';
import { isTextNodeArray } from '../../dom/sdt/lib/utilities';

/**
 * A char-offset mapping entry: tracks which (blockRefPath, textIndex, charOffset)
 * corresponds to each character in the concatenated block text.
 */
interface CharMapping {
	blockRefPath: string;
	textIndex: number;

	/** Start char offset within this text node. */
	nodeCharStart: number;

	/** Absolute start offset in the concatenated block text. */
	absStart: number;

	/** Absolute end offset (exclusive) in the concatenated block text. */
	absEnd: number;
}

/**
 * One leaf block's concatenated text with its char mapping.
 */
interface BlockText {
	blockRefPath: string;
	text: string;
	mappings: CharMapping[];
}

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
	granularity: ReadAloudGranularity,
	lang?: string,
): ReadAloudSegment[] {
	let blockTexts = extractBlockTexts(sdt.content);
	let detectedLang = lang || getSDTLang(sdt);
	let segments: ReadAloudSegment[] = [];

	for (let bt of blockTexts) {
		let trimmed = bt.text.trim();
		if (!trimmed) continue;

		let blockSegments = segmentBlock(bt, granularity, detectedLang);
		if (blockSegments.length) {
			blockSegments[0].anchor = 'paragraphStart';
		}
		segments.push(...blockSegments);
	}

	return segments;
}

/**
 * Walk the SDT content tree and extract concatenated text for each leaf block.
 */
function extractBlockTexts(content: ContentBlockNode[]): BlockText[] {
	let result: BlockText[] = [];
	for (let [i, block] of content.entries()) {
		if (block.artifact) continue;
		walkBlock(block, String(i), result);
	}
	return result;
}

function walkBlock(block: ContentBlockNode, refPath: string, result: BlockText[]): void {
	let content = block.content;
	if (!content || content.length === 0) return;

	if (isTextNodeArray(content)) {
		collectTextNodes(content, refPath, result);
		return;
	}

	// Container blocks: blockquote, list, table
	switch (block.type) {
		case 'blockquote':
			for (let [i, child] of block.content.entries()) {
				walkBlock(child, `${refPath}.${i}`, result);
			}
			break;
		case 'list':
			for (let [i, item] of block.content.entries()) {
				walkListItem(item, `${refPath}.${i}`, result);
			}
			break;
		case 'table':
			if (!isTextNodeArray(block.content)) {
				for (let [i, row] of (block.content as TableRowNode[]).entries()) {
					for (let [j, cell] of row.content.entries()) {
						for (let [k, cellBlock] of cell.content.entries()) {
							walkBlock(cellBlock, `${refPath}.${i}.${j}.${k}`, result);
						}
					}
				}
			}
			break;
	}
}

function walkListItem(item: ListItemNode, refPath: string, result: BlockText[]): void {
	if (!item.content || item.content.length === 0) return;
	if (item.artifact) return;

	if (isTextNodeArray(item.content)) {
		collectTextNodes(item.content, refPath, result);
	}
	else {
		for (let [j, child] of (item.content as ContentBlockNode[]).entries()) {
			walkBlock(child, `${refPath}.${j}`, result);
		}
	}
}

function collectTextNodes(textNodes: TextNode[], refPath: string, result: BlockText[]): void {
	let text = '';
	let mappings: CharMapping[] = [];

	for (let [i, textNode] of textNodes.entries()) {
		let nodeText = textNode.text;
		if (!nodeText) continue;
		// Skip reference markers and back-reference targets (e.g. "[1]", footnote numbers)
		// but keep textIndex counting intact so positions align with the PositionIndex
		if (textNode.refs || textNode.backRefs) continue;
		mappings.push({
			blockRefPath: refPath,
			textIndex: i,
			nodeCharStart: 0,
			absStart: text.length,
			absEnd: text.length + nodeText.length,
		});
		text += nodeText;
	}

	if (text.trim()) {
		result.push({ blockRefPath: refPath, text, mappings });
	}
}

/**
 * Segment a single block's text into ReadAloudSegments.
 */
function segmentBlock(
	bt: BlockText,
	granularity: ReadAloudGranularity,
	lang: string,
): ReadAloudSegment[] {
	let sentences = splitToSentences(bt.text, lang);

	if (sentences.length === 0) {
		// If sentence splitting failed, treat the whole block as one segment
		let text = bt.text.trim().replace(/\s+/g, ' ');
		if (!text) return [];
		let pos = charRangeToSDTPosition(bt, 0, bt.text.length);
		if (!pos) return [];
		return [{
			text,
			position: pos,
			granularity,
			anchor: null,
		}];
	}

	if (granularity === 'paragraph') {
		return segmentBlockAsParagraphs(bt, sentences, granularity);
	}
	return segmentBlockAsSentences(bt, sentences, granularity);
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
	bt: BlockText,
	sentences: [number, number][],
	granularity: ReadAloudGranularity,
): ReadAloudSegment[] {
	let segments: ReadAloudSegment[] = [];

	for (let [sentStart, sentEnd] of sentences) {
		let sentText = bt.text.slice(sentStart, sentEnd);
		let chunks = splitTextToChunks(sentText);

		for (let [chunkStart, chunkEnd] of chunks) {
			let text = sentText.slice(chunkStart, chunkEnd).trim().replace(/\s+/g, ' ');
			if (!text) continue;

			let pos = charRangeToSDTPosition(bt, sentStart + chunkStart, sentStart + chunkEnd);
			if (!pos) continue;

			segments.push({
				text,
				position: pos,
				granularity,
				anchor: null
			});
		}
	}

	return segments;
}

/**
 * For paragraph granularity, two segments: first sentence + rest of block.
 */
function segmentBlockAsParagraphs(
	bt: BlockText,
	sentences: [number, number][],
	granularity: ReadAloudGranularity,
): ReadAloudSegment[] {
	if (sentences.length <= 1) {
		// Single sentence: treat as one paragraph segment
		return segmentBlockAsSentences(bt, sentences, granularity);
	}

	let segments: ReadAloudSegment[] = [];

	// First sentence
	let [firstStart, firstEnd] = sentences[0];
	let firstSlice = bt.text.slice(firstStart, firstEnd);
	let firstChunks = splitTextToChunks(firstSlice);
	for (let [chunkStart, chunkEnd] of firstChunks) {
		let text = firstSlice.slice(chunkStart, chunkEnd).trim().replace(/\s+/g, ' ');
		if (!text) continue;
		let pos = charRangeToSDTPosition(bt, firstStart + chunkStart, firstStart + chunkEnd);
		if (!pos) continue;
		segments.push({ text, position: pos, granularity, anchor: null });
	}

	// Rest of block (all remaining sentences joined)
	let restStart = sentences[1][0];
	let restEnd = sentences[sentences.length - 1][1];
	let restSlice = bt.text.slice(restStart, restEnd);
	let restChunks = splitTextToChunks(restSlice);
	for (let [chunkStart, chunkEnd] of restChunks) {
		let text = restSlice.slice(chunkStart, chunkEnd).trim().replace(/\s+/g, ' ');
		if (!text) continue;
		let pos = charRangeToSDTPosition(bt, restStart + chunkStart, restStart + chunkEnd);
		if (!pos) continue;
		segments.push({ text, position: pos, granularity, anchor: null });
	}

	return segments;
}

/**
 * Convert a character range [start, end) in a BlockText to a SDTPosition.
 */
function charRangeToSDTPosition(bt: BlockText, start: number, end: number): SDTPosition | null {
	let startMapping = findMappingForOffset(bt.mappings, start);
	let endMapping = findMappingForOffset(bt.mappings, Math.max(start, end - 1));
	if (!startMapping || !endMapping) return null;

	return {
		startBlockRefPath: startMapping.blockRefPath,
		startTextIndex: startMapping.textIndex,
		startCharOffset: start - startMapping.absStart,
		endBlockRefPath: endMapping.blockRefPath,
		endTextIndex: endMapping.textIndex,
		endCharOffset: end - endMapping.absStart,
	};
}

/**
 * Find the mapping entry that contains the given absolute offset.
 */
function findMappingForOffset(mappings: CharMapping[], offset: number): CharMapping | null {
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
