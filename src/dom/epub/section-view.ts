import Section from "epubjs/types/section";
import { getVisibleTextNodes } from "../common/lib/nodes";
import {
	createSearchContext,
	SearchContext
} from "../common/lib/dom-text-search";
import {
	sanitizeAndRender,
	StyleScoper
} from "./lib/sanitize-and-render";

class SectionView {
	readonly section: Section;

	readonly container: HTMLElement;

	body!: HTMLElement;

	private readonly _window: Window & typeof globalThis;

	private readonly _document: Document;

	private readonly _styleScoper: StyleScoper;

	private _searchContext: SearchContext | null = null;

	constructor(options: {
		section: Section,
		container: HTMLElement,
		window: Window & typeof globalThis,
		document: Document,
		styleScoper: StyleScoper,
	}) {
		this.section = options.section;
		this.container = options.container;
		this._window = options.window;
		this._document = options.document;
		this._styleScoper = options.styleScoper;
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	async render(requestFn: Function): Promise<void> {
		let xhtml = await this.section.render(requestFn);
		this.body = await sanitizeAndRender(xhtml,
			{ container: this.container, styleScoper: this._styleScoper });
	}

	/**
	 * Return a range before or at the top of the viewport.
	 *
	 * @param isHorizontal Whether the viewport is laid out horizontally (paginated mode)
	 * @param textNodesOnly Return only text nodes, for constructing CFIs
	 */
	getFirstVisibleRange(isHorizontal: boolean, textNodesOnly: boolean): Range | null {
		let viewportEnd = isHorizontal ? this._window.frameElement!.clientWidth : this._window.frameElement!.clientHeight;
		let filter = NodeFilter.SHOW_TEXT | (textNodesOnly ? 0 : NodeFilter.SHOW_ELEMENT);
		let iter = this._document.createNodeIterator(this.container, filter, (node) => {
			return node.nodeType == Node.TEXT_NODE && node.nodeValue?.trim().length
					|| (node as Element).tagName === 'IMG'
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP;
		});
		let node = null;
		let bestRange = null;
		while ((node = iter.nextNode())) {
			let range = this._document.createRange();
			if (node.nodeType == Node.ELEMENT_NODE) {
				range.selectNode(node);
			}
			else {
				range.selectNodeContents(node);
			}

			let rect = range.getBoundingClientRect();
			// Skip invisible nodes
			if (!(rect.width || rect.height)) {
				continue;
			}
			let rectStart = isHorizontal ? rect.left : rect.top;
			let rectEnd = isHorizontal ? rect.right : rect.bottom;
			// If the range starts past the end of the viewport, we've gone too far -- return our previous best guess
			if (rectStart > viewportEnd) {
				return bestRange;
			}
			// If it starts in the viewport, return it immediately
			if (rectStart >= 0 || (rectStart < 0 && rectEnd > 0)) {
				return range;
			}
			// Otherwise, it's above the start of the viewport -- save it as our best guess in case nothing within
			// the viewport is usable, but keep going
			else {
				bestRange = range;
			}
		}
		return null;
	}

	get searchContext() {
		if (!this._searchContext) {
			this._searchContext = createSearchContext(getVisibleTextNodes(this.container));
		}
		return this._searchContext;
	}
}

export default SectionView;
