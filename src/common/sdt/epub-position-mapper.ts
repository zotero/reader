import type {
	ContentBlockNode,
	DomAnchor,
	StructuredDocumentText,
	TextNode,
} from '../../../structured-document-text/schema';
import {
	expandSelectorMap,
	parseSelectorMapEntries,
	resolveSelectorMap,
	resolveSelectorMapRange,
} from '../../../structured-document-text/src/dom/epub/decode';
import { walkContentRangeLeafBlocks } from '../../../structured-document-text/src/range';
import type {
	AnnotationType,
	SDTPosition,
	SourcePosition,
} from '../types';
import {
	getTextNodeSpans,
	SDTPositionMapper,
	TextNodeSpan,
} from './position-mapper';
import { localOriginalToNFC } from './deltamap-invert';

/**
 * One DOM text node (CFI path) covered by an SDT text node. Multi-entry
 * selectorMaps (merged adjacent DOM text nodes) produce one entry per
 * sub-path.
 */
interface PathEntry {
	ref: number[];

	/** Assertion-stripped absolute CFI path of the DOM text node. */
	path: string;

	/** Start of this sub-path's characters within the SDT text node (NFC). */
	nodeCharStart: number;

	/** NFC length of this sub-path's characters. */
	length: number;

	deltaMap?: string;
}

export class EPUBPositionMapper implements SDTPositionMapper {
	private _structure: StructuredDocumentText;

	private _pathEntries: PathEntry[];

	private _blockEntries: { ref: number[], path: string, block: ContentBlockNode }[];

	constructor(structure: StructuredDocumentText) {
		this._structure = structure;
		this._pathEntries = [];
		this._blockEntries = [];
		this._buildIndex();
	}

	sdtToSourcePosition(pos: SDTPosition): SourcePosition | null {
		let spans = getTextNodeSpans(this._structure, pos);
		return this.textNodeSpansToSourcePosition(spans);
	}

	textNodeSpansToSourcePosition(spans: TextNodeSpan[]): SourcePosition | null {
		if (!spans.length) {
			return null;
		}
		let first = spans[0];
		let last = spans[spans.length - 1];
		let startMap = this._getExpandedSelectorMap(first);
		let endMap = this._getExpandedSelectorMap(last);
		if (!startMap || !endMap) {
			return null;
		}
		let startDeltaMap = (first.node.anchor as DomAnchor | undefined)?.deltaMap;
		let endDeltaMap = (last.node.anchor as DomAnchor | undefined)?.deltaMap;
		if (first === last) {
			return resolveSelectorMap(startMap, first.start, first.end, startDeltaMap) as SourcePosition;
		}
		return resolveSelectorMapRange(
			startMap, first.start,
			endMap, last.end,
			startDeltaMap, endDeltaMap,
		) as SourcePosition;
	}

	sourceToSDTPosition(position: SourcePosition): SDTPosition | null {
		if (!position || (position as { type?: string }).type !== 'FragmentSelector') {
			return null;
		}
		let parsed = parseCFIRange((position as { value: string }).value);
		if (!parsed) {
			return null;
		}
		let start = this._pointToContentPoint(parsed.startPath, parsed.startOffset, false);
		let end = this._pointToContentPoint(parsed.endPath, parsed.endOffset, true);
		if (!start || !end) {
			return null;
		}
		return { start, end };
	}

	transformAnnotationPosition(position: SourcePosition, _type: AnnotationType): SourcePosition {
		return position;
	}

	/**
	 * Resolve one CFI point to an SDT content point. Tries text-node paths
	 * first, then falls back to block boundaries.
	 */
	private _pointToContentPoint(path: string, offset: number | null, isEnd: boolean): number[] | null {
		let strippedPath = stripAssertions(path);

		for (let entry of this._pathEntries) {
			if (strippedPath !== entry.path) {
				continue;
			}
			// CFI offsets are in original (DOM) space; SDT text is NFC
			let localOffset = offset === null
				? (isEnd ? entry.length : 0)
				: localOriginalToNFC(entry.deltaMap, entry.nodeCharStart, offset, entry.length);
			return [...entry.ref, entry.nodeCharStart + localOffset];
		}

		for (let entry of this._blockEntries) {
			if (!cfiPathStartsWith(strippedPath, entry.path)) {
				continue;
			}
			return isEnd ? getBlockEndBoundary(entry.ref) : [...entry.ref];
		}

		return null;
	}

	private _getExpandedSelectorMap(span: TextNodeSpan): string | null {
		let blockAnchor = span.block.anchor as DomAnchor | undefined;
		let textAnchor = span.node.anchor as DomAnchor | undefined;
		if (!blockAnchor?.selectorMap || typeof textAnchor?.selectorMap !== 'string') {
			return null;
		}
		return expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
	}

	private _buildIndex() {
		let content = this._structure.content;
		walkContentRangeLeafBlocks(content, [[0], [content.length]], ({ block, ref }) => {
			let leaf = block as ContentBlockNode;
			let blockAnchor = leaf.anchor as DomAnchor | undefined;
			if (!blockAnchor?.selectorMap) {
				return;
			}
			this._blockEntries.push({
				ref: ref as number[],
				path: stripAssertions(blockAnchor.selectorMap),
				block: leaf,
			});

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
				if (typeof textAnchor?.selectorMap !== 'string') {
					continue;
				}
				let expanded = expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
				let nodeRef = [...(ref as number[]), i];
				let entries = parseSelectorMapEntries(expanded);
				if (entries) {
					let cumulative = 0;
					for (let entry of entries) {
						this._pathEntries.push({
							ref: nodeRef,
							path: stripAssertions(entry.path),
							nodeCharStart: cumulative,
							length: entry.length,
							deltaMap: textAnchor.deltaMap,
						});
						cumulative += entry.length;
					}
				}
				else {
					this._pathEntries.push({
						ref: nodeRef,
						path: stripAssertions(expanded),
						nodeCharStart: 0,
						length: node.text.length,
						deltaMap: textAnchor.deltaMap,
					});
				}
			}
		});
	}
}

function stripAssertions(cfiPath: string): string {
	return cfiPath.replace(/\[[^\]]*\]/g, '');
}

/**
 * Does `path` continue into `prefix` at a step boundary (or match exactly)?
 */
function cfiPathStartsWith(path: string, prefix: string): boolean {
	if (!path.startsWith(prefix)) {
		return false;
	}
	let next = path.charAt(prefix.length);
	return next === '' || next === '/' || next === ':' || next === '!';
}

function getBlockEndBoundary(ref: number[]): number[] {
	let end = [...ref];
	end[end.length - 1]++;
	return end;
}

/**
 * Parse an `epubcfi(...)` string into start/end paths with optional character
 * offsets. Single-point CFIs produce identical start and end paths.
 */
function parseCFIRange(value: string): {
	startPath: string;
	startOffset: number | null;
	endPath: string;
	endOffset: number | null;
} | null {
	let match = value.match(/^epubcfi\((.*)\)$/s);
	if (!match) {
		return null;
	}
	let parts = splitTopLevel(match[1]);
	let startRaw;
	let endRaw;
	if (parts.length === 3) {
		startRaw = parts[0] + parts[1];
		endRaw = parts[0] + parts[2];
	}
	else if (parts.length === 1) {
		startRaw = parts[0];
		endRaw = parts[0];
	}
	else {
		return null;
	}
	let start = splitOffset(startRaw);
	let end = splitOffset(endRaw);
	return {
		startPath: start.path,
		startOffset: start.offset,
		endPath: end.path,
		endOffset: end.offset,
	};
}

/**
 * Split a CFI on top-level commas, ignoring commas inside [assertions].
 */
function splitTopLevel(value: string): string[] {
	let parts: string[] = [];
	let depth = 0;
	let current = '';
	for (let char of value) {
		if (char === '[') {
			depth++;
		}
		else if (char === ']') {
			depth = Math.max(0, depth - 1);
		}
		else if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

function splitOffset(path: string): { path: string, offset: number | null } {
	let match = path.match(/^(.*?):(\d+)(?:\[[^\]]*\])?$/s);
	if (match) {
		return { path: match[1], offset: parseInt(match[2]) };
	}
	return { path, offset: null };
}
