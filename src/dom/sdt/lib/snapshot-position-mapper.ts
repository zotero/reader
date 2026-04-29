import type { DomAnchor } from '../../../../structured-document-text/schema';
import type { AnnotationType, Position, SDTPosition } from '../../../common/types';
import { isCss, isTextPosition, type Selector } from '../../common/lib/selector';
import { expandSelectorMap, parseSelectorMap, resolveSelectorMap } from '../../../../structured-document-text/src/dom/snapshot/decode';
import type { PositionIndex, PositionMapper, TextSpanEntry } from './position-index';

interface SelectorEntry {
	entry: TextSpanEntry;

	/** The CSS selector string (without offset). */
	selector: string;

	/** Character offset of this entry within the selector's text. */
	offset: number;
}

export class SnapshotPositionMapper implements PositionMapper {
	private _index: PositionIndex;

	/** Entries grouped by their CSS selector string for O(1) lookup. */
	private _selectorIndex: Map<string, SelectorEntry[]>;

	/** Entries grouped by their block-level selector for block fallback. */
	private _blockSelectorIndex: Map<string, TextSpanEntry[]>;

	constructor(index: PositionIndex) {
		this._index = index;
		this._selectorIndex = new Map();
		this._blockSelectorIndex = new Map();

		for (let entry of index.entries) {
			let blockAnchor = entry.blockAnchor as DomAnchor | null;
			if (!blockAnchor) continue;

			let textAnchor = entry.textNode.anchor as DomAnchor | undefined;
			let expandedMap: string;
			if (textAnchor) {
				expandedMap = expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
			}
			else {
				expandedMap = blockAnchor.selectorMap;
			}

			let { selector, offset } = parseSelectorMap(expandedMap);

			let list = this._selectorIndex.get(selector);
			if (!list) {
				list = [];
				this._selectorIndex.set(selector, list);
			}
			list.push({ entry, selector, offset });

			// Block-level index
			let blockSelector = blockAnchor.selectorMap;
			let blockList = this._blockSelectorIndex.get(blockSelector);
			if (!blockList) {
				blockList = [];
				this._blockSelectorIndex.set(blockSelector, blockList);
			}
			if (!blockList.length || blockList[blockList.length - 1].blockRefPath !== entry.blockRefPath
					|| blockList[blockList.length - 1].textIndex !== entry.textIndex) {
				blockList.push(entry);
			}
		}
	}

	sdtToSourcePosition(sdtPos: SDTPosition): Position | null {
		let { startBlockRefPath, startTextIndex, startCharOffset,
			endBlockRefPath, endTextIndex, endCharOffset } = sdtPos;
		let startEntry = this._index.findEntry(startBlockRefPath, startTextIndex);
		if (!startEntry) return null;

		let blockAnchor = startEntry.blockAnchor as DomAnchor | null;
		let textAnchor = startEntry.textNode.anchor as DomAnchor | undefined;
		if (!blockAnchor) return null;

		let selectorMap: string;
		if (textAnchor) {
			selectorMap = expandSelectorMap(blockAnchor.selectorMap, textAnchor.selectorMap);
		}
		else {
			selectorMap = blockAnchor.selectorMap;
		}

		// When both endpoints are in the same text node, the offsets are already
		// relative to the selectorMap's element
		if (startBlockRefPath === endBlockRefPath && startTextIndex === endTextIndex) {
			return resolveSelectorMap(selectorMap, startCharOffset, endCharOffset, textAnchor?.deltaMap);
		}

		let startAbsOffset = this._index.computeAbsoluteCharOffset(startBlockRefPath, startTextIndex, startCharOffset);
		let endAbsOffset = this._index.computeAbsoluteCharOffset(endBlockRefPath, endTextIndex, endCharOffset);

		if (startBlockRefPath === endBlockRefPath) {
			return resolveSelectorMap(selectorMap, startAbsOffset, endAbsOffset, textAnchor?.deltaMap);
		}

		return resolveSelectorMap(selectorMap, startCharOffset, endCharOffset, textAnchor?.deltaMap);
	}

	transformAnnotationPosition(position: Position, _type: AnnotationType): Position {
		return position;
	}

	sourceToSDTPosition(position: Position): SDTPosition | null {
		let selector = position as Selector;
		if (!isCss(selector)) return null;

		let selectorValue = selector.value;
		let startOffset: number | null = null;
		let endOffset: number | null = null;
		if (selector.refinedBy && isTextPosition(selector.refinedBy)) {
			startOffset = selector.refinedBy.start;
			endOffset = selector.refinedBy.end;
		}

		// Try matching at the text-node level
		let entries = this._selectorIndex.get(selectorValue);
		if (entries) {
			for (let { entry, offset: entryOffset } of entries) {
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

				let entryStart = entryOffset;
				let entryEnd = entryOffset + entry.charLength;

				if (startOffset < entryEnd && endOffset > entryStart) {
					let localStart = Math.max(0, startOffset - entryStart);
					let localEnd = Math.min(entry.charLength, endOffset - entryStart);
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
		}

		// Try matching at the block level
		let blockEntries = this._blockSelectorIndex.get(selectorValue);
		if (blockEntries?.length) {
			let cumulativeOffsets = [0];
			for (let i = 0; i < blockEntries.length; i++) {
				cumulativeOffsets.push(cumulativeOffsets[i] + blockEntries[i].charLength);
			}

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

			let startEntry = null;
			let endEntry = null;
			let startLocalOffset = 0;
			let endLocalOffset = 0;

			for (let i = 0; i < blockEntries.length; i++) {
				let cumulativeStart = cumulativeOffsets[i];
				let cumulativeEnd = cumulativeOffsets[i + 1];
				if (!startEntry && startOffset < cumulativeEnd) {
					startEntry = blockEntries[i];
					startLocalOffset = Math.max(0, startOffset - cumulativeStart);
				}
				if (endOffset > cumulativeStart && endOffset <= cumulativeEnd) {
					endEntry = blockEntries[i];
					endLocalOffset = endOffset - cumulativeStart;
				}
			}

			if (startEntry && endEntry) {
				return {
					startBlockRefPath: startEntry.blockRefPath,
					startTextIndex: startEntry.textIndex,
					startCharOffset: startLocalOffset,
					endBlockRefPath: endEntry.blockRefPath,
					endTextIndex: endEntry.textIndex,
					endCharOffset: endLocalOffset,
				};
			}
		}

		return null;
	}
}
