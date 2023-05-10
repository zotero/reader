import {
	isSafari
} from '../../common/lib/utilities';
import {
	AnnotationType,
	WADMAnnotation,
	FindState,
	NavLocation,
	NewAnnotation,
	ViewStats
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
import DOMPurify from "dompurify";
import {
	DOMPURIFY_CONFIG,
	getVisibleTextNodes
} from "../common/lib/nodes";
import DefaultFindProcessor from "../common/find";
import {
	createSearchContext,
	SearchContext
} from "../common/lib/dom-text-search";

// @ts-ignore
import contentCSS from '!!raw-loader!./stylesheets/content.css';

class SnapshotView extends DOMView<DOMViewState> {
	private readonly _navStack = new NavStack<[number, number]>();

	protected _find: DefaultFindProcessor | null = null;
	
	private _searchContext: SearchContext | null = null;

	protected _getSrcDoc() {
		const enc = new TextDecoder('utf-8');
		const text = enc.decode(this._options.buf);
		if (isSafari) {
			const doc = new DOMParser().parseFromString(text, 'text/html');
			doc.documentElement.replaceWith(DOMPurify.sanitize(doc.documentElement, {
				...DOMPURIFY_CONFIG,
				RETURN_DOM: true,
			}));
			return new XMLSerializer().serializeToString(doc);
		}
		else {
			return text;
		}
	}

	protected _onInitialDisplay(viewState: Partial<DOMViewState>) {
		const style = this._iframeDocument.createElement('style');
		style.innerHTML = contentCSS;
		this._iframeDocument.head.append(style);

		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		if (viewState.scale !== undefined) {
			this._iframeDocument.documentElement.style.fontSize = viewState.scale + 'em';
		}
	}

	protected _getAnnotationOverlayParent() {
		return this._iframeDocument?.body;
	}

	protected _getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		if (range.collapsed) {
			return null;
		}
		const text = range.toString();
		const selector = this.toSelector(range);
		if (!selector) {
			return null;
		}
		const sortIndex = this._getSortIndex(range);
		return {
			type,
			color,
			sortIndex,
			position: selector,
			text
		};
	}
	
	private _getSortIndex(range: Range) {
		const iter = this._iframeDocument.createNodeIterator(this._iframeDocument.documentElement, NodeFilter.SHOW_TEXT);
		let count = 0;
		let node: Node | null;
		while ((node = iter.nextNode())) {
			if (range.startContainer.contains(node)) {
				return String(count + range.startOffset).padStart(8, '0');
			}
			count += node.nodeValue!.length;
		}
		return '0';
	}

	toSelector(range: Range): Selector | null {
		const doc = range.commonAncestorContainer.ownerDocument;
		if (!doc) return null;
		const commonAncestorQuery = getUniqueSelectorContaining(range.commonAncestorContainer, doc.body);
		if (commonAncestorQuery) {
			const newCommonAncestor = doc.body.querySelector(commonAncestorQuery);
			if (!newCommonAncestor) {
				return null;
			}
			const selector: CssSelector = {
				type: 'CssSelector',
				value: commonAncestorQuery
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
				const root = this._iframeDocument.querySelector(selector.value);
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
					range.selectNode(range.commonAncestorContainer);
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

	protected _isExternalLink(link: HTMLAnchorElement) {
		return !link.getAttribute('href')?.startsWith('#');
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

	protected override _getViewportBoundingRect(range: Range): DOMRect {
		const rect = range.getBoundingClientRect();
		return new DOMRect(
			rect.x + this._iframe.getBoundingClientRect().x - this._container.getBoundingClientRect().x,
			rect.y + this._iframe.getBoundingClientRect().y - this._container.getBoundingClientRect().y,
			rect.width,
			rect.height
		);
	}

	_pushCurrentLocationToNavStack() {
		this._navStack.push([this._iframeWindow.scrollX, this._iframeWindow.scrollY]);
		this._updateViewStats();
	}

	protected _navigateToSelector(selector: Selector, options: NavigateOptions = {}) {
		const range = this.toDisplayedRange(selector);
		if (range) {
			getStartElement(range)?.scrollIntoView(options);
		}
		else {
			console.warn('Not a valid snapshot selector', selector);
		}
	}

	protected override _updateViewState() {
		const viewState = {
			scale: 1,
			...this._viewState
		};
		this._viewState = viewState;
		this._options.onChangeViewState(viewState);
	}

	protected override _updateViewStats() {
		const viewStats: ViewStats = {
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this._viewState.scale === undefined || this._viewState.scale < 1.5,
			canZoomOut: this._viewState.scale === undefined || this._viewState.scale > 0.6,
			canZoomReset: this._viewState.scale !== undefined && this._viewState.scale !== 1,
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
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	// Unlike annotation, selection and overlay popups, find popup open state is determined
	// with .open property. All popup properties are preserved even when it's closed
	setFindState(state: FindState) {
		const previousState = this._findState;
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
			const result = this._find.next();
			if (result) {
				getStartElement(result.range)?.scrollIntoView({ block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	findPrevious() {
		console.log('Find previous');
		if (this._find) {
			const result = this._find.prev();
			if (result) {
				getStartElement(result.range)?.scrollIntoView({ block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	zoomIn() {
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._viewState.scale = scale;
		this._iframeDocument.documentElement.style.fontSize = scale + 'em';
		this._handleViewUpdate();
	}

	zoomOut() {
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale -= 0.1;
		this._viewState.scale = scale;
		this._iframeDocument.documentElement.style.fontSize = scale + 'em';
		this._handleViewUpdate();
	}

	zoomReset() {
		this._viewState.scale = 1;
		this._iframeDocument.documentElement.style.fontSize = '';
		this._handleViewUpdate();
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
		this._iframeWindow.scrollTo(...this._navStack.popBack());
		this._updateViewStats();
	}

	navigateForward() {
		this._iframeWindow.scrollTo(...this._navStack.popForward());
		this._updateViewStats();
	}

	// Still need to figure out how this is going to work
	print() {
		console.log('Print');
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		// Ignore
	}
}

export default SnapshotView;
