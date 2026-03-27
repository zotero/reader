import type { PdfAnchor } from '../../../../structured-document-text/schema';
import type { Position, PDFPosition, SDTPosition, AnnotationType } from '../../../common/types';
import { PDF_NOTE_DIMENSIONS } from '../../../common/defines';
import { parseTextMap, buildRunData } from '../../../../structured-document-text/src/pdf';
import type { PositionIndex, PositionMapper, TextSpanEntry } from './position-index';

interface RunDatum {
	rect: number[];
	pageIndex: number;
}

/**
 * Cached per-entry data for fast lookups.
 */
interface EntryCache {
	entry: TextSpanEntry;

	/** Per-character position data, or null if only block-level rects are available. */
	runData: RunDatum[] | null;

	/** Pages this entry appears on. */
	pages: Set<number>;
}

export class PDFPositionMapper implements PositionMapper {
	private _index: PositionIndex;

	/** Entries grouped by page index for fast spatial lookups. */
	private _pageIndex: Map<number, EntryCache[]>;

	/** All cached entries in document order. */
	private _cache: EntryCache[];

	constructor(index: PositionIndex) {
		this._index = index;
		this._cache = [];
		this._pageIndex = new Map();

		for (let entry of index.entries) {
			let textAnchor = entry.textNode.anchor as PdfAnchor | undefined;
			let blockAnchor = entry.blockAnchor as PdfAnchor | null;
			let textMap = textAnchor?.textMap || blockAnchor?.textMap;
			let anchorPageRects = textAnchor?.pageRects || blockAnchor?.pageRects;

			let runData: RunDatum[] | null = null;
			let pages = new Set<number>();

			if (textMap) {
				runData = buildRunData(parseTextMap(textMap));
				for (let rd of runData) {
					pages.add(rd.pageIndex);
				}
			}
			else if (anchorPageRects) {
				for (let pr of anchorPageRects) {
					pages.add(pr[0]);
				}
			}

			let cached: EntryCache = { entry, runData, pages };
			this._cache.push(cached);

			for (let page of pages) {
				let list = this._pageIndex.get(page);
				if (!list) {
					list = [];
					this._pageIndex.set(page, list);
				}
				list.push(cached);
			}
		}
	}

	sdtToSourcePosition(sdtPos: SDTPosition): Position | null {
		let { startBlockRefPath, startTextIndex, startCharOffset,
			endBlockRefPath, endTextIndex, endCharOffset } = sdtPos;
		let rectsByPage = new Map<number, number[][]>();
		let inRange = false;

		for (let { entry, runData } of this._cache) {
			let isStart = entry.blockRefPath === startBlockRefPath && entry.textIndex === startTextIndex;
			let isEnd = entry.blockRefPath === endBlockRefPath && entry.textIndex === endTextIndex;

			if (isStart) inRange = true;
			if (!inRange) continue;

			if (runData) {
				if (!runData.length) {
					if (isEnd) break;
					continue;
				}

				let charStart = isStart ? startCharOffset : 0;
				let charEnd = isEnd ? endCharOffset : entry.charLength;

				let runIdx = 0;
				for (let ci = 0; ci < entry.textNode.text.length && runIdx < runData.length; ci++) {
					if (isWhitespace(entry.textNode.text[ci])) continue;
					let rd = runData[runIdx];
					runIdx++;
					if (ci >= charStart && ci < charEnd) {
						let pageRects = rectsByPage.get(rd.pageIndex);
						if (!pageRects) {
							pageRects = [];
							rectsByPage.set(rd.pageIndex, pageRects);
						}
						pageRects.push(rd.rect);
					}
				}
			}
			else {
				let anchorPageRects = (entry.textNode.anchor as PdfAnchor | undefined)?.pageRects
					|| (entry.blockAnchor as PdfAnchor | null)?.pageRects;
				if (anchorPageRects) {
					for (let pr of anchorPageRects) {
						let pageRects = rectsByPage.get(pr[0]);
						if (!pageRects) {
							pageRects = [];
							rectsByPage.set(pr[0], pageRects);
						}
						pageRects.push([pr[1], pr[2], pr[3], pr[4]]);
					}
				}
			}

			if (isEnd) break;
		}

		if (!rectsByPage.size) return null;

		let pages = [...rectsByPage.keys()].sort((a, b) => a - b);
		let pageIndex = pages[0];
		let rects = mergeLineRects(rectsByPage.get(pageIndex)!);

		let result: PDFPosition = { pageIndex, rects };
		if (pages.length > 1) {
			result.nextPageRects = mergeLineRects(rectsByPage.get(pages[1])!);
		}
		return result;
	}

	transformAnnotationPosition(position: Position, type: AnnotationType): Position {
		if (type !== 'note') {
			return position;
		}

		// Move note into a rect at the top-right
		let pos = position as PDFPosition;
		if (!pos.rects?.length) return pos;
		let right = -Infinity;
		let top = Infinity;
		for (let rect of pos.rects) {
			right = Math.max(right, rect[2]);
			top = Math.min(top, rect[1]);
		}
		return {
			pageIndex: pos.pageIndex,
			rects: [[
				right - PDF_NOTE_DIMENSIONS,
				top,
				right,
				top + PDF_NOTE_DIMENSIONS,
			]],
		};
	}

	sourceToSDTPosition(position: Position): SDTPosition | null {
		let pos = position as PDFPosition;
		if (pos.pageIndex === undefined || !pos.rects?.length) return null;

		let targetPages = [pos.pageIndex];
		if (pos.nextPageRects) {
			targetPages.push(pos.pageIndex + 1);
		}
		let allTargets: { pageIndex: number; rects: number[][] }[] = [
			{ pageIndex: pos.pageIndex, rects: pos.rects },
		];
		if (pos.nextPageRects) {
			allTargets.push({ pageIndex: pos.pageIndex + 1, rects: pos.nextPageRects });
		}

		// Only check entries on the target pages
		let candidates = new Set<EntryCache>();
		for (let page of targetPages) {
			let pageEntries = this._pageIndex.get(page);
			if (pageEntries) {
				for (let c of pageEntries) {
					candidates.add(c);
				}
			}
		}

		let startResult: { blockRefPath: string; textIndex: number; charOffset: number } | null = null;
		let endResult: { blockRefPath: string; textIndex: number; charOffset: number } | null = null;
		let hadMatch = false;
		for (let cached of this._cache) {
			if (!candidates.has(cached)) {
				if (hadMatch) break;
				continue;
			}

			let { entry, runData } = cached;
			let matchedInThisEntry = false;

			if (runData?.length) {
				let runIdx = 0;
				for (let ci = 0; ci < entry.textNode.text.length && runIdx < runData.length; ci++) {
					if (isWhitespace(entry.textNode.text[ci])) continue;
					let rd = runData[runIdx];
					runIdx++;
					for (let target of allTargets) {
						if (rd.pageIndex !== target.pageIndex) continue;
						for (let targetRect of target.rects) {
							if (charRectInLineRect(rd.rect, targetRect)) {
								matchedInThisEntry = true;
								if (!startResult) {
									startResult = {
										blockRefPath: entry.blockRefPath,
										textIndex: entry.textIndex,
										charOffset: ci,
									};
								}
								endResult = {
									blockRefPath: entry.blockRefPath,
									textIndex: entry.textIndex,
									charOffset: ci + 1,
								};
							}
						}
					}
				}
			}
			else {
				let anchorPageRects = (entry.textNode.anchor as PdfAnchor | undefined)?.pageRects
					|| (entry.blockAnchor as PdfAnchor | null)?.pageRects;
				if (anchorPageRects) {
					for (let pr of anchorPageRects) {
						let blockRect = [pr[1], pr[2], pr[3], pr[4]];
						for (let target of allTargets) {
							if (pr[0] !== target.pageIndex) continue;
							for (let targetRect of target.rects) {
								if (rectsOverlap(blockRect, targetRect)) {
									matchedInThisEntry = true;
									if (!startResult) {
										startResult = {
											blockRefPath: entry.blockRefPath,
											textIndex: entry.textIndex,
											charOffset: 0,
										};
									}
									endResult = {
										blockRefPath: entry.blockRefPath,
										textIndex: entry.textIndex,
										charOffset: entry.charLength,
									};
								}
							}
						}
					}
				}
			}

			if (hadMatch && !matchedInThisEntry) break;
			if (matchedInThisEntry) hadMatch = true;
		}

		if (!startResult || !endResult) {
			return this._findNearestBlock(pos);
		}
		return {
			startBlockRefPath: startResult.blockRefPath,
			startTextIndex: startResult.textIndex,
			startCharOffset: startResult.charOffset,
			endBlockRefPath: endResult.blockRefPath,
			endTextIndex: endResult.textIndex,
			endCharOffset: endResult.charOffset,
		};
	}

	/**
	 * Find the block whose vertical center is closest to the position's
	 * vertical center on the same page.
	 */
	private _findNearestBlock(pos: PDFPosition): SDTPosition | null {
		let targetRect = pos.rects![0];
		let targetY = (targetRect[1] + targetRect[3]) / 2;
		let pageEntries = this._pageIndex.get(pos.pageIndex);
		if (!pageEntries) return null;

		let seenBlocks = new Map<string, { minY: number; maxY: number; entry: TextSpanEntry }>();

		for (let { entry, runData } of pageEntries) {
			let blockMinY = Infinity;
			let blockMaxY = -Infinity;

			if (runData) {
				for (let rd of runData) {
					if (rd.pageIndex === pos.pageIndex) {
						blockMinY = Math.min(blockMinY, rd.rect[1]);
						blockMaxY = Math.max(blockMaxY, rd.rect[3]);
					}
				}
			}
			else {
				let anchorPageRects = (entry.textNode.anchor as PdfAnchor | undefined)?.pageRects
					|| (entry.blockAnchor as PdfAnchor | null)?.pageRects;
				if (anchorPageRects) {
					for (let pr of anchorPageRects) {
						if (pr[0] === pos.pageIndex) {
							blockMinY = Math.min(blockMinY, pr[2]);
							blockMaxY = Math.max(blockMaxY, pr[4]);
						}
					}
				}
			}

			if (blockMinY === Infinity) continue;

			let existing = seenBlocks.get(entry.blockRefPath);
			if (existing) {
				existing.minY = Math.min(existing.minY, blockMinY);
				existing.maxY = Math.max(existing.maxY, blockMaxY);
			}
			else {
				seenBlocks.set(entry.blockRefPath, { minY: blockMinY, maxY: blockMaxY, entry });
			}
		}

		let bestEntry: TextSpanEntry | null = null;
		let bestDist = Infinity;
		for (let [, block] of seenBlocks) {
			let dist = Math.abs((block.minY + block.maxY) / 2 - targetY);
			if (dist < bestDist) {
				bestDist = dist;
				bestEntry = block.entry;
			}
		}

		if (!bestEntry) return null;
		let blockEntries = this._index.getBlockEntries(bestEntry.blockRefPath);
		let first = blockEntries[0];
		let last = blockEntries[blockEntries.length - 1];
		return {
			startBlockRefPath: first.blockRefPath,
			startTextIndex: first.textIndex,
			startCharOffset: 0,
			endBlockRefPath: last.blockRefPath,
			endTextIndex: last.textIndex,
			endCharOffset: last.charLength,
		};
	}
}

function isWhitespace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r'
		|| char === '\u00A0' || char === '\u200B';
}

function charRectInLineRect(charRect: number[], lineRect: number[]): boolean {
	let charCenterX = (charRect[0] + charRect[2]) / 2;
	let charCenterY = (charRect[1] + charRect[3]) / 2;
	return charCenterX >= lineRect[0] && charCenterX <= lineRect[2]
		&& charCenterY >= lineRect[1] && charCenterY <= lineRect[3];
}

function rectsOverlap(a: number[], b: number[]): boolean {
	return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function mergeLineRects(rects: number[][]): number[][] {
	if (!rects.length) return [];
	rects = rects.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
	let merged: number[][] = [rects[0].slice()];
	for (let i = 1; i < rects.length; i++) {
		let last = merged[merged.length - 1];
		let rect = rects[i];
		let lastMidY = (last[1] + last[3]) / 2;
		if (rect[1] <= lastMidY && rect[3] >= lastMidY) {
			last[0] = Math.min(last[0], rect[0]);
			last[1] = Math.min(last[1], rect[1]);
			last[2] = Math.max(last[2], rect[2]);
			last[3] = Math.max(last[3], rect[3]);
		}
		else {
			merged.push(rect.slice());
		}
	}
	return merged;
}
