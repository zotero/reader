import {
	AnnotationType,
	ArrayRect,
	FindState,
	NavLocation,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	ViewStats,
	WADMAnnotation
} from "../../common/types";
import Epub, {
	Book,
	EpubCFI,
	NavItem,
} from "epubjs";
import {
	moveRangeEndsIntoTextNodes,
	PersistentRange,
	splitRangeToTextNodes
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
	DOMViewState,
	NavigateOptions
} from "../common/dom-view";
import SectionView from "./section-view";
import Section from "epubjs/types/section";
import {
	closestElement,
	getContainingBlock
} from "../common/lib/nodes";
import { StyleScoper } from "./lib/sanitize-and-render";
import PageMapping from "./lib/page-mapping";
import {
	lengthenCFI,
	shortenCFI
} from "./cfi";
import {
	Flow,
	PaginatedFlow,
	ScrolledFlow
} from "./flow";
import { RTL_SCRIPTS } from "./defines";

// @ts-ignore
import contentCSS from '!!raw-loader!./stylesheets/content.css';

// The module resolver is incapable of understanding this
// @ts-ignore
import Path from "epubjs/src/utils/path";

class EPUBView extends DOMView<EPUBViewState, EPUBViewData> {
	protected _find: EPUBFindProcessor | null = null;

	readonly book: Book;

	flow!: Flow;

	spreadMode!: SpreadMode.None | SpreadMode.Odd;

	readonly pageMapping = new PageMapping();

	scale = 1;

	private _sectionsContainer!: HTMLElement;

	private readonly _sectionViews: SectionView[] = [];

	private readonly _navStack = new NavStack<string>();

	private readonly _rangeCache = new Map<string, PersistentRange>();

	private _pageProgressionRTL!: boolean;

	private _flowMode!: FlowMode;

	private _savedPageMapping!: string;

	constructor(options: DOMViewOptions<EPUBViewState, EPUBViewData>) {
		super(options);
		if (options.data.buf) {
			this.book = Epub(options.data.buf.buffer);
			delete this._options.data.buf;
		}
		else if (options.data.baseURI) {
			this.book = Epub(options.data.baseURI, {
				openAs: 'epub'
			});
		}
		else if (options.data.book) {
			this.book = options.data.book;
		}
		else {
			throw new Error('buf, baseURI, or book is required');
		}
	}

	protected _getSrcDoc() {
		return '<!DOCTYPE html><html><body></body></html>';
	}

	getData() {
		return {
			book: this.book
		};
	}

	protected async _onInitialDisplay(viewState: Partial<Readonly<EPUBViewState>>) {
		await this.book.opened;

		let cspMeta = this._iframeDocument.createElement('meta');
		cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
		cspMeta.setAttribute('content', this._getCSP());
		this._iframeDocument.head.prepend(cspMeta);

		this._pageProgressionRTL = this.book.packaging.metadata.direction === 'rtl';
		if (!this._pageProgressionRTL) {
			try {
				let locale = new Intl.Locale(this.book.packaging.metadata.language).maximize();
				this._pageProgressionRTL = locale.script ? RTL_SCRIPTS.has(locale.script) : false;
				if (this._pageProgressionRTL) {
					console.log('Guessed RTL page progression from maximized locale: ' + locale);
				}
			}
			catch (e) {
				// Ignore
			}
		}

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
		this._sectionsContainer.lang = this.book.packaging.metadata.language;
		this._sectionsContainer.hidden = true;
		this._iframeDocument.body.append(this._sectionsContainer);

		let styleScoper = new StyleScoper(this._iframeDocument);
		await Promise.all(this.book.spine.spineItems.map(section => this._displaySection(section, styleScoper)));

		if (this._options.fontFamily) {
			this._iframeDocument.documentElement.style.setProperty('--content-font-family', this._options.fontFamily);
		}

		this._sectionsContainer.hidden = false;
		await this._initPageMapping(viewState);
		this._initOutline();

		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState

		this._setScale(viewState.scale || 1);

		if (viewState.flowMode) {
			this.setFlowMode(viewState.flowMode);
		}
		else {
			this.setFlowMode('paginated');
		}
		if (viewState.spreadMode) {
			this.setSpreadMode(viewState.spreadMode);
		}
		else {
			this.setSpreadMode(SpreadMode.None);
		}
		if (!viewState.cfi || viewState.cfi === '_start') {
			this.navigateToFirstPage();
		}
		else {
			let cfi = lengthenCFI(viewState.cfi);
			// Perform the navigation on the next frame, because apparently the split view layout might not have
			// settled yet
			await new Promise(resolve => requestAnimationFrame(resolve));
			this.navigate({ pageNumber: cfi }, { behavior: 'auto', offsetY: viewState.cfiElementOffset });
		}
		this._handleViewUpdate();

		// @ts-ignore
		this.book.archive.zip = null;
	}

	private async _displaySection(section: Section, styleScoper: StyleScoper) {
		let sectionView = new SectionView({
			section,
			sectionsContainer: this._sectionsContainer,
			window: this._iframeWindow,
			document: this._iframeDocument,
			styleScoper,
		});
		await sectionView.render(this.book.archive.request.bind(this.book.archive));
		sectionView.body.lang = this.book.packaging.metadata.language;
		this._sectionViews[section.index] = sectionView;
	}

	private async _initPageMapping(viewState: Partial<Readonly<EPUBViewState>>) {
		let localStorageKey = this.book.key() + '-page-mapping';
		let savedPageMapping = viewState.savedPageMapping;
		if (window.dev && !savedPageMapping) {
			savedPageMapping = window.localStorage.getItem(localStorageKey) || undefined;
		}

		// Use persisted page mappings if present
		if (savedPageMapping && this.pageMapping.load(savedPageMapping, this)) {
			this._savedPageMapping = savedPageMapping;
			return;
		}

		// Otherwise, extract physical page numbers and fall back to EPUB locations
		this.pageMapping.generate([...this._sectionViews.values()]);
		this._savedPageMapping = savedPageMapping = this.pageMapping.save(this);
		if (window.dev) {
			window.localStorage.setItem(localStorageKey, savedPageMapping);
		}
	}

	private _initOutline() {
		if (!this.book.navigation.toc.length) {
			return;
		}
		let navPath = new Path(this.book.packaging.navPath || this.book.packaging.ncxPath || '');
		let toOutlineItem: (navItem: NavItem) => OutlineItem = navItem => ({
			title: navItem.label,
			location: {
				href: navPath.resolve(navItem.href).replace(/^\//, '')
			},
			items: navItem.subitems?.map(toOutlineItem),
			expanded: true,
		});
		this._options.onSetOutline(this.book.navigation.toc.map(toOutlineItem));
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
		let section = this.book.section(sectionContainer.getAttribute('data-section-index')!);
		return new EpubCFI(rangeOrNode, section.cfiBase);
	}

	getRange(cfi: EpubCFI | string, mount = false): Range | null {
		if (!this._sectionViews.length) {
			// The book isn't loaded yet -- don't spam the console
			return null;
		}
		let cfiString = cfi.toString();
		if (typeof cfi === 'string') {
			cfi = new EpubCFI(cfi);
		}
		let view = this._sectionViews[cfi.spinePos];
		if (!view) {
			console.error('Unable to find view for CFI', cfiString);
			return null;
		}
		if (!view.mounted && mount) {
			view.mount();
		}
		if (this._rangeCache.has(cfiString)) {
			return this._rangeCache.get(cfiString)!.toRange();
		}
		let range = cfi.toRange(view.container.ownerDocument, undefined, view.container);
		if (!range) {
			console.error('Unable to get range for CFI', cfiString);
			return null;
		}
		this._rangeCache.set(cfiString, new PersistentRange(range));
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
				let range = this.getRange(selector.value);
				if (!range) {
					return null;
				}
				let sectionIndex = EPUBView.getContainingSectionIndex(range);
				if (sectionIndex === null || !this._sectionViews[sectionIndex].mounted) {
					return null;
				}
				return range;
			}
			default:
				// No other selector types supported on EPUBs
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}

	get views(): SectionView[] {
		return this._sectionViews;
	}

	private _pushCurrentLocationToNavStack() {
		let cfi = this.flow.startCFI?.toString();
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
		let text;
		if (type == 'highlight' || type == 'underline') {
			text = '';
			let lastSplitRange;
			for (let splitRange of splitRangeToTextNodes(range)) {
				if (lastSplitRange) {
					let lastSplitRangeContainer = closestElement(lastSplitRange.commonAncestorContainer);
					let lastSplitRangeBlock = lastSplitRangeContainer && getContainingBlock(lastSplitRangeContainer);
					let splitRangeContainer = closestElement(splitRange.commonAncestorContainer);
					let splitRangeBlock = splitRangeContainer && getContainingBlock(splitRangeContainer);
					if (lastSplitRangeBlock !== splitRangeBlock) {
						text += '\n\n';
					}
				}
				text += splitRange.toString().replace(/\s+/g, ' ');
				lastSplitRange = splitRange;
			}
			text = text.trim();

			// If this annotation type wants text, but we didn't get any, abort
			if (!text) {
				return null;
			}
		}
		else {
			text = undefined;
		}

		let selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		let pageLabel = this.pageMapping.isPhysical && this.pageMapping.getPageLabel(range) || '';

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

	// ***
	// Event handlers
	// ***

	protected override _handleResize() {
		if (!this.flow) return;
		let beforeCFI = this.flow.startCFI;
		let beforeOffset = this.flow.startCFIOffsetY;
		if (beforeCFI) {
			this.navigate(
				{ pageNumber: beforeCFI.toString() },
				{
					skipNavStack: true,
					behavior: 'auto',
					offsetY: beforeOffset ?? undefined
				}
			);
		}
		this._handleViewUpdate();
	}

	protected _getInternalLinkHref(link: HTMLAnchorElement) {
		if (this._isExternalLink(link)) {
			return null;
		}
		let href = link.getAttribute('href')!;
		let section = this._sectionViews.find(view => view.container.contains(link))?.section;
		if (!section) {
			return null;
		}
		// This is a hack - we're using the URL constructor to resolve the relative path based on the section's
		// canonical URL, but it'll error without a host. So give it one!
		let url = new URL(href, new URL(section.canonical, 'https://www.example.com/'));
		return this.book.path.relative(url.pathname + url.hash);
	}

	protected override _handlePointerOverInternalLink(link: HTMLAnchorElement) {
		let element = this._getFootnoteTargetElement(link);
		if (element) {
			this._overlayPopupDelayer.open(link, () => {
				this._openFootnoteOverlayPopup(link, element!);
			});
		}
		else {
			this._overlayPopupDelayer.close(() => {
				this._options.onSetOverlayPopup();
			});
		}
	}

	protected _handleInternalLinkClick(link: HTMLAnchorElement) {
		// If link goes to footnote wrapped in an <aside>, open it in a popup instead of navigating
		let element = this._getFootnoteTargetElement(link);
		if (element && element.closest('aside')) {
			this._openFootnoteOverlayPopup(link, element!);
			return;
		}

		let href = this._getInternalLinkHref(link);
		if (!href) {
			return;
		}
		this.navigate({ href });
	}

	protected override _handleKeyDown(event: KeyboardEvent) {
		let { key } = event;

		if (!event.shiftKey) {
			if (key == 'ArrowLeft') {
				if (this._pageProgressionRTL) {
					this.flow.navigateToNextPage();
				}
				else {
					this.flow.navigateToPreviousPage();
				}
				event.preventDefault();
				return;
			}
			if (key == 'ArrowRight') {
				if (this._pageProgressionRTL) {
					this.flow.navigateToPreviousPage();
				}
				else {
					this.flow.navigateToNextPage();
				}
				event.preventDefault();
				return;
			}
		}

		super._handleKeyDown(event);
	}

	protected override _updateViewState() {
		let cfi;
		if (this.flow.startCFI) {
			cfi = shortenCFI(this.flow.startCFI.toString(true));
		}
		else if (this.flow.startRangeIsBeforeFirstMapping) {
			cfi = '_start';
		}
		let viewState: EPUBViewState = {
			scale: Math.round(this.scale * 1000) / 1000, // Three decimal places
			cfi,
			cfiElementOffset: this.flow.startCFIOffsetY ?? undefined,
			savedPageMapping: this._savedPageMapping,
			flowMode: this._flowMode,
			spreadMode: this.spreadMode,
		};
		this._options.onChangeViewState(viewState);
	}

	// View stats provide information about the view
	protected override _updateViewStats() {
		let startRange = this.flow.startRange;
		let pageIndex = startRange && this.pageMapping.getPageIndex(startRange);
		let pageLabel = startRange && this.pageMapping.getPageLabel(startRange);
		let canNavigateToPreviousPage = this.flow.canNavigateToPreviousPage();
		let canNavigateToNextPage = this.flow.canNavigateToNextPage();
		let viewStats: ViewStats = {
			pageIndex: pageIndex ?? undefined,
			pageLabel: pageLabel ?? '',
			pagesCount: this.pageMapping.length,
			usePhysicalPageNumbers: this.pageMapping.isPhysical,
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this.scale === undefined || this.scale < 1.5,
			canZoomOut: this.scale === undefined || this.scale > 0.8,
			canZoomReset: this.scale !== undefined && this.scale !== 1,
			canNavigateBack: this._navStack.canPopBack(),
			canNavigateForward: this._navStack.canPopForward(),
			canNavigateToFirstPage: canNavigateToPreviousPage,
			canNavigateToLastPage: canNavigateToNextPage,
			canNavigateToPreviousPage,
			canNavigateToNextPage,
			canNavigateToPreviousSection: this.canNavigateToPreviousSection(),
			canNavigateToNextSection: this.canNavigateToNextSection(),
			flowMode: this._flowMode,
			spreadMode: this.spreadMode,
		};
		this._options.onChangeViewStats(viewStats);
	}

	protected override _handleViewUpdate() {
		super._handleViewUpdate();
		this.flow.invalidate();
		if (this._find) {
			this._find.handleViewUpdate();
		}
	}

	protected _openFootnoteOverlayPopup(link: HTMLAnchorElement, element: Element) {
		let doc = document.implementation.createHTMLDocument();
		let cspMeta = this._iframeDocument.createElement('meta');
		cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
		cspMeta.setAttribute('content', this._getCSP());
		doc.head.prepend(cspMeta);

		let container = document.createElement('div');

		let current = element;
		let currentClone = current.cloneNode(true) as HTMLElement;
		while (!current.classList.contains('section-container')) {
			let parent = current.parentElement;
			if (!parent) {
				break;
			}
			let parentClone = parent.cloneNode(false) as HTMLElement;
			parentClone.appendChild(currentClone);
			currentClone = parentClone;
			current = parent;
		}
		container.appendChild(currentClone);

		container.querySelectorAll('a').forEach((link) => {
			link.removeAttribute('href');
		});

		doc.body.append(container);
		let content = new XMLSerializer().serializeToString(doc);

		let range = link.ownerDocument.createRange();
		range.selectNode(link);
		let domRect = range.getBoundingClientRect();
		let rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		let css = '';
		for (let sheet of [...this._iframeDocument.styleSheets, ...this._iframeDocument.adoptedStyleSheets]) {
			for (let rule of sheet.cssRules) {
				css += rule.cssText + '\n\n';
			}
		}
		css += `
			:root {
				--content-scale: ${this.scale};
				--content-font-family: ${this._iframeDocument.documentElement.style.getPropertyValue('--content-font-family')};
			}
		`;
		let overlayPopup = {
			type: 'footnote',
			content,
			css,
			rect,
			ref: link
		} satisfies OverlayPopupParams;
		this._options.onSetOverlayPopup(overlayPopup);
	}

	protected _isFootnoteLink(link: HTMLAnchorElement, target: Element): boolean {
		// Modeled on Calibre's heuristic
		// https://github.com/kovidgoyal/calibre/blob/87f4c08c16b07058dd25733eb5c30022246a66f2/src/pyj/read_book/footnotes.pyj#L32

		if (link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'noteref') {
			return true;
		}
		let roles = link.role?.split(' ') ?? [];
		if (roles.includes('doc-noteref') || roles.includes('doc-biblioref') || roles.includes('doc-glossref')) {
			return true;
		}
		if (roles.includes('doc-link')) {
			return false;
		}

		// Check if element has super/subscript alignment
		let elem: HTMLElement | null = link;
		let remainingDepth = 3;
		while (elem && remainingDepth > 0) {
			let style = getComputedStyle(elem);
			if (!['inline', 'inline-block'].includes(style.display)) {
				break;
			}
			if (['sub', 'super', 'top', 'bottom'].includes(style.verticalAlign)) {
				return true;
			}

			elem = elem.parentElement;
			remainingDepth--;
		}

		// Check if it has a single child with super/subscript alignment
		if (link.innerText.trim() && link.children.length === 1) {
			let style = getComputedStyle(link.children[0]);
			if (['inline', 'inline-block'].includes(style.display)
					&& ['sub', 'super', 'top', 'bottom'].includes(style.verticalAlign)) {
				return true;
			}
		}

		// Check if it has a link back to the original link
		let sectionIndex = link.closest('[data-section-index]')?.getAttribute('data-section-index');
		let section = sectionIndex && this.book.spine.get(sectionIndex);
		if (!section) {
			return false;
		}
		for (let linkInTarget of target.querySelectorAll('a')) {
			let linkInTargetHref = this._getInternalLinkHref(linkInTarget);
			if (!linkInTargetHref) {
				continue;
			}
			let [pathname, hash] = linkInTargetHref.split('#');
			if (pathname === section.href && hash === link.id) {
				return true;
			}
		}

		return false;
	}

	protected _getFootnoteTargetElement(link: HTMLAnchorElement) {
		let href = this._getInternalLinkHref(link);
		if (!href) {
			return null;
		}
		let [pathname, hash] = href.split('#');
		if (!pathname || !hash) {
			return null;
		}
		let section = this.book.spine.get(pathname);
		if (!section) {
			return null;
		}
		let target = this._sectionViews[section.index].container
			.querySelector('[id="' + CSS.escape(hash) + '"]');
		if (!target) {
			return null;
		}

		let epubType = target.getAttributeNS('http://www.idpf.org/2007/ops', 'type');
		if (!epubType || !['footnote', 'rearnote', 'note'].includes(epubType)) {
			target = getContainingBlock(target) || target;
		}

		if (!this._isFootnoteLink(link, target)) {
			return null;
		}
		return target;
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
					startRange: this.flow.startRange!,
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
		if (flowMode == this._flowMode) {
			return;
		}

		let cfiBefore = this.flow?.startCFI;
		if (this.flow) {
			this.flow.destroy();
		}
		this._flowMode = flowMode;
		this.flow = new (flowMode == 'paginated' ? PaginatedFlow : ScrolledFlow)({
			view: this,
			iframe: this._iframe,
			onUpdateViewState: () => this._updateViewState(),
			onUpdateViewStats: () => this._updateViewStats(),
			onViewUpdate: () => this._handleViewUpdate(),
		});
		this.flow.setSpreadMode(this.spreadMode);

		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, { skipNavStack: true, behavior: 'auto' });
		}
	}

	setSpreadMode(spreadMode: SpreadMode) {
		if (spreadMode !== SpreadMode.None && spreadMode !== SpreadMode.Odd) {
			throw new Error('Unsupported spread mode');
		}

		if (spreadMode == this.spreadMode) {
			return;
		}

		let cfiBefore = this.flow?.startCFI;
		this.spreadMode = spreadMode;
		this.flow?.setSpreadMode(spreadMode);
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
				this.flow.scrollIntoView(result.range);
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
				this.flow.scrollIntoView(result.range);
			}
			this._renderAnnotations();
		}
	}

	zoomIn() {
		let scale = this.scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._setScale(scale);
		this._handleViewUpdate();
	}

	zoomOut() {
		let scale = this.scale;
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
		let cfiBefore = this.flow?.startCFI;
		this.scale = scale;
		this._iframeDocument.documentElement.style.setProperty('--content-scale', String(scale));
		this.flow?.setScale(scale);
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
				range = this.getRange(location.pageNumber, true);
			}
			else {
				if (this.flow.startRange && this.pageMapping.getPageLabel(this.flow.startRange) === location.pageNumber) {
					console.log('Already on page', location.pageNumber);
					return;
				}
				range = this.pageMapping.getRange(location.pageNumber);
			}

			if (!range) {
				console.error('Unable to find range');
				return;
			}
			this.flow.scrollIntoView(range, options);
		}
		else if (location.href) {
			options.block ||= 'start';

			let [pathname, hash] = location.href.split('#');
			let section = this.book.spine.get(pathname);
			if (!section) {
				console.error('Unable to find section for pathname', pathname);
				return;
			}
			let target = hash && this._sectionViews[section.index].container
				.querySelector('[id="' + CSS.escape(hash) + '"]');
			if (target) {
				this.flow.scrollIntoView(target as HTMLElement, options);
			}
			else {
				let view = this._sectionViews[section.index];
				if (!view) {
					console.error('Unable to find view for section', section.index);
					return;
				}
				this.flow.scrollIntoView(view.container, options);
			}
		}
		else {
			super.navigate(location, options);
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
		this.flow.navigateToFirstPage();
	}

	navigateToLastPage() {
		this.flow.navigateToLastPage();
	}

	canNavigateToPreviousPage() {
		return this.flow.canNavigateToPreviousPage();
	}

	canNavigateToNextPage() {
		return this.flow.canNavigateToNextPage();
	}

	navigateToPreviousPage() {
		this.flow.navigateToPreviousPage();
	}

	navigateToNextPage() {
		this.flow.navigateToNextPage();
	}

	canNavigateToPreviousSection() {
		return !!this.flow.startView?.section.prev();
	}

	canNavigateToNextSection() {
		return !!this.flow.startView?.section.next();
	}

	navigateToPreviousSection() {
		let section = this.flow.startView?.section.prev();
		if (section) {
			this.navigate({ href: section.href });
		}
	}

	navigateToNextSection() {
		let section = this.flow.startView?.section.next();
		if (section) {
			this.navigate({ href: section.href });
		}
	}

	// Still need to figure out how this is going to work
	print() {
		console.log('Print');
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		window.dispatchEvent(new Event('resize'));
	}

	static getContainingSectionIndex(rangeOrNode: Range | PersistentRange | Node): number | null {
		let elem;
		if ('nodeType' in rangeOrNode) {
			elem = closestElement(rangeOrNode);
		}
		else {
			elem = closestElement(rangeOrNode.startContainer.childNodes[rangeOrNode.startOffset] || rangeOrNode.startContainer);
		}
		elem = elem?.closest('[data-section-index]');
		if (!elem) {
			return null;
		}
		return parseInt(elem.getAttribute('data-section-index')!);
	}

	static compareBoundaryPoints(how: number, a: Range, b: Range): number {
		if (a.startContainer.getRootNode() !== b.startContainer.getRootNode()) {
			let aSectionIndex = this.getContainingSectionIndex(a);
			if (aSectionIndex === null) {
				throw new Error('a is not inside a section');
			}
			let bSectionIndex = this.getContainingSectionIndex(b);
			if (bSectionIndex === null) {
				throw new Error('b is not inside a section');
			}
			if (aSectionIndex === bSectionIndex) {
				return -1;
			}
			return aSectionIndex - bSectionIndex;
		}
		return a.compareBoundaryPoints(how, b);
	}
}

type FlowMode = 'paginated' | 'scrolled';

export const enum SpreadMode {
	Unknown = -1,
	None = 0,
	Odd = 1,
	Even = 2
}

export interface EPUBViewState extends DOMViewState {
	cfi?: string;
	cfiElementOffset?: number;
	savedPageMapping?: string;
	flowMode?: FlowMode;
	spreadMode?: SpreadMode;
}

export interface EPUBViewData {
	book?: Book;
}

export default EPUBView;
