import type {
	ContentBlockNode,
	DomAnchor,
	StructuredDocumentText,
	TextNode,
} from '../../../structured-document-text/schema';
import {
	expandBlockAnchor,
	expandSelectorMap,
	parseSelectorMap,
	parseSelectorMapEntries,
	resolveSelectorMap,
} from '../../../structured-document-text/src/dom/snapshot/decode';
import { nfcToOriginalLocal } from '../../../structured-document-text/src/dom/deltamap';
import { refKey, walkContentRangeLeafBlocks } from '../../../structured-document-text/src/range';
import type {
	AnnotationType,
	SDTPosition,
	SourcePosition,
} from '../types';
import {
	getTextNodeSpans,
	SDTPositionMapper,
	spansCoverWholeBlock,
	TextNodeSpan,
} from './position-mapper';
import { localOriginalToNFC } from './deltamap-invert';

type CssSelectorPosition = {
	type: 'CssSelector';
	value: string;
	refinedBy?: { type: 'TextPositionSelector', start: number, end: number };
};

/**
 * One DOM text node covered by an SDT text node. Multi-entry selectorMaps
 * (merged adjacent DOM text nodes) produce one entry per sub-entry.
 *
 * TextPositionSelector offsets count original DOM characters; SDT positions
 * count NFC characters within the SDT text node. `deltaMap` translates
 * between the two.
 */
interface SnapshotEntry {
	ref: number[];

	/** NFC offset of this entry's characters within the SDT text node. */
	nodeCharStart: number;

	/** NFC length of this entry. */
	length: number;

	deltaMap?: string;

	/** CSS selector of the containing element. */
	selector: string;

	/** Original-space offset within the containing element's text. */
	elementOffset: number;

	/**
	 * Original-space offset within the block element's text. Exact for
	 * entries directly under the block (the extraction stores those);
	 * estimated across runs inside child elements.
	 */
	blockOffset: number;

	/** Original-space length (approximate when whitespace was collapsed). */
	origLength: number;
}

interface BlockEntry {
	ref: number[];
	selector: string;
	entries: SnapshotEntry[];
}

export class SnapshotPositionMapper implements SDTPositionMapper {
	private _structure: StructuredDocumentText;

	private _entriesBySelector = new Map<string, SnapshotEntry[]>();

	private _blocksBySelector = new Map<string, BlockEntry>();

	private _entriesByNode = new Map<string, SnapshotEntry[]>();

	private _blocksByRef = new Map<string, BlockEntry>();

	constructor(structure: StructuredDocumentText) {
		this._structure = structure;
		this._buildIndex();
	}

	sdtToSourcePosition(pos: SDTPosition): SourcePosition | null {
		let spans = getTextNodeSpans(this._structure, pos);
		if (!spans.length) {
			return null;
		}

		// A whole block maps cleanly to its own selector
		if (spansCoverWholeBlock(spans)) {
			let blockAnchor = spans[0].block.anchor as DomAnchor | undefined;
			if (blockAnchor?.selectorMap) {
				return expandBlockAnchor(blockAnchor.selectorMap) as SourcePosition;
			}
		}

		let first = spans[0];
		let last = spans[spans.length - 1];
		if (first === last) {
			return this._resolveSpan(first) as SourcePosition;
		}

		// Multiple text nodes: when both endpoints resolve within the same
		// element, TextPositionSelector offsets are element-relative and the
		// range can span freely
		let start = this._resolvePoint(first, first.start, false);
		let end = this._resolvePoint(last, last.end, true);
		if (start && end) {
			if (start.entry.selector === end.entry.selector) {
				return {
					type: 'CssSelector',
					value: start.entry.selector,
					refinedBy: {
						type: 'TextPositionSelector',
						start: start.entry.elementOffset + start.localOrig,
						end: end.entry.elementOffset + end.localOrig,
					},
				} as SourcePosition;
			}
			// Otherwise resolve both endpoints against the block element --
			// they can live in different child elements, and offsets relative
			// to the block span across them
			let block = this._getBlock(start.entry.ref);
			if (block && block === this._getBlock(end.entry.ref)) {
				return {
					type: 'CssSelector',
					value: block.selector,
					refinedBy: {
						type: 'TextPositionSelector',
						start: start.entry.blockOffset + start.localOrig,
						end: end.entry.blockOffset + end.localOrig,
					},
				} as SourcePosition;
			}
		}

		// Cross-block range (the DOM extractors don't produce part chains,
		// so this is rare): fall back to spanning the first block whole
		let blockAnchor = first.block.anchor as DomAnchor | undefined;
		if (blockAnchor?.selectorMap) {
			return expandBlockAnchor(blockAnchor.selectorMap) as SourcePosition;
		}
		return this._resolveSpan(first) as SourcePosition;
	}

	sourceToSDTPosition(position: SourcePosition): SDTPosition | null {
		if (!position || (position as { type?: string }).type !== 'CssSelector') {
			return null;
		}
		let selector = position as CssSelectorPosition;
		let block = this._blocksBySelector.get(selector.value);
		let elementEntries = this._entriesBySelector.get(selector.value);

		let startOffset = selector.refinedBy?.start ?? null;
		let endOffset = selector.refinedBy?.end ?? null;
		if (startOffset === null || endOffset === null) {
			let entries = block?.entries ?? elementEntries;
			if (!entries?.length) {
				return null;
			}
			let first = entries[0];
			let last = entries[entries.length - 1];
			return {
				start: [...first.ref, first.nodeCharStart],
				end: [...last.ref, last.nodeCharStart + last.length],
			};
		}

		// Selectors created against a block element use block-relative
		// offsets; ones created against the text's own element use
		// element-relative offsets. Try whichever the selector names
		for (let useBlock of [true, false]) {
			let entries = useBlock ? block?.entries : elementEntries;
			if (!entries?.length) {
				continue;
			}
			let start = findPointInEntries(entries, startOffset, false, useBlock);
			let end = findPointInEntries(entries, endOffset, true, useBlock);
			if (start && end) {
				return { start, end };
			}
		}

		return null;
	}

	transformAnnotationPosition(position: SourcePosition, _type: AnnotationType): SourcePosition {
		return position;
	}

	/**
	 * Resolve a single span with the decode module (handles multi-entry
	 * selectorMaps and deltaMaps).
	 */
	private _resolveSpan(span: TextNodeSpan): CssSelectorPosition | null {
		let blockAnchor = span.block.anchor as DomAnchor | undefined;
		let textAnchor = span.node.anchor as DomAnchor | undefined;
		if (!blockAnchor?.selectorMap || !textAnchor) {
			return null;
		}
		let expanded = expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
		return resolveSelectorMap(expanded, span.start, span.end, textAnchor.deltaMap) as CssSelectorPosition;
	}

	/**
	 * Resolve one endpoint of a span to its index entry and a local
	 * original-space offset within it.
	 */
	private _resolvePoint(span: TextNodeSpan, nodeNFCOffset: number, isEnd: boolean): {
		entry: SnapshotEntry;
		localOrig: number;
	} | null {
		let entries = this._entriesByNode.get(refKey(span.ref));
		if (!entries?.length) {
			return null;
		}
		let entry = entries.find(e => (isEnd
			? nodeNFCOffset > e.nodeCharStart && nodeNFCOffset <= e.nodeCharStart + e.length
			: nodeNFCOffset >= e.nodeCharStart && nodeNFCOffset < e.nodeCharStart + e.length))
			?? entries[isEnd ? entries.length - 1 : 0];
		let localNFC = Math.max(0, Math.min(nodeNFCOffset - entry.nodeCharStart, entry.length));
		return {
			entry,
			localOrig: nfcToOriginalLocal(entry.deltaMap, entry.nodeCharStart, localNFC),
		};
	}

	private _getBlock(nodeRef: number[]): BlockEntry | null {
		return this._blocksByRef.get(refKey(nodeRef.slice(0, -1))) ?? null;
	}

	private _buildIndex() {
		let content = this._structure.content;
		walkContentRangeLeafBlocks(content, [[0], [content.length]], ({ block, ref }) => {
			let leaf = block as ContentBlockNode;
			let blockAnchor = leaf.anchor as DomAnchor | undefined;
			if (!blockAnchor?.selectorMap) {
				return;
			}
			let blockEntry: BlockEntry = {
				ref: ref as number[],
				selector: blockAnchor.selectorMap,
				entries: [],
			};
			this._blocksBySelector.set(blockEntry.selector, blockEntry);
			this._blocksByRef.set(refKey(ref), blockEntry);

			let nodes = leaf.content as TextNode[] | undefined;
			if (!nodes) {
				return;
			}
			for (let i = 0; i < nodes.length; i++) {
				let node = nodes[i];
				if (typeof node?.text !== 'string') {
					continue;
				}
				let textAnchor = node.anchor as DomAnchor | undefined;
				if (!textAnchor) {
					continue;
				}
				let expanded = expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
				let nodeRef = [...(ref as number[]), i];
				let nodeEntries: SnapshotEntry[] = [];
				let subEntries = parseSelectorMapEntries(expanded);
				if (subEntries) {
					let cumulative = 0;
					for (let subEntry of subEntries) {
						nodeEntries.push(this._makeEntry(
							nodeRef, subEntry.selectorMap, cumulative, subEntry.length, textAnchor.deltaMap
						));
						cumulative += subEntry.length;
					}
				}
				else {
					nodeEntries.push(this._makeEntry(nodeRef, expanded, 0, node.text.length, textAnchor.deltaMap));
				}
				this._entriesByNode.set(refKey(nodeRef), nodeEntries);
				blockEntry.entries.push(...nodeEntries);
			}

			computeBlockOffsets(blockEntry);
		});
	}

	private _makeEntry(
		ref: number[],
		selectorMap: string,
		nodeCharStart: number,
		length: number,
		deltaMap: string | undefined,
	): SnapshotEntry {
		let { selector, offset } = parseSelectorMap(selectorMap);
		let entry: SnapshotEntry = {
			ref,
			nodeCharStart,
			length,
			deltaMap,
			selector,
			elementOffset: offset,
			// Filled in by computeBlockOffsets()
			blockOffset: 0,
			origLength: nfcToOriginalLocal(deltaMap, nodeCharStart, length),
		};
		let list = this._entriesBySelector.get(selector);
		if (!list) {
			list = [];
			this._entriesBySelector.set(selector, list);
		}
		list.push(entry);
		return entry;
	}
}

/**
 * Compute each entry's original-space offset within the block element.
 * Entries directly under the block carry exact stored offsets; entries in
 * child elements are anchored to a running estimate at the element start,
 * which re-synchronizes at every directly-stored offset.
 */
function computeBlockOffsets(block: BlockEntry) {
	let estimate = 0;
	let childSelector: string | null = null;
	let childBase = 0;
	for (let entry of block.entries) {
		if (entry.selector === block.selector) {
			// Exact: the stored offset is relative to the block element
			// itself (and 0 when unstored, which means sole child)
			entry.blockOffset = entry.elementOffset;
			childSelector = null;
		}
		else {
			if (entry.selector !== childSelector) {
				childSelector = entry.selector;
				childBase = estimate;
			}
			entry.blockOffset = childBase + entry.elementOffset;
		}
		estimate = Math.max(estimate, entry.blockOffset + entry.origLength);
	}
}

/**
 * Find the SDT content point for an original-space character offset,
 * measured relative to the element (useBlock = false) or the block
 * (useBlock = true).
 */
function findPointInEntries(
	entries: SnapshotEntry[],
	offset: number,
	isEnd: boolean,
	useBlock: boolean,
): number[] | null {
	let best: SnapshotEntry | null = null;
	for (let entry of entries) {
		let entryStart = useBlock ? entry.blockOffset : entry.elementOffset;
		let entryEnd = entryStart + entry.origLength;
		if (isEnd ? (offset > entryStart && offset <= entryEnd) : (offset >= entryStart && offset < entryEnd)) {
			best = entry;
			break;
		}
		// Track the closest preceding entry in case the offset falls in a
		// gap (text not captured by extraction)
		if (!best || entryStart <= offset) {
			best = entry;
		}
	}
	if (!best) {
		return null;
	}
	let bestStart = useBlock ? best.blockOffset : best.elementOffset;
	let localOrig = Math.max(0, Math.min(offset - bestStart, best.origLength));
	let localNFC = localOriginalToNFC(best.deltaMap, best.nodeCharStart, localOrig, best.length);
	return [...best.ref, best.nodeCharStart + localNFC];
}
