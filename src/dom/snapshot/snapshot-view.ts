import {
	AnnotationType,
	WADMAnnotation,
	FindState,
	NavLocation,
	NewAnnotation,
	ViewStats,
	OutlineItem
} from "../../common/types";
import {
	getStartElement
} from "../common/lib/range";
import {
	CssSelector,
	textPositionFromRange,
	Selector,
	textPositionToRange
} from "../common/lib/selector";
import DOMView, {
	DOMViewState,
	NavigateOptions
} from "../common/dom-view";
import { getUniqueSelectorContaining } from "../common/lib/unique-selector";
import NavStack from "../common/lib/nav-stack";
import {
	getVisibleTextNodes
} from "../common/lib/nodes";
import DefaultFindProcessor from "../common/find";
import {
	createSearchContext,
	SearchContext
} from "../common/lib/dom-text-search";

// @ts-ignore
import contentCSS from '!!raw-loader!./stylesheets/content.css';

class SnapshotView extends DOMView<SnapshotViewState, SnapshotViewData> {
	private readonly _navStack = new NavStack<[number, number]>();

	protected _find: DefaultFindProcessor | null = null;

	private _searchContext: SearchContext | null = null;

	private _scale!: number;

	protected async _getSrcDoc() {
		if (this._options.data.srcDoc) {
			return this._options.data.srcDoc;
		}
		else if (this._options.data.buf || this._options.data.url !== undefined) {
			let buf;
			if (this._options.data.buf) {
				buf = this._options.data.buf;
			}
			else {
				buf = await fetch(this._options.data.url!).then(r => r.arrayBuffer());
			}
			let text = new TextDecoder('utf-8').decode(buf);
			delete this._options.data.buf;
			let doc = new DOMParser().parseFromString(text, 'text/html');

			for (let base of doc.querySelectorAll('base')) {
				base.remove();
			}
			if (this._options.data.url !== undefined) {
				let base = doc.createElement('base');
				base.href = this._options.data.url;
				doc.head.prepend(base);
			}

			for (let cspMeta of Array.from(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'))) {
				cspMeta.remove();
			}
			let cspMeta = doc.createElement('meta');
			cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
			cspMeta.setAttribute('content', this._getCSP());
			doc.head.prepend(cspMeta);

			// Fix Twitter snapshots breaking because of <noscript> styles
			for (let noscript of Array.from(doc.querySelectorAll('noscript'))) {
				noscript.remove();
			}

			let doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
			let html = doc.documentElement.outerHTML;
			return doctype + html;
		}
		else {
			throw new Error('buf, url, or srcDoc is required');
		}
	}

	getData() {
		return {
			srcDoc: this._iframe.srcdoc,
			url: this._iframeDocument.head.querySelector('base')?.href
		};
	}

	protected _onInitialDisplay(viewState: Partial<Readonly<SnapshotViewState>>) {
		let style = this._iframeDocument.createElement('style');
		style.innerHTML = contentCSS;
		this._iframeDocument.head.append(style);

		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		this._setScale(viewState.scale || 1);
		if (viewState.scrollYPercent !== undefined) {
			this._iframeWindow.scrollTo({
				top: viewState.scrollYPercent
					/ 100
					* (this._iframeDocument.body.scrollHeight - this._iframeDocument.documentElement.clientHeight)
			});
		}

		this._initOutline();
	}

	private _initOutline() {
		let bodyFontSize = parseFloat(getComputedStyle(this._iframeDocument.body).fontSize);
		let flatOutline: (OutlineItem & { level: number })[] = [];
		// Create a flat outline array from the headings on the page
		for (let heading of this._iframeDocument.body.querySelectorAll('h1, h2, h3, h4, h5, h6') as NodeListOf<HTMLElement>) {
			// If the site uses semantic HTML, we can try to skip probably-irrelevant headings
			if (heading.closest('aside, nav, footer, template, [hidden]')) {
				continue;
			}
			if (!heading.innerText.trim()) {
				continue;
			}
			let headingFontSize = parseFloat(getComputedStyle(heading).fontSize);
			if (headingFontSize <= bodyFontSize) {
				continue;
			}

			let range = this._iframeDocument.createRange();
			range.selectNode(heading);
			let selector = this.toSelector(range);
			if (!selector) {
				continue;
			}
			let level = parseInt(heading.tagName[1]);
			flatOutline.push({
				title: heading.innerText.trim(),
				location: { position: selector },
				items: [],
				expanded: true,
				level
			});
		}
		// For each heading, move subsequent headings with deeper levels into its items array
		let outline = [];
		let stack: (OutlineItem & { level: number })[] = [];
		for (let item of flatOutline) {
			while (stack.length && stack[stack.length - 1].level >= item.level) {
				stack.pop();
			}
			if (stack.length) {
				stack[stack.length - 1].items!.push(item);
			}
			else {
				outline.push(item);
			}
			stack.push(item);
		}
		this._options.onSetOutline(outline);
	}

	protected _getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		if (range.collapsed) {
			return null;
		}
		let text = type == 'highlight' || type == 'underline' ? range.toString().trim() : undefined;
		// If this annotation type wants text, but we didn't get any, abort
		if (text === '') {
			return null;
		}

		let selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		let sortIndex = this._getSortIndex(range);
		return {
			type,
			color,
			sortIndex,
			position: selector,
			text
		};
	}

	private _getSortIndex(range: Range) {
		let iter = this._iframeDocument.createNodeIterator(this._iframeDocument.documentElement, NodeFilter.SHOW_TEXT);
		let count = 0;
		let node: Node | null;
		while ((node = iter.nextNode())) {
			if (range.startContainer.contains(node)) {
				return String(count + range.startOffset).padStart(8, '0');
			}
			count += node.nodeValue!.trim().length;
		}
		return '00000000';
	}

	toSelector(range: Range): Selector | null {
		let doc = range.commonAncestorContainer.ownerDocument;
		if (!doc) return null;
		let targetElement;
		// In most cases, the range will wrap a single child of the
		// commonAncestorContainer. Build a selector targeting that element,
		// not the container.
		if (range.startContainer === range.endContainer
			&& range.startOffset == range.endOffset - 1
			&& range.startContainer.nodeType == Node.ELEMENT_NODE) {
			targetElement = range.startContainer.childNodes[range.startOffset];
		}
		else {
			targetElement = range.commonAncestorContainer;
		}
		let targetElementQuery = getUniqueSelectorContaining(targetElement, doc.body);
		if (targetElementQuery) {
			let newCommonAncestor = doc.body.querySelector(targetElementQuery);
			if (!newCommonAncestor) {
				return null;
			}
			let selector: CssSelector = {
				type: 'CssSelector',
				value: targetElementQuery
			};
			// If the user has highlighted the full text content of the element, no need to add a
			// TextPositionSelector.
			if (range.toString().trim() !== (newCommonAncestor.textContent || '').trim()) {
				selector.refinedBy = textPositionFromRange(range, newCommonAncestor) || undefined;
			}
			return selector;
		}
		else {
			return textPositionFromRange(range, doc.body);
		}
	}

	toDisplayedRange(selector: Selector): Range | null {
		switch (selector.type) {
			case 'CssSelector': {
				if (selector.refinedBy && selector.refinedBy.type != 'TextPositionSelector') {
					throw new Error('CssSelectors can only be refined by TextPositionSelectors');
				}
				let root = this._iframeDocument.querySelector(selector.value);
				if (!root) {
					return null;
				}
				let range;
				if (selector.refinedBy) {
					range = textPositionToRange(selector.refinedBy, root);
				}
				else {
					range = this._iframeDocument.createRange();
					range.selectNodeContents(root);
				}
				if (!range.getClientRects().length) {
					try {
						range.selectNode(range.commonAncestorContainer);
					}
					catch (e) {
						return null;
					}
				}
				return range;
			}
			case 'TextPositionSelector': {
				if (selector.refinedBy) {
					throw new Error('Refinement of TextPositionSelectors is not supported');
				}
				return textPositionToRange(selector, this._iframeDocument.body);
			}
			default:
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}

	private _getSearchContext() {
		if (!this._searchContext) {
			this._searchContext = createSearchContext(getVisibleTextNodes(this._iframeDocument.body));
		}
		return this._searchContext;
	}

	// Popups:
	// - For each popup (except find popup) 'rect' bounding box has to be provided.
	// 	 The popup is then automatically positioned around this rect.
	// - If popup needs to be updated (i.e. its position), just reopen it.
	// - Popup has to be updated (reopened) each time when the view is scrolled or resized.
	// - annotation, selection and overlay popups are closed by calling this._onSetSomePopup()
	//   with no arguments

	_pushCurrentLocationToNavStack() {
		this._navStack.push([this._iframeWindow.scrollX, this._iframeWindow.scrollY]);
		this._updateViewStats();
	}

	protected _navigateToSelector(selector: Selector, options: NavigateOptions = {}) {
		let range = this.toDisplayedRange(selector);
		if (range) {
			getStartElement(range)?.scrollIntoView(options);
		}
		else {
			console.warn('Not a valid snapshot selector', selector);
		}
	}

	protected override _updateViewState() {
		let scale = Math.round(this._scale * 1000) / 1000; // Three decimal places
		let scrollYPercent = this._iframeWindow.scrollY
			/ (this._iframeDocument.body.scrollHeight - this._iframeDocument.documentElement.clientHeight)
			* 100;
		// The calculation above shouldn't ever yield NaN, but just to be safe:
		if (isNaN(scrollYPercent)) {
			scrollYPercent = 0;
		}
		// Keep it within [0, 100]
		scrollYPercent = Math.max(0, Math.min(100, scrollYPercent));
		scrollYPercent = Math.round(scrollYPercent * 10) / 10; // One decimal place
		let viewState: SnapshotViewState = {
			scale,
			scrollYPercent,
		};
		this._options.onChangeViewState(viewState);
	}

	protected override _updateViewStats() {
		let viewStats: ViewStats = {
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this._scale === undefined || this._scale < 1.5,
			canZoomOut: this._scale === undefined || this._scale > 0.6,
			canZoomReset: this._scale !== undefined && this._scale !== 1,
			canNavigateBack: this._navStack.canPopBack(),
			canNavigateForward: this._navStack.canPopForward(),
		};
		this._options.onChangeViewStats(viewStats);
	}

	// ***
	// Event handlers
	// ***

	protected _handleInternalLinkClick(link: HTMLAnchorElement): void {
		this._iframeDocument.location.hash = link.getAttribute('href')!;
		this._updateViewState();
	}

	protected override _handleScroll() {
		super._handleScroll();
		this._updateViewState();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	// Unlike annotation, selection and overlay popups, find popup open state is determined
	// with .open property. All popup properties are preserved even when it's closed
	setFindState(state: FindState) {
		let previousState = this._findState;
		this._findState = state;
		if (!state.active && previousState && previousState.active !== state.active) {
			console.log('Closing find popup');
			if (this._find) {
				this._find = null;
				this._handleViewUpdate();
			}
		}
		else if (state.active) {
			if (!previousState
				|| previousState.query !== state.query
				|| previousState.caseSensitive !== state.caseSensitive
				|| previousState.entireWord !== state.entireWord
				|| previousState.active !== state.active) {
				console.log('Initiating new search', state);
				this._find = new DefaultFindProcessor({
					searchContext: this._getSearchContext(),
					findState: { ...state },
					onSetFindState: this._options.onSetFindState,
				});
				this.findNext();
			}
			else if (previousState && previousState.highlightAll !== state.highlightAll) {
				this._find!.findState.highlightAll = state.highlightAll;
				this._renderAnnotations();
			}
		}
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	findNext() {
		console.log('Find next');
		if (this._find) {
			let result = this._find.next();
			if (result) {
				getStartElement(result.range)?.scrollIntoView({ block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	findPrevious() {
		console.log('Find previous');
		if (this._find) {
			let result = this._find.prev();
			if (result) {
				getStartElement(result.range)?.scrollIntoView({ block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	zoomIn() {
		let scale = this._scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._setScale(scale);
		this._handleViewUpdate();
	}

	zoomOut() {
		let scale = this._scale;
		if (scale === undefined) scale = 1;
		scale -= 0.1;
		this._setScale(scale);
		this._handleViewUpdate();
	}

	zoomReset() {
		this._setScale(1);
		this._handleViewUpdate();
	}

	private _setScale(scale: number) {
		this._scale = scale;
		if (scale == 1) {
			this._iframeDocument.documentElement.style.fontSize = '';
			return;
		}

		// Calculate the default root font size, then multiply by scale.
		// Can't just set font-size to an em value -- the page itself might set a font-size on <html>, and we need to
		// scale relative to that.
		this._iframeDocument.documentElement.style.fontSize = '';
		let defaultSize = parseFloat(getComputedStyle(this._iframeDocument.documentElement).fontSize);
		this._iframeDocument.documentElement.style.fontSize = (defaultSize * scale) + 'px';
	}

	override navigate(location: NavLocation, options: NavigateOptions = {}) {
		console.log('Navigating to', location);
		if (!options.skipNavStack) {
			this._pushCurrentLocationToNavStack();
		}
		options.behavior ||= 'smooth';
		super.navigate(location, options);
	}

	navigateBack() {
		if (this._navStack.canPopBack()) {
			this._iframeWindow.scrollTo(...this._navStack.popBack());
			this._handleViewUpdate();
		}
	}

	navigateForward() {
		if (this._navStack.canPopForward()) {
			this._iframeWindow.scrollTo(...this._navStack.popForward());
			this._handleViewUpdate();
		}
	}

	// Still need to figure out how this is going to work
	print() {
		console.log('Print');
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		// Ignore
	}
}

export interface SnapshotViewState extends DOMViewState {
	scrollYPercent?: number;
}

export interface SnapshotViewData {
	srcDoc?: string;
}

export default SnapshotView;
