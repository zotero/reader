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
import { isTextNodeArray } from './utilities';

/**
 * Convert a RefPath array to a dotted string for use as element ID / data attribute.
 */
function refPathToString(ref: RefPath): string {
	return ref.join('.');
}

/**
 * Render a SDT document to semantic HTML.
 *
 * Each block element gets `data-ref-path` encoding its path into the SDT content tree.
 * Each inline text span gets `data-text-index` identifying which TextNode it came from.
 * Blocks/text nodes with backRefs get an `id` for internal linking.
 * Text nodes with refs get wrapped in `<a>` links to the target.
 */
export function renderSDT(sdt: StructuredDocumentText, doc: Document): HTMLElement {
	let container = doc.createElement('article');
	container.id = 'sdt-content';
	for (let [i, block] of sdt.content.entries()) {
		if (block.artifact) continue;
		let el = renderBlock(doc, block, String(i));
		if (el) {
			container.append(el);
		}
	}
	return container;
}

function renderBlock(doc: Document, block: ContentBlockNode, refPath: string): HTMLElement | null {
	let el: HTMLElement;
	switch (block.type) {
		case 'paragraph':
			el = doc.createElement('p');
			el.append(renderTextNodes(doc, block.content, refPath));
			break;
		case 'heading':
			el = doc.createElement('h2');
			el.append(renderTextNodes(doc, block.content, refPath));
			break;
		case 'math':
			el = doc.createElement('div');
			el.className = 'sdt-math';
			el.append(renderTextNodes(doc, block.content, refPath));
			break;
		case 'image':
			el = doc.createElement('figure');
			el.className = 'sdt-image';
			if (block.content.length) {
				el.append(renderTextNodes(doc, block.content, refPath));
			}
			break;
		case 'caption':
			el = doc.createElement('figcaption');
			el.append(renderTextNodes(doc, block.content, refPath));
			break;
		case 'note':
			el = doc.createElement('aside');
			el.className = 'sdt-note';
			el.append(renderTextNodes(doc, block.content, refPath));
			break;
		case 'preformatted':
			el = doc.createElement('pre');
			el.append(renderTextNodes(doc, block.content, refPath));
			break;
		case 'blockquote':
			el = renderBlockquote(doc, block, refPath);
			break;
		case 'list':
			el = renderList(doc, block, refPath);
			break;
		case 'table':
			el = renderTable(doc, block, refPath);
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

function renderBlockquote(doc: Document, block: BlockquoteNode, refPath: string): HTMLElement {
	let el = doc.createElement('blockquote');
	for (let [i, child] of block.content.entries()) {
		if (child.type) {
			let childEl = renderBlock(doc, child, `${refPath}.${i}`);
			if (childEl) el.append(childEl);
		}
	}
	return el;
}

function renderList(doc: Document, block: ListNode, refPath: string): HTMLElement {
	let el = doc.createElement(block.ordered ? 'ol' : 'ul');
	if (block.ordered && block.startIndex && block.startIndex !== 1) {
		(el as HTMLOListElement).start = block.startIndex;
	}
	for (let [i, item] of block.content.entries()) {
		let li = renderListItem(doc, item, `${refPath}.${i}`);
		el.append(li);
	}
	return el;
}

function renderListItem(doc: Document, item: ListItemNode, refPath: string): HTMLElement {
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
	if (content.length === 0) return li;
	if (isTextNodeArray(content)) {
		li.append(renderTextNodes(doc, content, refPath));
	}
	else {
		for (let [i, child] of content.entries()) {
			let childEl = renderBlock(doc, child, `${refPath}.${i}`);
			if (childEl) li.append(childEl);
		}
	}
	return li;
}

function renderTable(doc: Document, block: TableNode, refPath: string): HTMLElement {
	let table = doc.createElement('table');
	let content = block.content;
	if (content.length === 0) return table;
	if (isTextNodeArray(content)) {
		let td = doc.createElement('td');
		td.append(renderTextNodes(doc, content, refPath));
		let tr = doc.createElement('tr');
		tr.append(td);
		let tbody = doc.createElement('tbody');
		tbody.append(tr);
		table.append(tbody);
	}
	else {
		let tbody = doc.createElement('tbody');
		for (let [i, row] of content.entries()) {
			let tr = doc.createElement('tr');
			tr.dataset.refPath = `${refPath}.${i}`;
			for (let [j, cell] of row.content.entries()) {
				let td = doc.createElement(cell.header ? 'th' : 'td');
				td.dataset.refPath = `${refPath}.${i}.${j}`;
				if (cell.colspan && cell.colspan > 1) td.colSpan = cell.colspan;
				if (cell.rowspan && cell.rowspan > 1) td.rowSpan = cell.rowspan;
				for (let [k, child] of cell.content.entries()) {
					let childEl = renderBlock(doc, child, `${refPath}.${i}.${j}.${k}`);
					if (childEl) td.append(childEl);
				}
				tr.append(td);
			}
			tbody.append(tr);
		}
		table.append(tbody);
	}
	return table;
}

function renderTextNodes(doc: Document, textNodes: TextNode[], parentRefPath: string): DocumentFragment {
	let frag = doc.createDocumentFragment();
	for (let [i, textNode] of textNodes.entries()) {
		frag.append(renderTextNode(doc, textNode, parentRefPath, i));
	}
	return frag;
}

function renderTextNode(doc: Document, textNode: TextNode, _parentRefPath: string, index: number): Node {
	function wrapIn(node: Node, tagName: string): HTMLElement {
		let wrapper = doc.createElement(tagName);
		wrapper.append(node);
		return wrapper;
	}

	let text = textNode.text;
	let node: Node = doc.createTextNode(text);

	// Apply inline styles by wrapping in elements (innermost first)
	let style = textNode.style;
	if (style) {
		if (style.monospace) node = wrapIn(node, 'code');
		if (style.sub) node = wrapIn(node, 'sub');
		if (style.sup) node = wrapIn(node, 'sup');
		if (style.italic) node = wrapIn(node, 'em');
		if (style.bold) node = wrapIn(node, 'strong');
	}

	// Wrap in link — external URL or internal ref
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
