import type {
	StructuredDocumentText,
	ContentBlockNode,
	TextNode,
	ListItemNode,
	TableRowNode,
	Anchor,
} from '../../../../structured-document-text/schema';
import type { AnnotationType, Position, SDTPosition } from '../../../common/types';
import { isContentBlockNode, isTextNodeArray } from './utilities';

/**
 * A single text span entry in the position index.
 */
export interface TextSpanEntry {
	blockRefPath: string;
	textIndex: number;
	textNode: TextNode;
	blockAnchor: Anchor | null;
	charLength: number;
}

/**
 * Converts between SDT DOM positions and source-format positions.
 */
export interface PositionMapper {
	sdtToSourcePosition(sdtPos: SDTPosition): Position | null;

	sourceToSDTPosition(position: Position): SDTPosition | null;

	transformAnnotationPosition(position: Position, type: AnnotationType): Position;
}

/**
 * Generic index of SDT text spans. Built once after rendering.
 * This index doesn't know anything about the underlying format.
 */
export class PositionIndex {
	private _entries: TextSpanEntry[] = [];

	constructor(sdt: StructuredDocumentText) {
		this._buildIndex(sdt.content);
	}

	get entries(): readonly TextSpanEntry[] {
		return this._entries;
	}

	findEntry(blockRefPath: string, textIndex: number): TextSpanEntry | null {
		return this._entries.find(
			e => e.blockRefPath === blockRefPath && e.textIndex === textIndex
		) || null;
	}

	getBlockEntries(blockRefPath: string): TextSpanEntry[] {
		return this._entries.filter(e => e.blockRefPath === blockRefPath);
	}

	/**
	 * Compute the absolute character offset of a position within a block,
	 * accumulating across prior text nodes.
	 */
	computeAbsoluteCharOffset(blockRefPath: string, textIndex: number, charOffset: number): number {
		let cumulative = 0;
		for (let entry of this._entries) {
			if (entry.blockRefPath !== blockRefPath) continue;
			if (entry.textIndex === textIndex) {
				return cumulative + charOffset;
			}
			cumulative += entry.charLength;
		}
		return charOffset;
	}

	private _buildIndex(content: ContentBlockNode[]) {
		for (let [i, block] of content.entries()) {
			if (block.artifact) continue;
			this._walkBlock(block, String(i));
		}
	}

	private _walkBlock(block: ContentBlockNode, refPath: string) {
		let content = block.content;
		if (!content || content.length === 0) return;

		if (isTextNodeArray(content)) {
			this._addTextEntries(content, refPath, block.anchor || null);
			return;
		}

		switch (block.type) {
			case 'list':
				for (let [i, item] of (block.content as ListItemNode[]).entries()) {
					this._walkListItem(item, `${refPath}.${i}`);
				}
				break;
			case 'table':
				for (let [i, row] of (block.content as TableRowNode[]).entries()) {
					for (let [j, cell] of row.content.entries()) {
						for (let [k, cellBlock] of cell.content.entries()) {
							this._walkBlock(cellBlock, `${refPath}.${i}.${j}.${k}`);
						}
					}
				}
				break;
			default:
				for (let [i, child] of content.entries()) {
					if (isContentBlockNode(child)) {
						this._walkBlock(child, `${refPath}.${i}`);
					}
				}
				break;
		}
	}

	private _walkListItem(item: ListItemNode, refPath: string) {
		if (!item.content || item.content.length === 0) return;
		if (item.artifact) return;

		if (isTextNodeArray(item.content)) {
			this._addTextEntries(item.content, refPath, item.anchor || null);
		}
		else {
			for (let [i, child] of (item.content as ContentBlockNode[]).entries()) {
				this._walkBlock(child, `${refPath}.${i}`);
			}
		}
	}

	private _addTextEntries(textNodes: TextNode[], refPath: string, blockAnchor: Anchor | null) {
		for (let [i, textNode] of textNodes.entries()) {
			this._entries.push({
				blockRefPath: refPath,
				textIndex: i,
				textNode,
				blockAnchor,
				charLength: textNode.text.length,
			});
		}
	}
}
