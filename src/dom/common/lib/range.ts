import { getSentenceBoundaries } from "sentencex-ts";
import { isFirefox, isWin } from "../../../common/lib/utilities";
import { closestElement, getLang, iterateWalker } from "./nodes";
import { getBoundingRect, isPageRectVisible, rectsIntersect } from "./rect";

/**
 * Wraps the properties of a Range object in a static structure so that they don't change when the DOM changes.
 * (Range objects automatically normalize their start/end points when the DOM changes, which is not what we want -
 * even if the start or end is removed from the DOM temporarily, we want to keep our ranges unchanged.)
 */
export class PersistentRange {
	startContainer: Node;

	startOffset: number;

	endContainer: Node;

	endOffset: number;

	constructor(range: Omit<AbstractRange, 'collapsed'>) {
		this.startContainer = range.startContainer;
		this.startOffset = range.startOffset;
		this.endContainer = range.endContainer;
		this.endOffset = range.endOffset;
	}

	compareBoundaryPoints(how: number, other: Range | PersistentRange): number {
		return this.toRange().compareBoundaryPoints(how, other instanceof PersistentRange ? other.toRange() : other);
	}

	getClientRects(): DOMRectList {
		return this.toRange().getClientRects();
	}

	getBoundingClientRect(): DOMRect {
		return this.toRange().getBoundingClientRect();
	}

	toRange(): Range {
		let range = new Range();
		range.setStart(this.startContainer, this.startOffset);
		range.setEnd(this.endContainer, this.endOffset);
		return range;
	}

	clone() {
		return new PersistentRange(this);
	}

	toString(): string {
		return this.toRange().toString();
	}
}

/**
 * Return a clone of the provided range. If the start and/or end points are text node children of non-text nodes,
 * move them inside the text nodes, trimming leading/trailing newlines. This works around bugs in epub.js's CFI
 * generation.
 */
export function moveRangeEndsIntoTextNodes(range: Range): Range {
	let doc = range.commonAncestorContainer.ownerDocument!;
	range = range.cloneRange();

	// If the range selects a single <img>, leave it be
	if (range.startContainer === range.endContainer
			&& range.startOffset === range.endOffset - 1
			&& range.startContainer.nodeType === Node.ELEMENT_NODE
			&& (range.startContainer as Element).childNodes[range.startOffset].nodeName === 'IMG') {
		return range;
	}

	if (range.startContainer.nodeType !== Node.TEXT_NODE) {
		// The startContainer isn't a text node, so the range's start needs to be moved
		// First see if range.startOffset points to a child of the startContainer
		let startNode: Node | null = range.startContainer.childNodes.length
			? range.startContainer.childNodes[Math.max(range.startOffset, 0)]
			: null;
		if (!startNode || startNode.nodeType !== Node.TEXT_NODE) {
			// If it didn't point to a child or the child wasn't text, find the next text node in the document
			let walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
			if (range.startContainer.childNodes.length && range.startOffset === range.startContainer.childNodes.length) {
				// If it pointed to the end of the startContainer, start from there
				startNode = range.startContainer.childNodes[range.startContainer.childNodes.length - 1];
			}
			walker.currentNode = startNode || range.startContainer;
			startNode = walker.nextNode();
		}
		if (startNode) {
			// At this point, we know we have a text node, so we'll set the range's end inside it
			let offset = 0;
			if (startNode.nodeValue) {
				// Cut off leading newlines - they aren't necessary and confuse epub.js
				while (offset < startNode.nodeValue.length && startNode.nodeValue.charAt(offset) == '\n') {
					offset++;
				}
			}
			range.setStart(startNode, offset);
		}
	}
	if (range.endContainer.nodeType !== Node.TEXT_NODE) {
		// Similar procedure to above
		let endNode: Node | null = range.endContainer.childNodes.length
			? range.endContainer.childNodes[Math.min(range.endOffset - 1, range.endContainer.childNodes.length - 1)]
			: null;
		if (!endNode || endNode.nodeType !== Node.TEXT_NODE) {
			// Find the last text node child
			let walker = doc.createTreeWalker(endNode || range.endContainer, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {}
			endNode = walker.currentNode;
		}
		if (endNode) {
			let offset = 0;
			if (endNode.nodeValue) {
				// And cut off trailing newlines instead of leading
				offset = endNode.nodeValue.length;
				while (offset > 0 && endNode.nodeValue.charAt(offset - 1) == '\n') {
					offset--;
				}
			}
			range.setEnd(endNode, offset);
		}
	}

	// Firefox on Windows adds an extra space at the end of a word selection,
	// so remove it if it's simple to do so. (This won't work if the space is
	// in the text node before the endContainer, but that's unlikely.)
	if (isFirefox && isWin()
			&& range.endContainer.nodeType === Node.TEXT_NODE
			&& range.endOffset > 0
			&& /\s/.test(range.endContainer.nodeValue!.charAt(range.endOffset - 1))) {
		range.setEnd(range.endContainer, range.endOffset - 1);
	}

	return range;
}

/**
 * Create a TreeWalker that walks only the nodes intersecting a range.
 */
export function createRangeWalker(
	range: Range,
	whatToShow?: number,
	filter: ((node: Node) => number) = () => NodeFilter.FILTER_ACCEPT
): TreeWalker {
	let doc = range.commonAncestorContainer.ownerDocument!;
	return doc.createTreeWalker(
		range.commonAncestorContainer,
		whatToShow,
		node => (range.intersectsNode(node) ? filter(node) : NodeFilter.FILTER_SKIP)
	);
}

/**
 * Given a range, return an array of ranges spanning the selected portions of the text nodes it contains.
 * This ensures that the rects returned from {@link Range#getClientRects} will include a rect per line of text
 * instead of one rect for the entire block element.
 */
export function splitRangeToTextNodes(range: Range): Range[] {
	let treeWalker = createRangeWalker(range, NodeFilter.SHOW_TEXT);
	let ranges = [];
	let node: Node | null = treeWalker.currentNode;
	while (node) {
		if (!node.nodeValue) {
			node = treeWalker.nextNode();
			continue;
		}
		let subRange = document.createRange();
		subRange.setStart(node, range.startContainer == node ? range.startOffset : 0);
		subRange.setEnd(node, range.endContainer == node ? range.endOffset : node.nodeValue.length);
		ranges.push(subRange);
		node = treeWalker.nextNode();
	}
	return ranges;
}

export function splitRangeToSentences(range: Range, { keepWhitespace = false } = {}): Range[] {
	let walker = createRangeWalker(range, NodeFilter.SHOW_TEXT);

	let textParts: {
		node: Text;
		globalStart: number;
		globalEnd: number;
		localStart: number;
		localEnd: number;
	}[] = [];

	let text = '';
	let globalOffset = 0;

	for (let node of iterateWalker(walker)) {
		let nodeValue = node.nodeValue!;

		let startInNode = node === range.startContainer
			? range.startOffset
			: 0;

		let endInNode = node === range.endContainer
			? range.endOffset
			: nodeValue.length;

		if (endInNode > startInNode) {
			let nodeValueWithinRange = nodeValue.slice(startInNode, endInNode);
			textParts.push({
				node: node as Text,
				globalStart: globalOffset,
				globalEnd: globalOffset + nodeValueWithinRange.length,
				localStart: startInNode,
				localEnd: endInNode,
			});
			text += nodeValueWithinRange;
			globalOffset += nodeValueWithinRange.length;
		}
	}

	// Normalize all whitespace to space characters, because Range#toString()
	// returns invisible newlines in the HTML, and the segmenter will treat
	// those as meaningful.
	text = text.replace(/\s/g, ' ');

	let lang = getLang(range.commonAncestorContainer) || 'en';
	let boundaries = getSentenceBoundaries(lang, text);

	let outputRanges: Range[] = [];
	for (let boundary of boundaries) {
		let sentStart = boundary.startIndex;
		let sentEnd = boundary.endIndex;

		if (!keepWhitespace) {
			// Trim leading/trailing whitespace within the segment
			let segment = text.slice(sentStart, sentEnd);
			let leading = (segment.match(/^\s*/)?.[0].length) ?? 0;
			let trailing = (segment.match(/\s*$/)?.[0].length) ?? 0;
			sentStart += leading;
			sentEnd -= trailing;
			// Skip segments that are only whitespace after trimming
			if (sentEnd <= sentStart) {
				continue;
			}
		}

		let startNode: Text | null = null;
		let startOffsetInNode = 0;
		for (let textPart of textParts) {
			if (textPart.globalStart <= sentStart && sentStart < textPart.globalEnd) {
				startNode = textPart.node;
				startOffsetInNode = textPart.localStart + (sentStart - textPart.globalStart);
				break;
			}
		}

		let endNode: Text | null = null;
		let endOffsetInNode = 0;
		for (let textPart of textParts) {
			if (textPart.globalStart < sentEnd && sentEnd <= textPart.globalEnd) {
				endNode = textPart.node;
				endOffsetInNode = textPart.localStart + (sentEnd - textPart.globalStart);
				break;
			}
		}

		if (!startNode || !endNode) continue;

		let sentenceRange = range.commonAncestorContainer.ownerDocument!.createRange();
		sentenceRange.setStart(startNode, startOffsetInNode);
		sentenceRange.setEnd(endNode, endOffsetInNode);
		outputRanges.push(sentenceRange);
	}
	return outputRanges;
}

export function splitRanges(
	ranges: Range[],
	splitAtRange: Range
): { ranges: Range[]; startIndex: number; endIndex: number } | null {
	let newRanges: Range[] = [];
	let startIndex = -1;
	let endIndex = -1;

	let lastStartToStart: number | null = null;
	let lastStartToEnd: number | null = null;
	let lastEndToStart: number | null = null;
	let lastEndToEnd: number | null = null;

	for (let range of ranges) {
		if (startIndex !== -1 && endIndex !== -1) {
			newRanges.push(range);
			continue;
		}
		// If these ranges aren't comparable, we can't split
		if (range.commonAncestorContainer.getRootNode() !== splitAtRange.commonAncestorContainer.getRootNode()) {
			newRanges.push(range);
			continue;
		}

		let splitRanges: Range[] = [];
		let containedStart = false;
		let containedEnd = false;
		let splitIndex = -1;

		if (startIndex === -1) {
			let startToStart = range.compareBoundaryPoints(Range.START_TO_START, splitAtRange);
			let startToEnd = range.compareBoundaryPoints(Range.START_TO_END, splitAtRange);
			if (
				// If the start point of splitAtRange is somewhere within range,
				// or it was somewhere between the last range and this range
				(startToStart <= 0 || lastStartToStart === -1 && startToStart === 1)
				&& (startToEnd >= 0 || lastStartToEnd === -1 && startToEnd === 1)
			) {
				containedStart = true;
			}
			lastStartToStart = startToStart;
			lastStartToEnd = startToEnd;
		}

		if (endIndex === -1) {
			let endToStart = range.compareBoundaryPoints(Range.END_TO_START, splitAtRange);
			let endToEnd = range.compareBoundaryPoints(Range.END_TO_END, splitAtRange);
			if (
				// If the end point of splitAtRange is somewhere within range,
				// or it was somewhere between the last range and this range
				(endToStart <= 0 || lastEndToStart === -1 && endToStart === 1)
				&& (endToEnd >= 0 || lastEndToEnd === -1 && endToEnd === 1)
			) {
				containedEnd = true;
			}
			lastEndToStart = endToStart;
			lastEndToEnd = endToEnd;
		}

		if (containedStart) {
			let before = range.cloneRange();
			before.setEnd(splitAtRange.startContainer, splitAtRange.startOffset);
			if (!before.collapsed) splitRanges.push(before);
		}

		if (containedStart || containedEnd) {
			let middle = range.cloneRange();
			let start = (containedStart ? splitAtRange : range).startContainer;
			let startOffset = (containedStart ? splitAtRange : range).startOffset;
			let end = (containedEnd ? splitAtRange : range).endContainer;
			let endOffset = (containedEnd ? splitAtRange : range).endOffset;

			middle.setStart(start, startOffset);
			middle.setEnd(end, endOffset);

			if (!middle.collapsed) {
				splitRanges.push(middle);
				splitIndex = splitRanges.length - 1;
			}
		}
		else if (!range.collapsed) {
			splitRanges.push(range);
			splitIndex = splitRanges.length - 1;
		}

		if (containedEnd) {
			let after = range.cloneRange();
			after.setStart(splitAtRange.endContainer, splitAtRange.endOffset);
			if (!after.collapsed) splitRanges.push(after);
		}

		if (containedStart) {
			startIndex = newRanges.length + splitIndex;
		}
		if (containedEnd) {
			endIndex = newRanges.length + splitIndex + 1;
		}
		newRanges.push(...splitRanges);
	}

	if (startIndex === -1 || endIndex === -1) {
		return null;
	}

	return {
		ranges: newRanges,
		startIndex,
		endIndex
	};
}

/**
 * Create a single range spanning all the positions included in the set of input ranges. For
 * example, if rangeA goes from nodeA at offset 5 to nodeB at offset 2 and rangeB goes from nodeC
 * at offset 0 to nodeD at offset 9, the output of makeRangeSpanning(rangeA, rangeB) would be a
 * range from nodeA at offset 5 to nodeD at offset 9.
 */
export function makeRangeSpanning(ranges: Range[], sorted = false): Range {
	if (!ranges.length) {
		return document.createRange();
	}
	if (sorted) {
		let range = ranges[0].cloneRange();
		let lastRange = ranges[ranges.length - 1];
		range.setEnd(lastRange.endContainer, lastRange.endOffset);
		return range;
	}

	let result = ranges[0].cloneRange();
	for (let i = 1; i < ranges.length; i++) {
		let range = ranges[i];
		if (result.comparePoint(range.startContainer, range.startOffset) < 0) {
			result.setStart(range.startContainer, range.startOffset);
		}
		if (result.comparePoint(range.endContainer, range.endOffset) > 0) {
			result.setEnd(range.endContainer, range.endOffset);
		}
	}
	return result;
}

/**
 * Collapse the range to its start, leaving a single character if possible. This prevents the range's bounding box from
 * moving to the previous line if its start is on the soft-wrap point between two lines.
 */
export function collapseToOneCharacterAtStart(range: Range) {
	if (range.startContainer.nodeValue && range.startContainer.nodeValue?.length > range.startOffset) {
		range.setEnd(range.startContainer, range.startOffset + 1);
	}
	else {
		range.collapse(true);
	}
}

export function supportsCaretPositionFromPoint(): boolean {
	return typeof document.caretPositionFromPoint == 'function' || typeof document.caretRangeFromPoint == 'function';
}

export function caretPositionFromPoint(doc: Document, x: number, y: number): CaretPosition | null {
	// Enable CSS hacks for WebKit
	doc.body.classList.add('reading-caret-position');
	try {
		if (typeof doc.caretPositionFromPoint == 'function') {
			let pos = doc.caretPositionFromPoint(x, y);
			if (!pos) {
				return null;
			}
			return {
				offsetNode: pos.offsetNode,
				offset: pos.offset,
				getClientRect: () => pos.getClientRect()
			};
		}
		else if (typeof doc.caretRangeFromPoint == 'function') {
			let range = doc.caretRangeFromPoint(x, y);
			if (!range) {
				return null;
			}
			return {
				offsetNode: range.startContainer,
				offset: range.startOffset,
				getClientRect: () => range.getBoundingClientRect()
			};
		}
		return null;
	}
	finally {
		doc.body.classList.remove('reading-caret-position');
	}
}

export function getStartElement(range: Range | PersistentRange): Element | null {
	let startContainer: Node | null = range.startContainer;
	while (startContainer && startContainer.nodeType !== Node.ELEMENT_NODE) {
		startContainer = startContainer.parentNode;
	}
	return startContainer as Element | null;
}

export function getBoundingPageRect(rangeOrElem: Range | PersistentRange | Element) {
	let rect = rangeOrElem.getBoundingClientRect();
	let win = ('ownerDocument' in rangeOrElem ? rangeOrElem : rangeOrElem.startContainer)
		.ownerDocument?.defaultView;
	rect.x += win?.scrollX ?? 0;
	rect.y += win?.scrollY ?? 0;
	return rect;
}

export function getPageRects(rangeOrElem: Range | PersistentRange | Element): DOMRectList {
	let rects = rangeOrElem.getClientRects();
	let win = ('ownerDocument' in rangeOrElem ? rangeOrElem : rangeOrElem.startContainer)
		.ownerDocument?.defaultView;
	for (let rect of rects) {
		rect.x += win?.scrollX ?? 0;
		rect.y += win?.scrollY ?? 0;
	}
	return rects;
}

/**
 * Get the range's bounding rects, split by columns. This is useful for
 * showing borders and popups relative to the range without positioning
 * based on offscreen content.
 */
export function getColumnSeparatedPageRects(range: Range, visibleOnly = true): DOMRect[] {
	let columnElement = closestElement(range.commonAncestorContainer)
		?.closest('[data-section-index]');
	if (!columnElement) {
		return [getBoundingPageRect(range)];
	}

	let rangeRects = new Set(getPageRects(range));
	let columnSeparatedPageRects = [];
	for (let columnRect of getPageRects(columnElement)) {
		// If the column is out of view, skip it
		if (visibleOnly && !isPageRectVisible(columnRect, columnElement.ownerDocument.defaultView!)) {
			continue;
		}

		// Get the bounding rect encompassing all the parts of the range that
		// are within this column
		let rangeRectsWithinColumn = [];
		for (let rangeRect of rangeRects) {
			if (rectsIntersect(rangeRect, columnRect)) {
				rangeRectsWithinColumn.push(rangeRect);
				rangeRects.delete(rangeRect);
			}
		}
		if (rangeRectsWithinColumn.length) {
			columnSeparatedPageRects.push(getBoundingRect(rangeRectsWithinColumn));
		}
	}
	return columnSeparatedPageRects;
}

export function getInnerText(range: Range): string {
	let doc = range.commonAncestorContainer.ownerDocument;
	if (!doc) {
		return range.toString();
	}

	// We need to actually insert the wrapper into the DOM to get a white-space-normalized innerText
	let wrapper = doc.createElement('div');
	wrapper.append(range.cloneContents());
	doc.body.append(wrapper);
	let innerText = wrapper.innerText;
	wrapper.remove();
	return innerText;
}
