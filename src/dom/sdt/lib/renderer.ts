import type {
	StructuredDocumentText,
	ContentBlockNode,
	TextNode,
	ListNode,
	ListItemNode,
	TableNode,
	BlockquoteNode,
	RefPath,
} from '../../../../structured-document-text/schema';
import {
	getPartBoundarySeparator,
	getPartChain,
	shouldDropHardHyphenAtPartBoundary,
} from '../../../../structured-document-text/src/parts';
import { refKey } from '../../../../structured-document-text/src/range';
import { isTextNodeArray } from './utilities';

type RenderContext = {
	renderSourceCrops: boolean;
	headingLevels: Map<string, number>;
};

function buildHeadingLevels(
	items: StructuredDocumentText['catalog']['outline'],
	level = 2,
	headingLevels = new Map<string, number>(),
): Map<string, number> {
	for (let item of items) {
		if (item.ref) {
			let key = refPathToString(item.ref);
			let existingLevel = headingLevels.get(key);
			if (existingLevel === undefined || level < existingLevel) {
				headingLevels.set(key, level);
			}
		}
		buildHeadingLevels(item.children ?? [], Math.min(level + 1, 6), headingLevels);
	}
	return headingLevels;
}

/**
 * Render an SDT document to semantic HTML.
 *
 * Each block element gets `data-ref-path` encoding its path into the SDT
 * content tree (dot-separated). Each inline text span gets `data-text-index`
 * identifying which TextNode it came from. Blocks/text nodes with backRefs
 * get an `id` for internal linking. Text nodes with refs get wrapped in
 * <a> links to the target.
 *
 * Paragraphs that the source splits across pages or columns (part chains)
 * are merged into a single element, with each part's text wrapped in a
 * span carrying its own ref path.
 */
export function renderSDT(
	structure: StructuredDocumentText,
	doc: Document,
	{ renderSourceCrops = false }: { renderSourceCrops?: boolean } = {},
): HTMLElement {
	let container = doc.createElement('article');
	container.id = 'sdt-content';
	if (structure.metadata.processor.type === 'pdf') {
		container.classList.add('sdt-pdf');
	}
	let context: RenderContext = {
		renderSourceCrops,
		headingLevels: buildHeadingLevels(structure.catalog.outline),
	};
	let renderedAsPart = new Set<string>();
	for (let [i, block] of structure.content.entries()) {
		if (block.flowClass === 'excluded' || renderedAsPart.has(refKey([i]))) {
			continue;
		}
		let el = renderBlock(doc, block, String(i), context);
		if (!el) {
			continue;
		}
		let chain = getMergeableChain(structure, i, renderSourceCrops);
		if (chain) {
			for (let j = 1; j < chain.length; j++) {
				appendChainPart(doc, el, chain[j - 1].block, chain[j].block, chain[j].ref);
				renderedAsPart.add(refKey(chain[j].ref));
			}
		}
		container.append(el);
	}
	return container;
}

/**
 * Get the part chain starting at top-level block `index` if it can be
 * rendered as one element: more than one part, all parts top-level blocks
 * with inline-only content, starting at this block.
 */
function getMergeableChain(
	structure: StructuredDocumentText,
	index: number,
	renderSourceCrops: boolean,
) {
	let block = structure.content[index];
	if (!block.previousPart && !block.nextPart) {
		return null;
	}
	let chain = getPartChain(structure, [index], {
		include: ref => ref.length === 1 && structure.content[ref[0]]?.flowClass !== 'excluded',
	}) as { ref: number[], block: ContentBlockNode }[];
	if (chain.length < 2
			|| chain[0].ref[0] !== index
			|| !chain.every(part => !shouldRenderSourceCrop(part.block, renderSourceCrops)
				&& isTextNodeArray(part.block.content as unknown[]))) {
		return null;
	}
	return chain;
}

function shouldRenderSourceCrop(block: ContentBlockNode, renderSourceCrops: boolean): boolean {
	return renderSourceCrops
		&& (block.type === 'image'
			|| block.type === 'math'
			|| (block.type === 'table' && isTextNodeArray(block.content)));
}

function appendChainPart(
	doc: Document,
	el: HTMLElement,
	prevBlock: ContentBlockNode,
	block: ContentBlockNode,
	ref: number[],
) {
	if (shouldDropHardHyphenAtPartBoundary(prevBlock, block)) {
		dropTrailingHyphen(el);
	}
	let separator = getPartBoundarySeparator(prevBlock, block);
	if (separator) {
		el.append(doc.createTextNode(separator));
	}
	let refPath = ref.join('.');
	let span = doc.createElement('span');
	span.dataset.refPath = refPath;
	span.id = 'sdt-' + refPath;
	span.append(renderTextNodes(doc, block.content as TextNode[]));
	el.append(span);
}

function dropTrailingHyphen(el: HTMLElement) {
	let walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let lastText: Text | null = null;
	while (walker.nextNode()) {
		lastText = walker.currentNode as Text;
	}
	if (lastText?.data.endsWith('-')) {
		lastText.data = lastText.data.slice(0, -1);
	}
}

function renderBlock(
	doc: Document,
	block: ContentBlockNode,
	refPath: string,
	context: RenderContext,
): HTMLElement | null {
	let el: HTMLElement;
	switch (block.type) {
		case 'paragraph':
			el = doc.createElement('p');
			el.append(renderTextNodes(doc, block.content));
			break;
		case 'heading': {
			let level = context.headingLevels.get(refPath) ?? 2;
			el = doc.createElement(`h${level}`);
			el.append(renderTextNodes(doc, block.content));
			break;
		}
		case 'math':
			if (context.renderSourceCrops) {
				el = renderSourceCrop(doc, block.content);
				el.classList.add('sdt-math');
			}
			else {
				el = doc.createElement('div');
				el.className = 'sdt-math';
				el.append(renderTextNodes(doc, block.content));
			}
			break;
		case 'image': {
			if (context.renderSourceCrops) {
				el = renderSourceCrop(doc, block.content);
			}
			else {
				el = doc.createElement('figure');
				el.className = 'sdt-image';
				let img = doc.createElement('img');
				let altText = block.content.map(node => node.text).join('').trim();
				if (altText) {
					img.alt = altText;
				}
				el.append(img);
			}
			break;
		}
		case 'caption':
			el = doc.createElement('figcaption');
			el.append(renderTextNodes(doc, block.content));
			break;
		case 'note':
			el = doc.createElement('aside');
			el.className = 'sdt-note';
			el.append(renderTextNodes(doc, block.content));
			break;
		case 'preformatted':
			el = doc.createElement('pre');
			el.append(renderTextNodes(doc, block.content));
			break;
		case 'blockquote':
			el = renderBlockquote(doc, block, refPath, context);
			break;
		case 'list':
			el = renderList(doc, block, refPath, context);
			break;
		case 'table':
			el = shouldRenderSourceCrop(block, context.renderSourceCrops)
				? renderSourceCrop(doc, block.content as TextNode[])
				: renderTable(doc, block, refPath, context);
			break;
		default:
			return null;
	}
	el.dataset.refPath = refPath;
	el.id = 'sdt-' + refPath;
	if ('reference' in block && block.reference) {
		el.classList.add('sdt-reference');
	}
	if (block.backRefs?.length) {
		el.dataset.backRefs = block.backRefs.map(refPathToString).join(' ');
	}
	return el;
}

function renderSourceCrop(doc: Document, content: TextNode[]): HTMLElement {
	let figure = doc.createElement('figure');
	figure.className = 'sdt-source-crop';

	let pages = doc.createElement('div');
	pages.className = 'sdt-source-crop-pages';
	figure.append(pages);

	// Retain SDT text nodes for position mapping without exposing the raw representation.
	let text = doc.createElement('div');
	text.hidden = true;
	text.append(renderTextNodes(doc, content));
	figure.append(text);

	let label = text.textContent?.trim();
	if (label) {
		figure.setAttribute('role', 'img');
		figure.setAttribute('aria-label', label);
	}

	return figure;
}

function renderBlockquote(
	doc: Document,
	block: BlockquoteNode,
	refPath: string,
	context: RenderContext,
): HTMLElement {
	let el = doc.createElement('blockquote');
	for (let [i, child] of block.content.entries()) {
		let childEl = renderBlock(doc, child, `${refPath}.${i}`, context);
		if (childEl) {
			el.append(childEl);
		}
	}
	return el;
}

function renderList(
	doc: Document,
	block: ListNode,
	refPath: string,
	context: RenderContext,
): HTMLElement {
	let el = doc.createElement(block.ordered ? 'ol' : 'ul');
	if (block.ordered && block.startIndex && block.startIndex !== 1) {
		(el as HTMLOListElement).start = block.startIndex;
	}
	for (let [i, item] of block.content.entries()) {
		el.append(renderListItem(doc, item, `${refPath}.${i}`, context));
	}
	return el;
}

function renderListItem(
	doc: Document,
	item: ListItemNode,
	refPath: string,
	context: RenderContext,
): HTMLElement {
	let li = doc.createElement('li');
	li.dataset.refPath = refPath;
	li.id = 'sdt-' + refPath;
	if (item.reference) {
		li.classList.add('sdt-reference');
	}
	if (item.backRefs?.length) {
		li.dataset.backRefs = item.backRefs.map(refPathToString).join(' ');
	}
	let content = item.content;
	if (!content.length) {
		return li;
	}
	if (isTextNodeArray(content)) {
		li.append(renderTextNodes(doc, content));
	}
	else {
		for (let [i, child] of (content as ContentBlockNode[]).entries()) {
			let childEl = renderBlock(doc, child, `${refPath}.${i}`, context);
			if (childEl) {
				li.append(childEl);
			}
		}
	}
	return li;
}

function renderTable(
	doc: Document,
	block: TableNode,
	refPath: string,
	context: RenderContext,
): HTMLElement {
	let table = doc.createElement('table');
	let content = block.content;
	if (!content.length) {
		return table;
	}
	let tbody = doc.createElement('tbody');
	if (isTextNodeArray(content)) {
		let td = doc.createElement('td');
		td.append(renderTextNodes(doc, content));
		let tr = doc.createElement('tr');
		tr.append(td);
		tbody.append(tr);
	}
	else {
		for (let [i, row] of content.entries()) {
			let tr = doc.createElement('tr');
			tr.dataset.refPath = `${refPath}.${i}`;
			for (let [j, cell] of row.content.entries()) {
				let td = doc.createElement(cell.header ? 'th' : 'td');
				td.dataset.refPath = `${refPath}.${i}.${j}`;
				if (cell.colspan && cell.colspan > 1) td.colSpan = cell.colspan;
				if (cell.rowspan && cell.rowspan > 1) td.rowSpan = cell.rowspan;
				for (let [k, child] of cell.content.entries()) {
					let childEl = renderBlock(
						doc,
						child,
						`${refPath}.${i}.${j}.${k}`,
						context,
					);
					if (childEl) {
						td.append(childEl);
					}
				}
				tr.append(td);
			}
			tbody.append(tr);
		}
	}
	table.append(tbody);
	return table;
}

function renderTextNodes(doc: Document, textNodes: TextNode[]): DocumentFragment {
	let frag = doc.createDocumentFragment();
	for (let [i, textNode] of textNodes.entries()) {
		frag.append(renderTextNode(doc, textNode, i));
	}
	return frag;
}

function renderTextNode(doc: Document, textNode: TextNode, index: number): Node {
	function wrapIn(node: Node, tagName: string): HTMLElement {
		let wrapper = doc.createElement(tagName);
		wrapper.append(node);
		return wrapper;
	}

	let node: Node = doc.createTextNode(textNode.text);

	// Apply inline styles by wrapping in elements (innermost first)
	let style = textNode.style;
	if (style) {
		if (style.monospace) node = wrapIn(node, 'code');
		if (style.sub) node = wrapIn(node, 'sub');
		if (style.sup) node = wrapIn(node, 'sup');
		if (style.italic) node = wrapIn(node, 'em');
		if (style.bold) node = wrapIn(node, 'strong');
	}

	// Wrap in a link -- external URL or internal ref
	if (textNode.target?.url) {
		let a = doc.createElement('a');
		a.href = textNode.target.url;
		a.append(node);
		node = a;
	}
	else if (textNode.refs?.length) {
		let a = doc.createElement('a');
		a.href = '#sdt-' + refPathToString(textNode.refs[0]);
		a.className = 'sdt-ref';
		if (textNode.refs.length > 1) {
			a.dataset.refs = textNode.refs.map(refPathToString).join(' ');
		}
		a.append(node);
		node = a;
	}

	// Wrap in a span with data attributes for position tracking
	let span = doc.createElement('span');
	span.dataset.textIndex = String(index);
	if (textNode.backRefs?.length) {
		span.dataset.backRefs = textNode.backRefs.map(refPathToString).join(' ');
	}
	span.append(node);
	return span;
}

function refPathToString(ref: RefPath): string {
	return ref.join('.');
}
