import type { DomAnchor } from '../../../../structured-document-text/schema';
import type { AnnotationType, Position, SDTPosition } from '../../../common/types';
import { isFragment, isTextPosition, type Selector } from '../../common/lib/selector';
import {
	expandSelectorMap,
	resolveSelectorMap,
	resolveSelectorMapRange,
} from '../../../../structured-document-text/src/dom/epub/decode';
import type { PositionIndex, PositionMapper, TextSpanEntry } from './position-index';

interface PathEntry {
	entry: TextSpanEntry;
	path: string;

	/** Absolute character start within the block (cumulative across prior text nodes). */
	absoluteStart: number;
}

export class EPUBPositionMapper implements PositionMapper {
	readonly index: PositionIndex;

	/**
	 * All entries with their expanded CFI paths, for text-level matching.
	 * Entries without a valid path are omitted.
	 */
	private readonly _pathEntries: PathEntry[];

	/**
	 * Entries grouped by block-level CFI path for block-level fallback.
	 * Key is the block anchor's selectorMap.
	 */
	private readonly _blockPathIndex: Map<string, TextSpanEntry[]>;

	constructor(index: PositionIndex) {
		this.index = index;
		this._pathEntries = [];
		this._blockPathIndex = new Map();

		for (let entry of index.entries) {
			let blockAnchor = entry.blockAnchor as DomAnchor | null;
			if (!blockAnchor) continue;

			let textAnchor = entry.textNode.anchor as DomAnchor | undefined;
			let path: string;
			if (textAnchor) {
				path = expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
			}
			else {
				path = blockAnchor.selectorMap;
			}

			let absoluteStart = index.computeAbsoluteCharOffset(entry.blockRefPath, entry.textIndex, 0);
			this._pathEntries.push({ entry, path, absoluteStart });

			// Block-level index
			let blockPath = blockAnchor.selectorMap;
			let list = this._blockPathIndex.get(blockPath);
			if (!list) {
				list = [];
				this._blockPathIndex.set(blockPath, list);
			}
			if (!list.length || list[list.length - 1] !== entry) {
				list.push(entry);
			}
		}
	}

	sdtToSourcePosition(sdtPos: SDTPosition): Position | null {
		let { startBlockRefPath, startTextIndex, startCharOffset,
			endBlockRefPath, endTextIndex, endCharOffset } = sdtPos;
		let startEntry = this.index.findEntry(startBlockRefPath, startTextIndex);
		let endEntry = (startBlockRefPath === endBlockRefPath && startTextIndex === endTextIndex)
			? startEntry
			: this.index.findEntry(endBlockRefPath, endTextIndex);
		if (!startEntry || !endEntry) return null;

		let startPath = this._getExpandedPath(startEntry);
		let endPath = this._getExpandedPath(endEntry);
		if (!startPath || !endPath) return null;

		if (startPath === endPath) {
			let adjustedEndOffset = endCharOffset;
			if (startEntry !== endEntry) {
				adjustedEndOffset = this._cumulativeOffsetInPath(
					endEntry, endCharOffset, startEntry, startPath);
			}
			let deltaMap = (startEntry.textNode.anchor as DomAnchor | undefined)?.deltaMap;
			return resolveSelectorMap(startPath, startCharOffset, adjustedEndOffset, deltaMap);
		}

		return resolveSelectorMapRange(
			startPath, startCharOffset,
			endPath, endCharOffset,
		);
	}

	private _cumulativeOffsetInPath(
		entry: TextSpanEntry, charOffset: number,
		origin: TextSpanEntry, path: string,
	): number {
		let cumulative = 0;
		let started = false;
		for (let e of this.index.entries) {
			if (e === origin) started = true;
			if (!started) continue;
			if (e.blockRefPath !== entry.blockRefPath) continue;
			if (this._getExpandedPath(e) !== path) continue;
			if (e === entry) return cumulative + charOffset;
			cumulative += e.charLength;
		}
		return charOffset;
	}

	transformAnnotationPosition(position: Position, _type: AnnotationType): Position {
		return position;
	}

	sourceToSDTPosition(position: Position): SDTPosition | null {
		let selector = position as Selector;
		if (!isFragment(selector)) return null;

		let cfiValue = selector.value;
		let startOffset: number | null = null;
		let endOffset: number | null = null;
		if (selector.refinedBy && isTextPosition(selector.refinedBy)) {
			startOffset = selector.refinedBy.start;
			endOffset = selector.refinedBy.end;
		}

		// Try matching at the text-node level using pre-computed paths
		for (let { entry, path, absoluteStart } of this._pathEntries) {
			if (!cfiValue.includes(path)) continue;

			if (startOffset === null || endOffset === null) {
				return {
					startBlockRefPath: entry.blockRefPath,
					startTextIndex: entry.textIndex,
					startCharOffset: 0,
					endBlockRefPath: entry.blockRefPath,
					endTextIndex: entry.textIndex,
					endCharOffset: entry.charLength,
				};
			}

			let absoluteEnd = absoluteStart + entry.charLength;
			if (startOffset < absoluteEnd && endOffset > absoluteStart) {
				let localStart = Math.max(0, startOffset - absoluteStart);
				let localEnd = Math.min(entry.charLength, endOffset - absoluteStart);
				return {
					startBlockRefPath: entry.blockRefPath,
					startTextIndex: entry.textIndex,
					startCharOffset: localStart,
					endBlockRefPath: entry.blockRefPath,
					endTextIndex: entry.textIndex,
					endCharOffset: localEnd,
				};
			}
		}

		// Try matching at the block level
		for (let [blockPath, blockEntries] of this._blockPathIndex) {
			if (!cfiValue.includes(blockPath)) continue;
			if (!blockEntries.length) continue;

			if (startOffset === null || endOffset === null) {
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

			let cumulativeOffsets = [0];
			for (let i = 0; i < blockEntries.length; i++) {
				cumulativeOffsets.push(cumulativeOffsets[i] + blockEntries[i].charLength);
			}

			let startResult = null;
			let endResult = null;
			let startLocalOffset = 0;
			let endLocalOffset = 0;

			for (let i = 0; i < blockEntries.length; i++) {
				let cumulativeStart = cumulativeOffsets[i];
				let cumulativeEnd = cumulativeOffsets[i + 1];
				if (!startResult && startOffset < cumulativeEnd) {
					startResult = blockEntries[i];
					startLocalOffset = Math.max(0, startOffset - cumulativeStart);
				}
				if (endOffset > cumulativeStart && endOffset <= cumulativeEnd) {
					endResult = blockEntries[i];
					endLocalOffset = endOffset - cumulativeStart;
				}
			}

			if (startResult && endResult) {
				return {
					startBlockRefPath: startResult.blockRefPath,
					startTextIndex: startResult.textIndex,
					startCharOffset: startLocalOffset,
					endBlockRefPath: endResult.blockRefPath,
					endTextIndex: endResult.textIndex,
					endCharOffset: endLocalOffset,
				};
			}
		}

		return null;
	}

	private _getExpandedPath(entry: TextSpanEntry): string | null {
		let blockAnchor = entry.blockAnchor as DomAnchor | null;
		if (!blockAnchor) return null;
		let textAnchor = entry.textNode.anchor as DomAnchor | undefined;
		if (textAnchor) {
			return expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
		}
		return blockAnchor.selectorMap;
	}
}
