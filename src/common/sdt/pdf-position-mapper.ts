import type {
	ContentBlockNode,
	PageContentRange,
	PdfAnchor,
	StructuredDocumentText,
	TextNode,
} from '../../../structured-document-text/schema';
import {
	buildRunData,
	parseTextMap,
} from '../../../structured-document-text/src/pdf/decode';
import { isWhitespaceChar } from '../../../structured-document-text/src/pdf/utils';
import { refKey, walkContentRangeLeafBlocks } from '../../../structured-document-text/src/range';
import type {
	AnnotationType,
	PDFPosition,
	SDTPosition,
	SourcePosition,
} from '../types';
import { PDF_NOTE_DIMENSIONS } from '../defines';
import {
	getTextNodeSpans,
	type SDTPositionMapper,
	type TextNodeSpan,
} from './position-mapper';

interface RunDatum {
	rect: number[];
	pageIndex: number;
	vertical: boolean;
}

interface CachedRunData {
	data: RunDatum[] | null;
	weight: number;
}

const DEFAULT_RUN_DATA_CACHE_WEIGHT = 100_000;

export class PDFPositionMapper implements SDTPositionMapper {
	private _structure: StructuredDocumentText;

	private _runDataCache = new Map<string, CachedRunData>();

	private _runDataCacheWeight = 0;

	private _maxRunDataCacheWeight: number;

	constructor(
		structure: StructuredDocumentText,
		{ maxRunDataCacheWeight = DEFAULT_RUN_DATA_CACHE_WEIGHT }: { maxRunDataCacheWeight?: number } = {},
	) {
		this._structure = structure;
		this._maxRunDataCacheWeight = Math.max(0, maxRunDataCacheWeight);
	}

	sdtToSourcePosition(pos: SDTPosition): SourcePosition | null {
		let spans = getTextNodeSpans(this._structure, pos);
		return this.textNodeSpansToSourcePosition(spans);
	}

	textNodeSpansToSourcePosition(spans: TextNodeSpan[]): SourcePosition | null {
		// Keep geometry on either side of an omitted block separate. Semantic
		// projections can provide non-contiguous spans, and merging every rect on
		// a line would paint one large rect over the omitted content.
		let rectGroupsByPage = new Map<number, Map<number, number[][]>>();
		let addRect = (pageIndex: number, groupIndex: number, rect: number[]) => {
			let groups = rectGroupsByPage.get(pageIndex);
			if (!groups) {
				groups = new Map();
				rectGroupsByPage.set(pageIndex, groups);
			}
			let rects = groups.get(groupIndex);
			if (!rects) {
				rects = [];
				groups.set(groupIndex, rects);
			}
			rects.push(rect);
		};

		let groupIndex = 0;
		let previousBlockIndex: number | null = null;
		for (let span of spans) {
			let blockIndex = span.blockRef[0];
			if (previousBlockIndex !== null && blockIndex > previousBlockIndex + 1) {
				groupIndex++;
			}
			previousBlockIndex = blockIndex;
			let runData = this._getRunData(span.node, span.ref);
			if (runData) {
				// Run entries correspond to the node's non-whitespace characters
				let runIndex = 0;
				for (let ci = 0; ci < span.node.text.length && runIndex < runData.length; ci++) {
					if (isWhitespaceChar(span.node.text[ci])) {
						continue;
					}
					let run = runData[runIndex++];
					if (ci >= span.start && ci < span.end) {
						addRect(run.pageIndex, groupIndex, run.rect);
					}
				}
			}
			else {
				for (let pageRect of this._getFallbackPageRects(span)) {
					addRect(pageRect[0], groupIndex, pageRect.slice(1, 5));
				}
			}
		}

		if (!rectGroupsByPage.size) {
			return null;
		}

		let pages = [...rectGroupsByPage.keys()].sort((a, b) => a - b);
		// Reader PDF positions can describe only one page or two adjacent
		// pages. Returning a partial position would silently move or truncate
		// an annotation, so reject ranges the source model cannot represent.
		if (pages.length > 2 || (pages.length === 2 && pages[1] !== pages[0] + 1)) {
			return null;
		}
		let getPageRects = (pageIndex: number) => [...rectGroupsByPage.get(pageIndex)!.values()]
			.flatMap(rects => mergeLineRects(rects));
		let position: PDFPosition = {
			pageIndex: pages[0],
			rects: getPageRects(pages[0]),
		};
		if (pages.length > 1) {
			position.nextPageRects = getPageRects(pages[1]);
		}
		return position;
	}

	sourceToSDTPosition(position: SourcePosition): SDTPosition | null {
		let pos = position as PDFPosition;
		if (!Number.isInteger(pos.pageIndex) || !pos.rects?.length) {
			return null;
		}

		let targets = [{ pageIndex: pos.pageIndex, rects: pos.rects }];
		if (pos.nextPageRects?.length) {
			targets.push({ pageIndex: pos.pageIndex + 1, rects: pos.nextPageRects });
		}

		let start: number[] | null = null;
		let end: number[] | null = null;
		for (let { pageIndex, rects } of targets) {
			let contentRange = this._structure.catalog.pages[pageIndex]?.contentRange;
			if (!contentRange) {
				continue;
			}
			// Page content ranges can start/end mid-block when a block
			// spans pages. Widen to whole blocks and filter by rect.
			let walkRange: PageContentRange = [
				[contentRange[0][0]],
				[Math.min(contentRange[1][0] + 1, this._structure.content.length)],
			];
			// eslint-disable-next-line no-loop-func
			walkContentRangeTextNodes(this._structure.content, walkRange, (node, ref) => {
				let runData = this._getRunData(node, ref);
				if (runData) {
					let runIndex = 0;
					for (let ci = 0; ci < node.text.length && runIndex < runData.length; ci++) {
						if (isWhitespaceChar(node.text[ci])) {
							continue;
						}
						let run = runData[runIndex++];
						if (run.pageIndex !== pageIndex || !rects.some(rect => quickIntersectRect(rect, run.rect))) {
							continue;
						}
						if (!start) {
							start = [...ref, ci];
						}
						end = [...ref, ci + 1];
					}
				}
				else {
					let pageRects = (node.anchor as PdfAnchor | undefined)?.pageRects;
					let intersects = pageRects?.some(pageRect => pageRect[0] === pageIndex
						&& rects.some(rect => quickIntersectRect(rect, pageRect.slice(1, 5))));
					if (intersects) {
						if (!start) {
							start = [...ref, 0];
						}
						end = [...ref, node.text.length];
					}
				}
			});
		}

		if (!start || !end) {
			return null;
		}
		return { start, end };
	}

	transformAnnotationPosition(position: SourcePosition, type: AnnotationType): SourcePosition {
		if (type !== 'note') {
			return position;
		}
		// Notes are fixed-size rects at the top-right of the range
		let pos = position as PDFPosition;
		if (!pos.rects?.length) {
			return position;
		}
		let right = Math.max(...pos.rects.map(rect => rect[2]));
		let top = Math.max(...pos.rects.map(rect => rect[3]));
		return {
			pageIndex: pos.pageIndex,
			rects: [[
				right - PDF_NOTE_DIMENSIONS,
				top - PDF_NOTE_DIMENSIONS,
				right,
				top,
			]],
		};
	}

	clearCache(): void {
		this._runDataCache.clear();
		this._runDataCacheWeight = 0;
	}

	private _getRunData(node: TextNode, ref: number[]): RunDatum[] | null {
		let key = refKey(ref);
		let cached = this._runDataCache.get(key);
		if (cached) {
			// Refresh insertion order so bounded caches evict the least
			// recently used node.
			this._runDataCache.delete(key);
			this._runDataCache.set(key, cached);
			return cached.data;
		}
		let textMap = (node.anchor as PdfAnchor | undefined)?.textMap;
		let runData = textMap ? buildRunData(parseTextMap(textMap)) as RunDatum[] : null;
		if (runData && !runData.length) {
			runData = null;
		}
		let weight = Math.max(1, runData?.length ?? 0);
		if (weight <= this._maxRunDataCacheWeight) {
			while (this._runDataCacheWeight + weight > this._maxRunDataCacheWeight) {
				let oldest = this._runDataCache.entries().next().value;
				if (!oldest) {
					break;
				}
				this._runDataCache.delete(oldest[0]);
				this._runDataCacheWeight -= oldest[1].weight;
			}
			this._runDataCache.set(key, { data: runData, weight });
			this._runDataCacheWeight += weight;
		}
		return runData;
	}

	private _getFallbackPageRects(span: TextNodeSpan): number[][] {
		let nodeRects = (span.node.anchor as PdfAnchor | undefined)?.pageRects;
		if (nodeRects?.length) {
			return nodeRects;
		}
		return span.node.text.trim()
			? (span.block.anchor as PdfAnchor | undefined)?.pageRects ?? []
			: [];
	}
}

/**
 * Visit every text node of every leaf block within a content range.
 */
function walkContentRangeTextNodes(
	content: ContentBlockNode[],
	range: PageContentRange,
	callback: (node: TextNode, ref: number[]) => void,
) {
	walkContentRangeLeafBlocks(content, range, ({ block, ref }) => {
		let nodes = (block as ContentBlockNode).content as TextNode[] | undefined;
		if (!nodes) {
			return;
		}
		for (let i = 0; i < nodes.length; i++) {
			if (typeof nodes[i]?.text === 'string') {
				callback(nodes[i], [...ref, i]);
			}
		}
	});
}

function quickIntersectRect(r1: number[], r2: number[]): boolean {
	return r2[0] < r1[2]
		&& r2[2] > r1[0]
		&& r2[1] < r1[3]
		&& r2[3] > r1[1];
}

/**
 * Merge per-character rects into one rect per visual line.
 */
function mergeLineRects(rects: number[][]): number[][] {
	let merged: number[][] = [];
	let current: number[] | null = null;
	for (let rect of rects) {
		if (current && sameLine(current, rect)) {
			current[0] = Math.min(current[0], rect[0]);
			current[1] = Math.min(current[1], rect[1]);
			current[2] = Math.max(current[2], rect[2]);
			current[3] = Math.max(current[3], rect[3]);
		}
		else {
			current = [...rect];
			merged.push(current);
		}
	}
	return merged;
}

function sameLine(rectA: number[], rectB: number[]): boolean {
	let overlap = Math.min(rectA[3], rectB[3]) - Math.max(rectA[1], rectB[1]);
	let minHeight = Math.max(0.001, Math.min(rectA[3] - rectA[1], rectB[3] - rectB[1]));
	return overlap / minHeight >= 0.6;
}
