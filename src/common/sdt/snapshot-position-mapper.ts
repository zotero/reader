import type {
	ContentBlockNode,
	DomAnchor,
	RefPath,
	StructuredDocumentText,
	TextNode,
} from '../../../structured-document-text/schema';
import {
	buildDomMapIndex,
	findDomMapContaining,
	generateDomMapSelector,
	matchDomMapSelector,
	type DomMapIndex,
} from '../../../structured-document-text/src/dom/snapshot/dommap';
import { nfcToOriginalLocal } from '../../../structured-document-text/src/dom/deltamap';
import { compareRefs, refKey, walkContentRangeLeafBlocks } from '../../../structured-document-text/src/range';
import type {
	AnnotationType,
	SDTPosition,
	SourcePosition,
} from '../types';
import {
	getTextNodeSpans,
	SDTPositionMapper,
} from './position-mapper';
import { localOriginalToNFC } from './deltamap-invert';

/**
 * One SDT text node located in the snapshot's body text stream. `stream` and
 * `rawLength` are in raw original characters -- the space browser-created
 * WADM TextPositionSelectors are measured in -- while the node's text is
 * whitespace-collapsed and NFC-normalized; `deltaMap` translates between the
 * two.
 */
interface StreamEntry {
	ref: number[];

	/** Body-stream offset of the node's first character. */
	stream: number;

	/** Raw character length of the node's source text. */
	rawLength: number;

	/** Length of the node's (collapsed, NFC) text. */
	nfcLength: number;

	deltaMap?: string;
}

export class SnapshotPositionMapper implements SDTPositionMapper {
	private _structure: StructuredDocumentText;

	/** All anchored text nodes, ordered by stream offset. */
	private _entries: StreamEntry[] = [];

	private _entriesByRef = new Map<string, StreamEntry>();

	private _domMapIndex: DomMapIndex | null;

	constructor(structure: StructuredDocumentText) {
		this._structure = structure;
		this._domMapIndex = buildDomMapIndex(structure.catalog.domMap);
		this._buildIndex();
	}

	sdtToSourcePosition(pos: SDTPosition): SourcePosition | null {
		let spans = getTextNodeSpans(this._structure, pos);
		let start: number | null = null;
		let end: number | null = null;
		for (let span of spans) {
			let entry = this._entriesByRef.get(refKey(span.ref as RefPath));
			if (!entry) {
				// Synthetic node (<br> newline, image alt text) with no
				// source text of its own
				continue;
			}
			if (start === null) {
				start = entry.stream + nfcToOriginalLocal(entry.deltaMap, 0, span.start);
			}
			end = entry.stream + nfcToOriginalLocal(entry.deltaMap, 0, span.end);
		}
		if (start === null || end === null || end <= start) {
			return null;
		}
		return this._streamRangeToSelector(start, end);
	}

	sourceToSDTPosition(position: SourcePosition): SDTPosition | null {
		let range = this._selectorToStreamRange(position);
		if (!range) {
			return null;
		}
		let start = this._streamPointToContentPoint(range.start, false);
		let end = range.end === range.start
			? start
			: this._streamPointToContentPoint(range.end, true);
		if (!start || !end || compareRefs(start as RefPath, end as RefPath) > 0) {
			return null;
		}
		return { start, end };
	}

	transformAnnotationPosition(position: SourcePosition, _type: AnnotationType): SourcePosition {
		return position;
	}

	/**
	 * Build the optimal selector for a body-stream range: the deepest element
	 * containing the whole range, refined by element-relative text positions
	 * unless the range covers the element's text exactly.
	 */
	private _streamRangeToSelector(start: number, end: number): SourcePosition {
		let containing = this._domMapIndex
			? findDomMapContaining(this._domMapIndex, start, end)
			: null;
		if (!containing) {
			// Only <body> contains the range; stream offsets are body-relative
			// text positions already
			return { type: 'TextPositionSelector', start, end };
		}
		let value = generateDomMapSelector(containing);
		if (start === containing.node.textStart
				&& end === containing.node.textStart + containing.node.textLength) {
			return { type: 'CssSelector', value };
		}
		return {
			type: 'CssSelector',
			value,
			refinedBy: {
				type: 'TextPositionSelector',
				start: start - containing.node.textStart,
				end: end - containing.node.textStart,
			},
		};
	}

	/**
	 * Convert an incoming position to a body-stream range. Handles
	 * CssSelectors rooted at any element in the domMap and bare
	 * (body-relative) TextPositionSelectors.
	 */
	private _selectorToStreamRange(position: SourcePosition): { start: number, end: number } | null {
		if (!('type' in position)) {
			return null;
		}
		if (position.type === 'TextPositionSelector') {
			return { start: position.start, end: position.end };
		}
		if (position.type !== 'CssSelector' || !this._domMapIndex) {
			return null;
		}
		let matched = matchDomMapSelector(this._domMapIndex, position.value);
		if (!matched) {
			return null;
		}
		let refinedBy = position.refinedBy;
		if (refinedBy?.type === 'TextPositionSelector') {
			return {
				start: matched.node.textStart + refinedBy.start,
				end: matched.node.textStart + refinedBy.end,
			};
		}
		return {
			start: matched.node.textStart,
			end: matched.node.textStart + matched.node.textLength,
		};
	}

	/**
	 * Map a body-stream offset to an SDT content point, clamping into the
	 * nearest text node when the offset falls in a gap (whitespace between
	 * blocks, or text the extraction didn't keep).
	 */
	private _streamPointToContentPoint(streamPos: number, isEnd: boolean): number[] | null {
		let entry = isEnd
			? this._lastEntryStartingBefore(streamPos)
			: this._firstEntryEndingAfter(streamPos);
		if (!entry) {
			return null;
		}
		let localRaw = Math.max(0, Math.min(streamPos - entry.stream, entry.rawLength));
		let localNFC = localOriginalToNFC(entry.deltaMap, 0, localRaw, entry.nfcLength);
		return [...entry.ref, localNFC];
	}

	private _firstEntryEndingAfter(streamPos: number): StreamEntry | null {
		let entries = this._entries;
		let lo = 0;
		let hi = entries.length;
		while (lo < hi) {
			let mid = (lo + hi) >> 1;
			if (entries[mid].stream + entries[mid].rawLength <= streamPos) {
				lo = mid + 1;
			}
			else {
				hi = mid;
			}
		}
		return lo < entries.length ? entries[lo] : null;
	}

	private _lastEntryStartingBefore(streamPos: number): StreamEntry | null {
		let entries = this._entries;
		let lo = 0;
		let hi = entries.length;
		while (lo < hi) {
			let mid = (lo + hi) >> 1;
			if (entries[mid].stream < streamPos) {
				lo = mid + 1;
			}
			else {
				hi = mid;
			}
		}
		return lo > 0 ? entries[lo - 1] : null;
	}

	private _buildIndex() {
		let content = this._structure.content;
		walkContentRangeLeafBlocks(content, [[0], [content.length]], ({ block, ref }) => {
			let nodes = (block as ContentBlockNode).content as TextNode[] | undefined;
			if (!nodes) {
				return;
			}
			for (let i = 0; i < nodes.length; i++) {
				let node = nodes[i];
				if (typeof node?.text !== 'string') {
					continue;
				}
				let anchor = node.anchor as DomAnchor | undefined;
				if (typeof anchor?.stream !== 'number') {
					continue;
				}
				let entry: StreamEntry = {
					ref: [...(ref as number[]), i],
					stream: anchor.stream,
					rawLength: nfcToOriginalLocal(anchor.deltaMap, 0, node.text.length),
					nfcLength: node.text.length,
					deltaMap: anchor.deltaMap,
				};
				this._entries.push(entry);
				this._entriesByRef.set(refKey(entry.ref as RefPath), entry);
			}
		});
		this._entries.sort((a, b) => a.stream - b.stream);
	}
}
