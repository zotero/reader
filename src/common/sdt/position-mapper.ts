import type {
	ContentBlockNode,
	PageContentRange,
	RefPath,
	StructuredDocumentText,
	TextNode,
} from '../../../structured-document-text/schema';
import {
	compareRefs,
	walkContentRangeLeafBlocks,
} from '../../../structured-document-text/src/range';
import type {
	AnnotationType,
	SDTPosition,
	SourcePosition,
} from '../types';

/**
 * Converts between SDT positions and positions in the source document's own
 * coordinate system (PDFPosition or WADM Selector). One mapper exists per
 * loaded document, created by the reader from the materialized SDT.
 */
export interface SDTPositionMapper {
	sdtToSourcePosition(pos: SDTPosition): SourcePosition | null;

	sourceToSDTPosition(position: SourcePosition): SDTPosition | null;

	/**
	 * Adjust an annotation position created in the SDT view for the source
	 * format's conventions (e.g. PDF note annotations are fixed-size rects).
	 */
	transformAnnotationPosition(position: SourcePosition, type: AnnotationType): SourcePosition;
}

/**
 * One text node's intersection with an SDT position: the characters
 * [start, end) of `node` are covered.
 */
export interface TextNodeSpan {
	block: ContentBlockNode;
	blockRef: number[];
	node: TextNode;
	ref: number[];
	start: number;
	end: number;
}

/**
 * Collect the text node spans covered by an SDT position, in document order.
 */
export function getTextNodeSpans(structure: StructuredDocumentText, pos: SDTPosition): TextNodeSpan[] {
	let spans: TextNodeSpan[] = [];
	walkContentRangeLeafBlocks(
		structure.content,
		[pos.start, pos.end] as PageContentRange,
		({ block, ref, startPoint, endPoint }) => {
			let content = (block as ContentBlockNode).content as TextNode[] | undefined;
			if (!content) {
				return;
			}
			for (let i = 0; i < content.length; i++) {
				let node = content[i];
				if (!node || typeof node.text !== 'string') {
					continue;
				}
				let nodeRef = [...(ref as number[]), i];
				let start = 0;
				let end = node.text.length;
				if (startPoint.ref) {
					let cmp = compareRefs(nodeRef as RefPath, startPoint.ref);
					if (cmp < 0) {
						continue;
					}
					if (cmp === 0 && Number.isInteger(startPoint.offset)) {
						start = startPoint.offset!;
					}
				}
				if (endPoint.ref) {
					let cmp = compareRefs(nodeRef as RefPath, endPoint.ref);
					if (cmp > 0) {
						continue;
					}
					if (cmp === 0) {
						if (!Number.isInteger(endPoint.offset)) {
							continue;
						}
						end = endPoint.offset!;
					}
				}
				if (end <= start) {
					continue;
				}
				spans.push({
					block: block as ContentBlockNode,
					blockRef: ref as number[],
					node,
					ref: nodeRef,
					start,
					end,
				});
			}
		}
	);
	return spans;
}

/**
 * Whether the spans cover all of the text of a single leaf block.
 */
export function spansCoverWholeBlock(spans: TextNodeSpan[]): boolean {
	if (!spans.length) {
		return false;
	}
	let block = spans[0].block;
	if (spans.some(span => span.block !== block)) {
		return false;
	}
	let textNodes = (block.content as TextNode[]).filter(node => typeof node?.text === 'string');
	return spans.length === textNodes.length
		&& spans[0].start === 0
		&& spans[spans.length - 1].end === spans[spans.length - 1].node.text.length;
}

