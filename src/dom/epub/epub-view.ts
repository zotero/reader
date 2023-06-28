import {
	AnnotationType,
	FindState,
	NavLocation,
	NewAnnotation,
	OutlineItem,
	ViewStats,
	WADMAnnotation
} from "../../common/types";
import Epub, {
	Book,
	EpubCFI,
	NavItem,
} from "epubjs";
import {
	moveRangeEndsIntoTextNodes
} from "../common/lib/range";
import {
	FragmentSelector,
	FragmentSelectorConformsTo,
	isFragment,
	Selector
} from "../common/lib/selector";
import { EPUBFindProcessor } from "./find";
import NavStack from "../common/lib/nav-stack";
import DOMView, {
	DOMViewOptions,
	NavigateOptions,
	CustomScrollIntoViewOptions,
	DOMViewState
} from "../common/dom-view";
import SectionView from "./section-view";
import Section from "epubjs/types/section";
import { closestElement } from "../common/lib/nodes";
import StyleScoper from "./lib/style-scoper";
import PageMapping from "./lib/page-mapping";
import { debounce } from "../../common/lib/debounce";
import {
	lengthenCFI,
	shortenCFI
} from "./cfi";

// @ts-ignore
import contentCSS from '!!raw-loader!./stylesheets/content.css';

// The module resolver is incapable of understanding this
// @ts-ignore
import Path from "epubjs/src/utils/path";

// - All views use iframe to render and isolate the view from the parent window
// - If need to add additional build steps, a submodule or additional files see pdfjs/
//   directory in the project root and "scripts" part in packages.json
// - If view needs styling, it should provide and load its own CSS file like pdfjs/viewer.css,
//   because SCSS in src/common/stylesheets is only for the main window
// - Update demo data in demo/epub and demo/snapshot directories:
//   - Add demo annotations

class EPUBView extends DOMView<EPUBViewState> {
	protected _find: EPUBFindProcessor | null = null;

	private readonly _book: Book;

	private _sectionsContainer!: HTMLElement;

	private readonly _sectionViews: SectionView[] = [];

	private _cachedStartView: SectionView | null = null;

	private _cachedStartRange: Range | null = null;

	private _cachedStartCFI: EpubCFI | null = null;

	private _cachedEndView: SectionView | null = null;

	protected readonly _navStack = new NavStack<string>();

	private _animatingPageTurn = false;

	private _touchStartID: number | null = null;

	private _touchStartX = 0;

	private readonly _pageMapping = new PageMapping();

	private readonly _rangeCache = new Map<string, Range>();

	private _pageProgressionRTL!: boolean;

	private _scale = 1;

	private _flowMode: FlowMode = 'scrolled';

	private _savedPageMapping!: string;

	constructor(options: DOMViewOptions<EPUBViewState>) {
		super(options);
		this._book = Epub(options.buf.buffer);
	}

	protected _getSrcDoc() {
		return '<!DOCTYPE html><html><body></body></html>';
	}

	protected async _onInitialDisplay(viewState: Partial<Readonly<EPUBViewState>>) {
		await this._book.opened;

		this._pageProgressionRTL = this._book.packaging.metadata.direction === 'rtl';

		let style = this._iframeDocument.createElement('style');
		style.innerHTML = contentCSS;
		this._iframeDocument.head.append(style);

		let swipeIndicatorLeft = this._iframeDocument.createElement('div');
		swipeIndicatorLeft.classList.add('swipe-indicator-left');
		this._iframeDocument.body.append(swipeIndicatorLeft);

		let swipeIndicatorRight = this._iframeDocument.createElement('div');
		swipeIndicatorRight.classList.add('swipe-indicator-right');
		this._iframeDocument.body.append(swipeIndicatorRight);

		this._sectionsContainer = this._iframeDocument.createElement('div');
		this._sectionsContainer.classList.add('sections');
		this._sectionsContainer.hidden = true;
		this._sectionsContainer.addEventListener('transitionstart', this._handleTransitionStart);
		this._sectionsContainer.addEventListener('transitionend', this._handleTransitionEnd);
		this._iframeDocument.body.addEventListener('touchstart', this._handleTouchStart);
		this._iframeDocument.body.addEventListener('touchmove', this._handleTouchMove);
		this._iframeDocument.body.addEventListener('touchend', this._handleTouchEnd);
		this._iframeDocument.body.append(this._sectionsContainer);

		let styleScoper = new StyleScoper(this._iframeDocument);
		await Promise.all(this._book.spine.spineItems.map(section => this._displaySection(section, styleScoper)));
		styleScoper.rewriteAll();

		if (this._options.fontFamily) {
			this._iframeDocument.documentElement.style.setProperty('--content-font-family', this._options.fontFamily);
		}

		this._sectionsContainer.hidden = false;
		await this._initPageMapping(viewState);
		this._initOutline();

		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState

		this._scale = viewState.scale || 1;
		this._iframeDocument.documentElement.style.setProperty('--content-scale', String(this._scale));

		if (viewState.flowMode) {
			this.setFlowMode(viewState.flowMode);
		}
		else {
			this.setFlowMode('scrolled');
		}
		if (viewState.cfi) {
			let cfi = lengthenCFI(viewState.cfi);
			// Perform the navigation on the next frame, because apparently the split view layout might not have
			// settled yet
			await new Promise(resolve => requestAnimationFrame(resolve));
			this.navigate({ pageNumber: cfi }, { behavior: 'auto' });
		}
	}

	private async _displaySection(section: Section, styleScoper: StyleScoper) {
		let container = this._iframeDocument.createElement('div');
		container.id = 'section-' + section.index;
		container.classList.add('section-container', 'cfi-stop');
		container.setAttribute('data-section-index', String(section.index));
		this._sectionsContainer.append(container);
		let sectionView = new SectionView({
			section,
			container,
			window: this._iframeWindow,
			document: this._iframeDocument,
			styleScoper,
		});
		let html = await section.render(this._book.archive.request.bind(this._book.archive));
		await sectionView.initWithHTML(html);
		this._sectionViews[section.index] = sectionView;
	}

	private async _initPageMapping(viewState: Partial<Readonly<EPUBViewState>>) {
		let localStorageKey = this._book.key() + '-page-mapping';
		let savedPageMapping = viewState.savedPageMapping;
		if (window.dev && !savedPageMapping) {
			savedPageMapping = window.localStorage.getItem(localStorageKey) || undefined;
		}

		// Use persisted page mappings if present
		if (savedPageMapping && this._pageMapping.load(savedPageMapping, this)) {
			this._savedPageMapping = savedPageMapping;
			this._updateViewStats();
			return;
		}

		// Otherwise, extract physical page numbers and fall back to EPUB locations
		this._pageMapping.generate(this._sectionViews.values());
		this._updateViewStats();
		this._savedPageMapping = savedPageMapping = this._pageMapping.save(this);
		this._updateViewState();
		if (window.dev) {
			window.localStorage.setItem(localStorageKey, savedPageMapping);
		}
	}

	private _initOutline() {
		if (!this._book.navigation.toc.length) {
			return;
		}
		let navPath = new Path(this._book.packaging.navPath || this._book.packaging.ncxPath || '');
		let toOutlineItem: (navItem: NavItem) => OutlineItem = navItem => ({
			title: navItem.label,
			location: {
				href: navPath.resolve(navItem.href).replace(/^\//, '')
			},
			items: navItem.subitems?.map(toOutlineItem),
			expanded: true,
		});
		this._options.onSetOutline(this._book.navigation.toc.map(toOutlineItem));
	}

	protected override _getAnnotationOverlayParent() {
		return this._iframeDocument?.body;
	}

	protected override _renderAnnotations() {
		if (this._animatingPageTurn) {
			let shown = this._showAnnotations;
			this._showAnnotations = false;
			super._renderAnnotations();
			this._showAnnotations = shown;
		}
		else {
			super._renderAnnotations();
		}
	}

	getCFI(rangeOrNode: Range | Node): EpubCFI | null {
		let commonAncestorNode;
		if ('nodeType' in rangeOrNode) {
			commonAncestorNode = rangeOrNode;
		}
		else {
			commonAncestorNode = rangeOrNode.commonAncestorContainer;
		}
		let sectionContainer = closestElement(commonAncestorNode)?.closest('[data-section-index]');
		if (!sectionContainer) {
			return null;
		}
		let section = this._book.section(sectionContainer.getAttribute('data-section-index')!);
		return new EpubCFI(rangeOrNode, section.cfiBase);
	}

	getRange(cfi: EpubCFI | string): Range | null {
		if (!this._sectionViews.length) {
			// The book isn't loaded yet -- don't spam the console
			return null;
		}
		let cfiString = cfi.toString();
		if (this._rangeCache.has(cfiString)) {
			return this._rangeCache.get(cfiString)!.cloneRange();
		}
		if (typeof cfi === 'string') {
			cfi = new EpubCFI(cfi);
		}
		let view = this._sectionViews[cfi.spinePos];
		if (!view) {
			console.error('Unable to find view for CFI', cfiString);
			return null;
		}
		let range = cfi.toRange(this._iframeDocument, undefined, view.container);
		if (!range) {
			console.error('Unable to get range for CFI', cfiString);
			return null;
		}
		this._rangeCache.set(cfiString, range.cloneRange());
		return range;
	}

	override toSelector(range: Range): FragmentSelector | null {
		range = moveRangeEndsIntoTextNodes(range);
		let cfi = this.getCFI(range);
		if (!cfi) {
			return null;
		}
		return {
			type: 'FragmentSelector',
			conformsTo: FragmentSelectorConformsTo.EPUB3,
			value: cfi.toString()
		};
	}

	override toDisplayedRange(selector: Selector): Range | null {
		switch (selector.type) {
			case 'FragmentSelector': {
				if (selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
					throw new Error(`Unsupported FragmentSelector.conformsTo: ${selector.conformsTo}`);
				}
				if (selector.refinedBy) {
					throw new Error('Refinement of FragmentSelectors is not supported');
				}
				return this.getRange(selector.value);
			}
			default:
				// No other selector types supported on EPUBs
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}

	get views(): SectionView[] {
		return this._sectionViews;
	}

	get startView(): SectionView | null {
		if (!this._cachedStartView) {
			this._updateBoundaries();
		}
		return this._cachedStartView;
	}

	get startRange(): Range | null {
		if (!this._cachedStartRange) {
			this._updateBoundaries();
		}
		return this._cachedStartRange;
	}

	get startCFI(): EpubCFI | null {
		if (!this._cachedStartCFI) {
			this._updateBoundaries();
		}
		return this._cachedStartCFI;
	}

	get endView(): SectionView | null {
		if (!this._cachedEndView) {
			this._updateBoundaries();
		}
		return this._cachedEndView;
	}

	get visibleViews(): SectionView[] {
		if (!this._cachedStartView || !this._cachedEndView) {
			this._updateBoundaries();
		}
		if (!this._cachedStartView || !this._cachedEndView) {
			return [];
		}
		let startIdx = this._sectionViews.indexOf(this._cachedStartView);
		let endIdx = this._sectionViews.indexOf(this._cachedEndView);
		return this._sectionViews.slice(startIdx, endIdx + 1);
	}

	private _invalidateStartRangeAndCFI = debounce(
		() => {
			this._cachedStartRange = null;
			this._cachedStartCFI = null;
			this._updateBoundaries();
			this._updateViewState();
			this._updateViewStats();
		},
		50
	);

	private _updateBoundaries() {
		let foundStart = false;
		for (let view of this._sectionViews.values()) {
			let rect = view.container.getBoundingClientRect();
			let visible = this._flowMode == 'paginated'
				? !(rect.left > this._iframe.clientWidth || rect.right < 0)
				: !(rect.top > this._iframe.clientHeight || rect.bottom < 0);
			if (!foundStart) {
				if (!visible) {
					continue;
				}
				this._cachedStartView = view;
				let startRange = view.getFirstVisibleRange(
					this._flowMode == 'paginated',
					false
				);
				let startCFIRange = view.getFirstVisibleRange(
					this._flowMode == 'paginated',
					true
				);
				if (startRange) {
					startRange.collapse(true);
					this._cachedStartRange = startRange;
				}
				if (startCFIRange) {
					startCFIRange.collapse(true);
					this._cachedStartCFI = new EpubCFI(startCFIRange, view.section.cfiBase);
				}
				if (startRange && startCFIRange) {
					foundStart = true;
				}
			}
			else if (!visible) {
				this._cachedEndView = view;
				break;
			}
		}
	}

	private _pushCurrentLocationToNavStack() {
		let cfi = this.startCFI?.toString();
		if (cfi) {
			this._navStack.push(cfi);
			this._updateViewStats();
		}
	}

	protected _navigateToSelector(selector: Selector, options: NavigateOptions = {}) {
		if (!isFragment(selector) || selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
			console.warn("Not a CFI FragmentSelector", selector);
			return;
		}
		this.navigate({ pageNumber: selector.value }, options);
	}

	protected _getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		range = moveRangeEndsIntoTextNodes(range);
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

		let pageLabel = this._pageMapping.isPhysical && this._pageMapping.getPageLabel(range) || '';

		// Use the number of characters between the start of the section and the start of the selection range
		// to disambiguate the sortIndex
		let sectionContainer = closestElement(range.startContainer)?.closest('[data-section-index]');
		if (!sectionContainer) {
			return null;
		}
		let sectionIndex = parseInt(sectionContainer.getAttribute('data-section-index')!);
		let offsetRange = this._iframeDocument.createRange();
		offsetRange.setStart(sectionContainer, 0);
		offsetRange.setEnd(range.startContainer, range.startOffset);
		let sortIndex = String(sectionIndex).padStart(5, '0') + '|' + String(offsetRange.toString().length).padStart(8, '0');
		return {
			type,
			color,
			sortIndex,
			pageLabel,
			position: selector,
			text
		};
	}

	protected _isExternalLink(link: HTMLAnchorElement) {
		let href = link.getAttribute('href');
		if (!href) {
			return false;
		}
		return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
	}

	// ***
	// Event handlers
	// ***

	private _handleTransitionStart = (event: TransitionEvent) => {
		if (this._flowMode != 'paginated') {
			return;
		}
		if (event.propertyName == 'left') {
			this._animatingPageTurn = true;
			this._handleViewUpdate();
		}
	};

	private _handleTransitionEnd = (event: TransitionEvent) => {
		if (this._flowMode != 'paginated') {
			return;
		}
		if (event.propertyName == 'left') {
			this._animatingPageTurn = false;
			this._handleViewUpdate();
		}
	};

	private _handleTouchStart = (event: TouchEvent) => {
		if (this._flowMode != 'paginated' || this._touchStartID !== null) {
			return;
		}
		this._touchStartID = event.changedTouches[0].identifier;
		this._touchStartX = event.changedTouches[0].clientX;
	};

	private _handleTouchMove = (event: TouchEvent) => {
		if (this._flowMode != 'paginated' || this._touchStartID === null || this._animatingPageTurn) {
			return;
		}
		let touch = Array.from(event.changedTouches).find(touch => touch.identifier === this._touchStartID);
		if (!touch) {
			return;
		}
		event.preventDefault();
		let swipeAmount = (touch.clientX - this._touchStartX) / 100;
		// If on the first/last page, clamp the CSS variable so the indicator doesn't expand all the way
		if (swipeAmount < 0 && !this.canNavigateToNextPage()) {
			swipeAmount = Math.max(swipeAmount, -0.6);
		}
		else if (swipeAmount > 0 && !this.canNavigateToPreviousPage()) {
			swipeAmount = Math.min(swipeAmount, 0.6);
		}
		this._iframeDocument.body.classList.add('swiping');
		this._iframeDocument.documentElement.style.setProperty('--swipe-amount', swipeAmount.toString());
	};

	private _handleTouchEnd = (event: TouchEvent) => {
		if (this._flowMode != 'paginated' || this._touchStartID === null) {
			return;
		}
		let touch = Array.from(event.changedTouches).find(touch => touch.identifier === this._touchStartID);
		if (!touch) {
			return;
		}
		event.preventDefault();
		this._iframeDocument.body.classList.remove('swiping');
		this._iframeDocument.documentElement.style.setProperty('--swipe-amount', '0');
		this._touchStartID = null;

		// Don't actually switch pages if we're already doing that
		if (this._animatingPageTurn) {
			return;
		}

		// Switch pages after swiping 100px
		let swipeAmount = (touch.clientX - this._touchStartX) / 100;
		if (swipeAmount <= -1) {
			this.navigateToNextPage();
		}
		if (swipeAmount >= 1) {
			this.navigateToPreviousPage();
		}
	};

	protected override _handleResize() {
		let beforeCFI = this.startCFI;
		if (beforeCFI) {
			this.navigate({ pageNumber: beforeCFI.toString() }, { skipNavStack: true, behavior: 'auto' });
		}
		this._handleViewUpdate();
	}

	protected override _handleScroll() {
		super._handleScroll();
		this._invalidateStartRangeAndCFI();
	}

	protected _handleInternalLinkClick(link: HTMLAnchorElement) {
		let href = link.getAttribute('href')!;
		let section = this._sectionViews.find(view => view.container.contains(link))?.section;
		if (!section) {
			return;
		}
		// This is a hack - we're using the URL constructor to resolve the relative path based on the section's
		// canonical URL, but it'll error without a host. So give it one!
		let url = new URL(href, new URL(section.canonical, 'https://www.example.com/'));
		href = url.pathname + url.hash;
		this.navigate({ href: this._book.path.relative(href) });
	}

	protected override _handleKeyDown(event: KeyboardEvent) {
		let { key } = event;

		if (this._flowMode == 'paginated') {
			if (key == 'PageUp') {
				this.navigateToPreviousPage();
				event.preventDefault();
				return;
			}
			if (key == 'PageDown') {
				this.navigateToNextPage();
				event.preventDefault();
				return;
			}
			if (key == 'Home') {
				this.navigateToFirstPage();
				event.preventDefault();
				return;
			}
			if (key == 'End') {
				this.navigateToLastPage();
				event.preventDefault();
				return;
			}
		}

		if (key == 'ArrowLeft') {
			if (this._pageProgressionRTL) {
				this.navigateToNextPage();
			}
			else {
				this.navigateToPreviousPage();
			}
			event.preventDefault();
			return;
		}
		if (key == 'ArrowRight') {
			if (this._pageProgressionRTL) {
				this.navigateToPreviousPage();
			}
			else {
				this.navigateToNextPage();
			}
			event.preventDefault();
			return;
		}

		super._handleKeyDown(event);
	}

	protected override _updateViewState() {
		if (!this.startCFI) {
			return;
		}
		let viewState: EPUBViewState = {
			scale: Math.round(this._scale * 1000) / 1000, // Three decimal places
			cfi: shortenCFI(this.startCFI.toString(true)),
			savedPageMapping: this._savedPageMapping,
			flowMode: this._flowMode,
		};
		this._options.onChangeViewState(viewState);
	}

	// View stats provide information about the view
	protected override _updateViewStats() {
		let startRange = this.startRange;
		let pageIndex = startRange && this._pageMapping.getPageIndex(startRange);
		let pageLabel = startRange && this._pageMapping.getPageLabel(startRange);
		let canNavigateToPreviousPage = this.canNavigateToPreviousPage();
		let canNavigateToNextPage = this.canNavigateToNextPage();
		let viewStats: ViewStats = {
			pageIndex: pageIndex ?? undefined,
			pageLabel: pageLabel ?? undefined,
			pagesCount: this._pageMapping.length,
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this._scale === undefined || this._scale < 1.5,
			canZoomOut: this._scale === undefined || this._scale > 0.8,
			canZoomReset: this._scale !== undefined && this._scale !== 1,
			canNavigateBack: this._navStack.canPopBack(),
			canNavigateForward: this._navStack.canPopForward(),
			canNavigateToFirstPage: canNavigateToPreviousPage,
			canNavigateToLastPage: canNavigateToNextPage,
			canNavigateToPreviousPage,
			canNavigateToNextPage,
			canNavigateToPreviousSection: this.canNavigateToPreviousSection(),
			canNavigateToNextSection: this.canNavigateToNextSection(),
			flowMode: this._flowMode,
		};
		this._options.onChangeViewStats(viewStats);
	}

	protected override _handleViewUpdate() {
		super._handleViewUpdate();
		this._invalidateStartRangeAndCFI();
		if (this._find) {
			this._find.handleViewUpdate();
		}
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
				this._find = new EPUBFindProcessor({
					view: this,
					startRange: this.startRange!,
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

	setFlowMode(flowMode: FlowMode) {
		let cfiBefore = this.startCFI;
		switch (flowMode) {
			case 'paginated':
				for (let elem of [this._iframe, this._iframeDocument.body]) {
					elem.classList.add('paginated');
					elem.classList.remove('scrolled');
				}
				break;
			case 'scrolled':
				for (let elem of [this._iframe, this._iframeDocument.body]) {
					elem.classList.add('scrolled');
					elem.classList.remove('paginated');
				}
				break;
		}
		this._flowMode = flowMode;
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, { skipNavStack: true, behavior: 'auto' });
		}
	}

	setFontFamily(fontFamily: string) {
		this._iframeDocument.documentElement.style.setProperty('--content-font-family', fontFamily);
		this._renderAnnotations();
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	async findNext() {
		console.log('Find next');
		if (this._find) {
			let processor = this._find;
			let result = processor.next();
			if (result) {
				this._scrollIntoView(result.range);
			}
			this._renderAnnotations();
		}
	}

	async findPrevious() {
		console.log('Find previous');
		if (this._find) {
			let processor = this._find;
			let result = processor.prev();
			if (result) {
				this._scrollIntoView(result.range);
			}
			this._renderAnnotations();
		}
	}

	zoomIn() {
		let cfiBefore = this.startCFI;
		let scale = this._scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._scale = scale;
		this._iframeDocument.documentElement.style.setProperty('--content-scale', String(scale));
		this._handleViewUpdate();
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, { skipNavStack: true, behavior: 'auto' });
		}
	}

	zoomOut() {
		let cfiBefore = this.startCFI;
		let scale = this._scale;
		if (scale === undefined) scale = 1;
		scale -= 0.1;
		this._scale = scale;
		this._iframeDocument.documentElement.style.setProperty('--content-scale', String(scale));
		this._handleViewUpdate();
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, { skipNavStack: true, behavior: 'auto' });
		}
	}

	zoomReset() {
		let cfiBefore = this.startCFI;
		this._scale = 1;
		this._iframeDocument.documentElement.style.setProperty('--content-scale', '1');
		this._handleViewUpdate();
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, { skipNavStack: true, behavior: 'auto' });
		}
	}

	override navigate(location: NavLocation, options: NavigateOptions = {}) {
		console.log('Navigating to', location);
		if (!options.skipNavStack) {
			this._pushCurrentLocationToNavStack();
		}
		options.behavior ||= 'smooth';

		if (location.pageNumber) {
			options.block ||= 'start';

			let range;
			if (location.pageNumber.startsWith('epubcfi(')) {
				range = this.getRange(location.pageNumber);
			}
			else {
				range = this._pageMapping.getRange(location.pageNumber);
			}

			if (!range) {
				console.error('Unable to find range');
				return;
			}
			this._scrollIntoView(range, options);
		}
		else if (location.href) {
			options.block ||= 'start';

			let [pathname, hash] = location.href.split('#');
			let section = this._book.spine.get(pathname);
			if (!section) {
				console.error('Unable to find section for pathname', pathname);
				return;
			}
			let target = hash && this._sectionViews[section.index].container
				.querySelector('[id="' + hash.replace(/"/g, '"') + '"]');
			if (target) {
				this._scrollIntoView(target as HTMLElement, options);
			}
			else {
				let view = this._sectionViews[section.index];
				if (!view) {
					console.error('Unable to find view for section', section.index);
					return;
				}
				this._scrollIntoView(view.container, options);
			}
		}
		else {
			super.navigate(location, options);
		}
	}

	private _scrollIntoView(target: Range | HTMLElement, options?: CustomScrollIntoViewOptions) {
		if (this._flowMode == 'paginated') {
			this._scrollIntoViewPaginated(target);
			return;
		}

		let rect = target.getBoundingClientRect();

		if (options?.ifNeeded && (rect.top >= 0 && rect.bottom < this._iframe.clientHeight)) {
			return;
		}

		// Disable smooth scrolling when target is too far away
		if (options?.behavior == 'smooth'
				&& Math.abs(rect.top + rect.bottom / 2) > this._iframe.clientHeight * 2) {
			options.behavior = 'auto';
		}

		if ('nodeType' in target) {
			target.scrollIntoView(options);
			return;
		}

		let x = rect.x + rect.width / 2;
		let y = rect.y;
		if (options && options.block == 'center') {
			y += rect.height / 2;
			y -= this._iframe.clientHeight / 2;
		}
		this._iframeWindow.scrollBy({
			...options,
			left: x,
			top: y,
		});
		this._invalidateStartRangeAndCFI();
	}

	private _scrollIntoViewPaginated(target: Range | HTMLElement) {
		if ('nodeType' in target) {
			let elemOffset = target.offsetLeft;
			let spreadWidth = this._sectionsContainer.offsetWidth + 60;
			let pageIndex = Math.floor(elemOffset / spreadWidth);
			this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex));
			this._handleViewUpdate();
		}
		else {
			let rect = target.getBoundingClientRect();
			let x = rect.x + rect.width / 2 - this._sectionsContainer.offsetLeft;
			let spreadWidth = this._sectionsContainer.offsetWidth + 60;
			let pageIndex = Math.floor(x / spreadWidth);
			this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex));
			this._handleViewUpdate();
		}
	}

	// This is like back/forward navigation in browsers. Try Cmd-ArrowLeft and Cmd-ArrowRight in PDF view
	navigateBack() {
		this.navigate({ pageNumber: this._navStack.popBack() }, {
			skipNavStack: true,
			behavior: 'auto',
		});
	}

	navigateForward() {
		this.navigate({ pageNumber: this._navStack.popForward() }, {
			skipNavStack: true,
			behavior: 'auto',
		});
	}

	navigateToFirstPage() {
		this.navigate({ href: this._book.spine.first().href });
	}

	navigateToLastPage() {
		this.navigate({ href: this._book.spine.last().href });
	}

	canNavigateToPreviousPage() {
		if (this._flowMode == 'paginated') {
			return parseInt(this._iframeDocument.documentElement.style.getPropertyValue('--page-index') || '0') > 0;
		}
		else {
			return this._iframeWindow.scrollY >= this._iframe.clientHeight;
		}
	}

	canNavigateToNextPage() {
		if (this._flowMode == 'paginated') {
			// scrollWidth approaches offsetWidth as we advance toward the last page
			return this._iframeDocument.documentElement.scrollWidth > this._iframeDocument.documentElement.offsetWidth;
		}
		else {
			return this._iframeWindow.scrollY < this._iframeDocument.documentElement.scrollHeight - this._iframe.clientHeight;
		}
	}

	navigateToPreviousPage() {
		if (!this.canNavigateToPreviousPage()) {
			return;
		}
		if (this._flowMode != 'paginated') {
			this._iframeWindow.scrollBy({ top: -this._iframe.clientHeight + 35 * this._scale });
			return;
		}
		let pageIndex = parseInt(this._iframeDocument.documentElement.style.getPropertyValue('--page-index') || '0');
		this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex - 1));
		this._handleViewUpdate();
		this._maybeDisablePageTurnTransition();
	}

	navigateToNextPage() {
		if (!this.canNavigateToNextPage()) {
			return;
		}
		if (this._flowMode != 'paginated') {
			this._iframeWindow.scrollBy({ top: this._iframe.clientHeight - 35 * this._scale });
			return;
		}
		let pageIndex = parseInt(this._iframeDocument.documentElement.style.getPropertyValue('--page-index') || '0');
		this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex + 1));
		this._handleViewUpdate();
		this._maybeDisablePageTurnTransition();
	}

	canNavigateToPreviousSection() {
		return !!this.startView?.section.prev();
	}

	canNavigateToNextSection() {
		return !!this.startView?.section.next();
	}

	navigateToPreviousSection() {
		let section = this.startView?.section.prev();
		if (section) {
			this.navigate({ href: section.href });
		}
	}

	navigateToNextSection() {
		let section = this.startView?.section.next();
		if (section) {
			this.navigate({ href: section.href });
		}
	}

	private _maybeDisablePageTurnTransition() {
		if (this._animatingPageTurn || this._sectionsContainer.classList.contains('disable-transition')) {
			this._animatingPageTurn = false;
			this._sectionsContainer.classList.add('disable-transition');
			this._enablePageTurnTransition();
		}
	}

	private _enablePageTurnTransition = debounce(() => {
		this._sectionsContainer.classList.remove('disable-transition');
	}, 250);

	// Still need to figure out how this is going to work
	print() {
		console.log('Print');
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		window.dispatchEvent(new Event('resize'));
	}
}

type FlowMode = 'paginated' | 'scrolled';

export interface EPUBViewState extends DOMViewState {
	cfi?: string;
	savedPageMapping?: string;
	flowMode?: FlowMode;
}

export default EPUBView;
