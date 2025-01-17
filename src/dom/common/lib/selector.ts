import { moveRangeEndsIntoTextNodes } from "./range";
import { iterateWalker } from "./nodes";

// We generate and support a very limited subset of the Web Annotation Data Model:
// https://www.w3.org/TR/annotation-model/#selectors
// Specifically, EPUB annotations are expressed in terms of FragmentSelectors with epubcfi values,
// and snapshot annotations are CssSelectors, possibly refined by TextPositionSelectors.

// https://www.w3.org/TR/annotation-model/#fragment-selector
export type FragmentSelector = {
	type: 'FragmentSelector';
	conformsTo: FragmentSelectorConformsTo;
	value: string;
	refinedBy?: Selector;
};

export enum FragmentSelectorConformsTo {
	// Skipping: HTML, PDF, Plain Text, XML, RDF/XML, CSV, Media, SVG
	EPUB3 = 'http://www.idpf.org/epub/linking/cfi/epub-cfi.html'
}

// https://www.w3.org/TR/annotation-model/#css-selector
export type CssSelector = {
	type: 'CssSelector';
	value: string;
	refinedBy?: Selector;
};

// Skipping: XPath Selector

// https://www.w3.org/TR/annotation-model/#text-quote-selector
export type TextQuoteSelector = {
	type: 'TextQuoteSelector';
	exact: string;
	prefix?: string;
	suffix?: string;
	refinedBy?: Selector;
};

// https://www.w3.org/TR/annotation-model/#text-position-selector
export type TextPositionSelector = {
	type: 'TextPositionSelector';
	start: number;
	end: number;
	refinedBy?: Selector;
};

// Skipping: Data Position Selector, SVG Selector, Range Selector

export type Selector = FragmentSelector | CssSelector | TextQuoteSelector | TextPositionSelector;

export function isFragment(selector: Selector): selector is FragmentSelector {
	return selector.type === 'FragmentSelector';
}

export function isCss(selector: Selector): selector is CssSelector {
	return selector.type === 'CssSelector';
}

export function isTextQuote(selector: Selector): selector is TextQuoteSelector {
	return selector.type === 'TextQuoteSelector';
}

export function isTextPosition(selector: Selector): selector is TextPositionSelector {
	return selector.type === 'TextPositionSelector';
}

export function textPositionFromRange(range: Range, root: Element): TextPositionSelector | null {
	range = moveRangeEndsIntoTextNodes(range);
	let iter = root.ownerDocument.createNodeIterator(root, NodeFilter.SHOW_TEXT);
	let selector: Partial<TextPositionSelector> = {
		type: 'TextPositionSelector'
	};
	let pos = 0;
	for (let node of iterateWalker(iter)) {
		if (node === range.startContainer) {
			selector.start = pos + range.startOffset;
		}
		if (node === range.endContainer) {
			selector.end = pos + range.endOffset;
		}
		if (node.nodeValue) {
			pos += node.nodeValue.length;
		}
	}
	if (selector.start === undefined || selector.end === undefined) {
		return null;
	}
	return selector as TextPositionSelector;
}

export function textPositionToRange(selector: TextPositionSelector, root: Element): Range {
	let iter = root.ownerDocument.createNodeIterator(root, NodeFilter.SHOW_TEXT);
	let range = root.ownerDocument.createRange();
	let pos = 0;
	for (let node of iterateWalker(iter)) {
		if (!node.nodeValue) {
			continue;
		}
		let startOffset = selector.start - pos;
		if (startOffset >= 0 && startOffset <= node.nodeValue.length) {
			range.setStart(node, startOffset);
		}
		let endOffset = selector.end - pos;
		if (endOffset >= 0 && endOffset <= node.nodeValue.length) {
			range.setEnd(node, endOffset);
		}
		pos += node.nodeValue.length;
	}
	return range;
}
