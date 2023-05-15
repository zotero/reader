/**
 * Return a clone of the provided range. If the start and/or end points are text node children of non-text nodes,
 * move them inside the text nodes, trimming leading/trailing newlines. This works around bugs in epub.js's CFI
 * generation.
 */
export function moveRangeEndsIntoTextNodes(range: Range): Range {
	const doc = range.commonAncestorContainer.ownerDocument!;
	range = range.cloneRange();
	if (range.startContainer.nodeType !== Node.TEXT_NODE) {
		// The startContainer isn't a text node, so the range's start needs to be moved
		// First see if range.startOffset points to a child of the startContainer
		let startNode: Node | null = range.startContainer.childNodes.length
			? range.startContainer.childNodes[Math.max(range.startOffset, 0)]
			: null;
		if (!startNode || startNode.nodeType !== Node.TEXT_NODE) {
			// If it didn't point to a child or the child wasn't text, find the next text node in the document
			const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
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
			// Get the last text node inside the container/child
			const walker = doc.createTreeWalker(endNode || range.endContainer, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				endNode = node;
			}
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
	return range;
}

/**
 * Given a range, return an array of ranges spanning the selected portions of the text nodes it contains.
 * This ensures that the rects returned from {@link Range#getClientRects} will include a rect per line of text
 * instead of one rect for the entire block element.
 */
export function splitRangeToTextNodes(range: Range): Range[] {
	const doc = range.commonAncestorContainer.ownerDocument;
	if (!doc) {
		return [];
	}
	const treeWalker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT,
		node => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP));
	const ranges = [];
	let node: Node | null = treeWalker.currentNode;
	while (node) {
		if (!node.nodeValue) {
			node = treeWalker.nextNode();
			continue;
		}
		const subRange = document.createRange();
		subRange.setStart(node, range.startContainer == node ? range.startOffset : 0);
		subRange.setEnd(node, range.endContainer == node ? range.endOffset : node.nodeValue.length);
		ranges.push(subRange);
		node = treeWalker.nextNode();
	}
	return ranges;
}

/**
 * Create a single range spanning all the positions included in the set of input ranges. For
 * example, if rangeA goes from nodeA at offset 5 to nodeB at offset 2 and rangeB goes from nodeC
 * at offset 0 to nodeD at offset 9, the output of makeRangeSpanning(rangeA, rangeB) would be a
 * range from nodeA at offset 5 to nodeD at offset 9.
 */
export function makeRangeSpanning(...ranges: Range[]): Range {
	if (!ranges.length) {
		return document.createRange();
	}
	const result = ranges[0].cloneRange();
	for (let i = 1; i < ranges.length; i++) {
		const range = ranges[i];
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
	if (typeof doc.caretPositionFromPoint == 'function') {
		return doc.caretPositionFromPoint(x, y);
	}
	else if (typeof doc.caretRangeFromPoint == 'function') {
		const range = doc.caretRangeFromPoint(x, y);
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

export function getStartElement(range: Range): Element | null {
	let startContainer: Node | null = range.startContainer;
	while (startContainer && startContainer.nodeType !== Node.ELEMENT_NODE) {
		startContainer = startContainer.parentNode;
	}
	return startContainer as Element | null;
}
