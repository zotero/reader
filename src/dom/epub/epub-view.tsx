import {
	AnnotationPopupParams,
	AnnotationType,
	FindPopupParams,
	NavLocation,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	SelectionPopupParams,
	Tool,
	ViewStats,
	WADMAnnotation
} from "../../common/types";
import Epub, {
	Book,
	EpubCFI,
	NavItem,
} from "epubjs";
import { getSelectionRanges } from "../common/lib/selection";
import {
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes,
	getCommonAncestorElement
} from "../common/lib/range";
import {
	FragmentSelector,
	FragmentSelectorConformsTo,
	isFragment,
	Selector
} from "../common/lib/selector";
import { EPUBFindProcessor } from "./find";
import {
	IGNORE_CLASS,
	PAGE_TURN_WHEEL_THRESHOLD,
	PAGE_TURN_WHEEL_TIMEOUT
} from "./defines";
import './stylesheets/main.scss';
import NavStack from "../common/lib/nav-stack";
import DOMView, { DOMViewOptions } from "../common/dom-view";
import SectionView from "./section-view";
// @ts-ignore
import contentCSS from '!!raw-loader!./stylesheets/content.css';
import Section from "epubjs/types/section";
import { closestElement } from "../common/lib/nodes";
import { isSafari } from "../../common/lib/utilities";
import Path from "epubjs/src/utils/path";
import StyleScoper from "./lib/style-scoper";
import PageMapping from "./lib/page-mapping";
import { debounce } from "../../common/lib/debounce";

// - All views use iframe to render and isolate the view from the parent window
// - If need to add additional build steps, a submodule or additional files see pdfjs/
//   directory in the project root and "scripts" part in packages.json
// - If view needs styling, it should provide and load its own CSS file like pdfjs/viewer.css,
//   because SCSS in src/common/stylesheets is only for the main window
// - Update demo data in demo/epub and demo/snapshot directories:
//   - Add demo annotations

class EPUBView extends DOMView<EPUBViewState> {
	private _annotationsBySection!: Map<number, WADMAnnotation[]>;
	
	protected _findProcessor: EPUBFindProcessor | null = null;

	private readonly _book: Book;
	
	private readonly _iframe: HTMLIFrameElement;

	private readonly _iframeWindow: Window & typeof globalThis;

	private _iframeDocument!: Document;
	
	private _sectionsContainer!: HTMLElement;

	private readonly _sectionViews: SectionView[] = [];
	
	private _cachedStartRange: Range | null = null;
	
	private _cachedStartCFI: EpubCFI | null = null;

	private _gotMouseUp = false;

	private _lastFocusTarget: HTMLElement | null = null;
	
	private readonly _navStack = new NavStack<string>();
	
	private _wheelAmount = 0;
	
	private _wheelResetTimeout: number | null = null;
	
	private readonly _pageMapping = new PageMapping();
	
	private _lastLocation = 0;

	constructor(options: DOMViewOptions<EPUBViewState>) {
		super(options);
		
		this._book = Epub(options.buf);
		
		this._iframe = document.createElement('iframe');
		this._iframe.sandbox.add('allow-same-origin');
		if (isSafari) {
			this._iframe.sandbox.add('allow-scripts');
		}
		this._iframe.addEventListener('load', () => this._handleIFrameLoad(), { once: true });
		this._iframe.srcdoc = '<!DOCTYPE html><html><body></body></html>';
		options.container.append(this._iframe);
		this._iframeWindow = this._iframe.contentWindow as Window & typeof globalThis;
	}
	
	private _handleIFrameLoad() {
		this._iframeDocument = this._iframe.contentDocument!;
		const style = this._iframeDocument.createElement('style');
		style.innerHTML = contentCSS;
		this._iframeDocument.head.append(style);

		this._sectionsContainer = this._iframeDocument.createElement('div');
		this._sectionsContainer.classList.add('sections');
		this._iframeDocument.body.append(this._sectionsContainer);

		this._book.opened.then(async () => {
			this._setInitialViewState(this._options.viewState || { flowMode: 'scrolled' });
			
			const styleScoper = new StyleScoper(this._iframeDocument);
			await Promise.all(this._book.spine.spineItems.map(section => this._displaySection(section, styleScoper)));
			styleScoper.rewriteAll();
			// Now that all are loaded, un-hide them all at once
			for (const view of this._sectionViews.values()) {
				view.container.hidden = false;
			}
			await this._initPageMapping();
			this._onInitialDisplay();
		});
	}
	
	private async _displaySection(section: Section, styleScoper: StyleScoper) {
		const container = this._iframeDocument.createElement('div');
		container.id = 'section-' + section.index;
		container.classList.add('section-container', 'cfi-stop');
		container.hidden = true; // Until all are loaded
		container.setAttribute('data-section-index', String(section.index));
		this._sectionsContainer.append(container);
		const sectionView = new SectionView({
			section,
			container,
			window: this._iframeWindow,
			document: this._iframeDocument,
			styleScoper,
			onInternalLinkClick: (href) => {
				this.navigate({ href: this._book.path.relative(href) });
			},
		});
		const html = await section.render(this._book.archive.request.bind(this._book.archive));
		await sectionView.initWithHTML(html);
		this._sectionViews[section.index] = sectionView;
	}

	private async _initPageMapping() {
		// Use physical page numbers if we can get any
		if (this._pageMapping.addPhysicalPages(this._sectionViews.values())) {
			this._updateViewStats();
			return;
		}
		
		// Otherwise, load/generate EPUB.js locations
		const localStorageKey = this._book.key() + '-locations';
		if (window.dev && !this._viewState.persistedLocations) {
			this._viewState.persistedLocations = window.localStorage.getItem(localStorageKey) || undefined;
		}
		
		let locations;
		if (this._viewState.persistedLocations) {
			locations = this._book.locations.load(this._viewState.persistedLocations);
		}
		else {
			locations = await this._book.locations.generate(1800);
			this._viewState.persistedLocations = this._book.locations.save();
			this._updateViewState();
			if (window.dev) {
				window.localStorage.setItem(localStorageKey, this._book.locations.save());
			}
		}
		this._pageMapping.addEPUBLocations(this, locations);
		this._updateViewStats();
	}

	private _onInitialDisplay() {
		// Long-term goal is to make this reader touch friendly, which probably means using
		// not mouse* but pointer* or touch* events
		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('click', this._handleClick.bind(this));
		this._iframeWindow.addEventListener('mouseover', this._handleMouseEnter.bind(this));
		this._iframeWindow.addEventListener('mousedown', this._handlePointerDown.bind(this), true);
		this._iframeWindow.addEventListener('mouseup', this._handlePointerUp.bind(this));
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		// @ts-ignore
		this._iframeWindow.addEventListener('copy', this._handleCopy.bind(this));
		this._iframeWindow.addEventListener('resize', this._handleResize.bind(this));
		this._iframeWindow.addEventListener('focus', this._handleFocus.bind(this));
		this._iframeDocument.addEventListener('scroll', this._handleScroll.bind(this), { passive: true });
		this._iframeDocument.addEventListener('wheel', this._handleWheel.bind(this), { passive: false });
		this._iframeDocument.addEventListener('selectionchange', this._handleSelectionChange.bind(this));
		
		this._initOutline();
		setTimeout(() => this._handleResize());
	}

	private _initOutline() {
		if (!this._book.navigation.toc.length) {
			return;
		}
		const navPath = new Path(this._book.packaging.navPath);
		const toOutlineItem: (navItem: NavItem) => OutlineItem = navItem => ({
			title: navItem.label,
			location: {
				href: navPath.resolve(navItem.href).replace(/^\//, '')
			},
			items: navItem.subitems?.map(toOutlineItem),
			expanded: true,
		});
		this._options.onSetOutline(this._book.navigation.toc.map(toOutlineItem));
	}

	private _setInitialViewState(viewState?: EPUBViewState) {
		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		if (viewState) {
			if (viewState.scale) {
				this._iframeDocument.documentElement.style.setProperty('--content-font-size', viewState.scale + 'em');
			}
			else {
				viewState.scale = 1;
			}
			if (viewState.cfi) {
				this.navigate({ pageNumber: viewState.cfi });
			}
			if (viewState.flowMode) {
				this.setFlowMode(viewState.flowMode);
			}
		}
	}

	protected override _getSectionAnnotations(section: number): WADMAnnotation[] {
		return this._annotationsBySection.get(section) ?? [];
	}

	protected override _getSectionRoot(_section: number) {
		return this._iframeDocument.body;
	}

	protected override _getSelectorSection(selector: Selector): number {
		if (!isFragment(selector) || selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
			throw new Error('Unsupported selector');
		}
		return new EpubCFI(selector.value).spinePos;
	}

	private _renderAllAnnotations() {
		if (!this._sectionViews) return;
		for (const view of this._sectionViews.values()) {
			this._renderAnnotations(view.section.index);
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
		const sectionContainer = closestElement(commonAncestorNode)?.closest('[data-section-index]');
		if (!sectionContainer) {
			return null;
		}
		const section = this._book.section(sectionContainer.getAttribute('data-section-index')!);
		return new EpubCFI(rangeOrNode, section.cfiBase, IGNORE_CLASS);
	}

	getRange(cfi: EpubCFI | string): Range | null {
		if (typeof cfi === 'string') {
			cfi = new EpubCFI(cfi, undefined, IGNORE_CLASS);
		}
		const view = this._sectionViews[cfi.spinePos];
		if (!view) {
			console.error('Unable to find view for CFI', cfi.toString());
			return null;
		}
		return cfi.toRange(this._iframeDocument, IGNORE_CLASS, view.container);
	}

	override toSelector(range: Range): FragmentSelector | null {
		const cfi = this.getCFI(range);
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

	toSection(selector: Selector) {
		switch (selector.type) {
			case 'FragmentSelector':
				if (selector.conformsTo != 'http://www.idpf.org/epub/linking/cfi/epub-cfi.html') {
					throw new Error(`Unsupported FragmentSelector.conformsTo: ${selector.conformsTo}`);
				}
				return new EpubCFI(selector.value, undefined, IGNORE_CLASS).spinePos;
			default:
				// No other selector types supported on EPUBs
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}
	
	get startRange(): Range | null {
		if (!this._cachedStartRange) {
			this._updateStartRangeAndCFI();
		}
		return this._cachedStartRange;
	}
	
	get startCFI(): EpubCFI | null {
		if (!this._cachedStartCFI) {
			this._updateStartRangeAndCFI();
		}
		return this._cachedStartCFI;
	}
	
	private _invalidateStartRangeAndCFI = debounce(
		() => {
			this._cachedStartRange = null;
			this._cachedStartCFI = null;
			this._updateStartRangeAndCFI();
			this._updateViewStats();
		},
		100
	);
	
	private _updateStartRangeAndCFI() {
		for (const view of this._sectionViews.values()) {
			const rect = view.container.getBoundingClientRect();
			const visible = this._viewState.flowMode == 'paginated'
				? !(rect.left > this._iframe.clientWidth || rect.right < 0)
				: !(rect.top > this._iframe.clientHeight || rect.bottom < 0);
			if (visible) {
				const startRange = view.getFirstVisibleRange(
					this._viewState.flowMode == 'paginated',
					false
				);
				if (startRange) {
					this._cachedStartRange = startRange;
				}
				const startCFIRange = view.getFirstVisibleRange(
					this._viewState.flowMode == 'paginated',
					true
				);
				if (startCFIRange) {
					this._cachedStartCFI = new EpubCFI(startCFIRange, view.section.cfiBase, IGNORE_CLASS);
				}
				
				if (startRange && startCFIRange) {
					break;
				}
			}
		}
	}
	
	_pushCurrentLocationToNavStack() {
		const cfi = this.startCFI?.toString();
		if (cfi) {
			this._navStack.push(cfi);
			this._updateViewStats();
		}
	}
	
	override _navigateToSelector(selector: Selector) {
		if (!isFragment(selector) || selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
			console.warn("Not a CFI FragmentSelector", selector);
			return;
		}
		this.navigate({ pageNumber: selector.value });
	}

	protected override _getViewportBoundingRect(range: Range): DOMRect {
		const rect = range.getBoundingClientRect();
		const iframe = range.commonAncestorContainer.ownerDocument?.defaultView?.frameElement;
		if (!iframe) {
			throw new Error('Range is not inside iframe');
		}
		return new DOMRect(
			rect.x + iframe.getBoundingClientRect().x - this._container.getBoundingClientRect().x,
			rect.y + iframe.getBoundingClientRect().y - this._container.getBoundingClientRect().y,
			rect.width,
			rect.height
		);
	}

	private _getIFrame(node: Node): HTMLIFrameElement | null {
		const doc = node.nodeType == Node.DOCUMENT_NODE ? node as Document : node.ownerDocument;
		const iframe = doc?.defaultView?.frameElement;
		if (!(iframe instanceof HTMLIFrameElement)) {
			return null;
		}
		return iframe;
	}

	protected override _getSelection(): Selection | null {
		return this._iframeWindow.getSelection();
	}

	// Currently type is only 'highlight' but later there will also be 'underline'
	protected override _getAnnotationFromTextSelection(type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		const selection = this._iframeWindow.getSelection();
		if (!selection || selection.isCollapsed) {
			return null;
		}
		const text = selection.toString();
		const range = moveRangeEndsIntoTextNodes(makeRangeSpanning(...getSelectionRanges(selection)));
		const selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		const pageLabel = this._pageMapping.getPageLabel(range);
		if (!pageLabel) {
			return null;
		}
		
		// Use the number of characters between the start of the page and the start of the selection range
		// to disambiguate the sortIndex
		const section = this._getSelectorSection(selector);
		const offsetRange = this._iframeDocument.createRange();
		offsetRange.setStart(this._sectionViews[section].container, 0);
		offsetRange.setEnd(range.startContainer, range.startOffset);
		const sortIndex = String(section).padStart(5, '0') + '|' + String(offsetRange.toString().length).padStart(8, '0');
		return {
			type,
			color,
			sortIndex,
			pageLabel,
			position: selector,
			text
		};
	}

	private _tryUseTool(): boolean {
		this._updateViewStats();
		if (this._gotMouseUp) {
			// Open text selection popup if current tool is pointer
			if (this._tool.type == 'pointer') {
				const selection = this._iframeWindow.getSelection();
				if (selection) {
					this._openSelectionPopup(selection);
					return true;
				}
			}
			if (this._tool.type === 'highlight') {
				const annotation = this._getAnnotationFromTextSelection('highlight', this._tool.color);
				if (annotation) {
					this._options.onAddAnnotation(annotation);
				}
				this._iframeWindow.getSelection()?.removeAllRanges();
				return true;
			}
		}
		return false;
	}

	// ***
	// Event handlers
	// ***

	private _handleClick(event: Event) {
		const link = (event.target as Element).closest('a');
		if (link && link.target === '_blank') { // target is _blank on external links
			event.preventDefault();
			this._options.onOpenLink(link.href);
		}
	}

	private _handleMouseEnter(event: MouseEvent) {
		const link = (event.target as Element).closest('a');
		if (link && link.target === '_blank') { // target is _blank on external links
			this._overlayPopupDelayer.open(link, () => {
				this._openExternalLinkOverlayPopup(link);
			});
		}
		else {
			this._overlayPopupDelayer.close(() => {
				this._options.onSetOverlayPopup();
			});
		}
	}

	private _handleContextMenu(event: MouseEvent) {
		// Prevent native context menu
		event.preventDefault();
		const iframe = this._getIFrame(event.target as Element);
		if (!iframe) {
			return;
		}
		const br = iframe.getBoundingClientRect();
		this._options.onOpenViewContextMenu({ x: br.x + event.clientX, y: br.y + event.clientY });
	}

	private _handlePointerDown(event: MouseEvent) {
		this._gotMouseUp = false;

		this._options.onSetOverlayPopup();

		if (event.button === 2) {
			return;
		}

		if (!(event.target as Element).closest('.annotation-container')) {
			// Deselect annotations when clicking outside the annotation layer
			if (this._selectedAnnotationIDs.length) {
				this._options.onSelectAnnotations([]);
			}
			
			// Disable pointer events on the annotation layer until mouseup
			this._disableAnnotationPointerEvents = true;
			this._renderAllAnnotations();
		}
		
		// Create note annotation on pointer down event, if note tool is active.
		// The note tool will be automatically deactivated in reader.js,
		// because this is what we do in PDF reader
		if (this._tool.type === 'note') {
			throw new Error('Unimplemented');

			/*this._onAddAnnotation({
				type: 'note',
				color: this._tool.color,
				sortIndex: '00000|000000|00000',
				pageLabel: '1',
				position: { /!* Figure out how to encode note position *!/ },
			}, true);*/
		}
	}

	private _handlePointerUp(_event: MouseEvent) {
		this._gotMouseUp = true;
		this._tryUseTool();

		this._disableAnnotationPointerEvents = false;
		this._renderAllAnnotations();
	}

	private _handleKeyDown(event: KeyboardEvent) {
		const { key } = event;
		const shift = event.shiftKey;

		// Focusable elements in PDF view are annotations and overlays (links, citations, figures).
		// Once TAB is pressed, arrows can be used to navigate between them
		const focusableElements: HTMLElement[] = [];
		let focusedElementIndex = -1;
		const focusedElement: HTMLElement | null = this._iframeDocument.activeElement as HTMLElement | null;
		for (const element of this._iframeDocument.querySelectorAll('[tabindex="-1"]')) {
			focusableElements.push(element as HTMLElement);
			if (element === focusedElement) {
				focusedElementIndex = focusableElements.length - 1;
			}
		}

		if (key === 'Escape') {
			if (this._selectedAnnotationIDs.length) {
				this._options.onSelectAnnotations([]);
			}
			else if (focusedElement) {
				focusedElement.blur();
			}
			// The keyboard shortcut was handled here, therefore no need to
			// pass it to this._onKeyDown(event) below
			return;
		}
		else if (shift && key === 'Tab') {
			if (focusedElement) {
				focusedElement.blur();
			}
			else {
				this._options.onTabOut(true);
			}
			event.preventDefault();
			return;
		}
		else if (key === 'Tab') {
			if (!focusedElement) {
				// In PDF view the first visible object (annotation, overlay) is focused
				if (focusableElements.length) {
					focusableElements[0].focus();
				}
				else {
					this._options.onTabOut();
				}
			}
			else {
				this._options.onTabOut();
			}
			event.preventDefault();
			return;
		}

		if (focusedElement) {
			if (!window.rtl && key === 'ArrowRight' || window.rtl && key === 'ArrowLeft' || key === 'ArrowDown') {
				focusableElements[focusedElementIndex + 1]?.focus();
				event.preventDefault();
				return;
			}
			else if (!window.rtl && key === 'ArrowLeft' || window.rtl && key === 'ArrowRight' || key === 'ArrowUp') {
				focusableElements[focusedElementIndex - 1]?.focus();
				event.preventDefault();
				return;
			}
			else if (['Enter', 'Space'].includes(key)) {
				if (focusedElement.classList.contains('highlight')) {
					const annotationID = focusedElement.getAttribute('data-annotation-id')!;
					const annotation = this._annotationsByID.get(annotationID);
					if (annotation) {
						this._options.onSelectAnnotations([annotationID]);
						this._openAnnotationPopup(annotation);
						return;
					}
				}
			}
		}

		// Pass keydown even to the main window where common keyboard
		// shortcuts are handled i.e. Delete, Cmd-Minus, Cmd-f, etc.
		this._options.onKeyDown(event);
	}

	private _handleDragStart(event: DragEvent) {
		if (!event.dataTransfer) {
			return;
		}
		const annotation = this._getAnnotationFromTextSelection('highlight');
		if (!annotation) {
			return;
		}
		console.log('Dragging text', annotation);
		this._options.onSetDataTransferAnnotations(event.dataTransfer, annotation, true);
	}

	private _handleScroll(_event: Event) {
		this._invalidateStartRangeAndCFI();
		this._updateViewState();
	}

	private _handleWheel(event: WheelEvent) {
		if (this._viewState.flowMode && this._viewState.flowMode !== 'paginated') {
			return;
		}

		event.preventDefault();
		if (this._wheelResetTimeout) {
			window.clearTimeout(this._wheelResetTimeout);
		}
		const delta = event.deltaX || event.deltaY;
		this._wheelAmount += delta;
		if (Math.abs(this._wheelAmount) >= PAGE_TURN_WHEEL_THRESHOLD) {
			if (delta > 0) {
				this.navigateToNextPage();
			}
			else if (delta < 0) {
				this.navigateToPreviousPage();
			}
			this._wheelAmount = 0;
		}
		else {
			this._wheelResetTimeout = window.setTimeout(() => this._wheelAmount = 0, PAGE_TURN_WHEEL_TIMEOUT);
		}
	}

	private _handleResize() {
		this._handleViewUpdate();
	}

	private _handleFocus(event: FocusEvent) {
		this._options.onFocus();
		this._lastFocusTarget = event.target as HTMLElement;
	}

	private _handleSelectionChange(event: Event) {
		const doc = (event.target as Element).ownerDocument || event.target as Document;
		if (!doc.hasFocus()) {
			this._getIFrame(doc)?.focus();
		}
		const selection = doc.getSelection();
		if (!selection || selection.isCollapsed) {
			this._options.onSetSelectionPopup(null);
		}
		else {
			this._updateViewStats();
			this._tryUseTool();
		}
	}
	
	protected override _updateViewState() {
		if (!this.startCFI) {
			return;
		}
		const viewState: EPUBViewState = {
			...this._viewState,
			cfi: this.startCFI.toString(),
		};
		this._viewState = viewState;
		this._options.onChangeViewState(viewState);
	}
	
	// View stats provide information about the view
	protected override _updateViewStats() {
		const startRange = this.startRange;
		const pageIndex = startRange && this._pageMapping.getPageIndex(startRange);
		const pageLabel = startRange && this._pageMapping.getPageLabel(startRange);
		const canNavigateToPreviousPage = this.canNavigateToPreviousPage();
		const canNavigateToNextPage = this.canNavigateToNextPage();
		const viewStats: ViewStats = {
			pageIndex: pageIndex ?? undefined,
			pageLabel: pageLabel ?? undefined,
			pagesCount: this._pageMapping.length,
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this._viewState.scale === undefined || this._viewState.scale < 1.5,
			canZoomOut: this._viewState.scale === undefined || this._viewState.scale > 0.8,
			canZoomReset: this._viewState.scale !== undefined && this._viewState.scale !== 1,
			canNavigateBack: this._navStack.canPopBack(),
			canNavigateForward: this._navStack.canPopForward(),
			canNavigateToFirstPage: canNavigateToPreviousPage,
			canNavigateToLastPage: canNavigateToNextPage,
			canNavigateToPreviousPage,
			canNavigateToNextPage,
			flowMode: this._viewState.flowMode,
		};
		this._options.onChangeViewStats(viewStats);
	}

	protected override _handleViewUpdate() {
		super._handleViewUpdate();
		this._invalidateStartRangeAndCFI();
		this._renderAllAnnotations();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setSelectedAnnotationIDs(ids: string[]) {
		this._selectedAnnotationIDs = ids;
		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._options.onSetAnnotationPopup();
		this._renderAllAnnotations();

		this._iframeWindow.getSelection()?.empty();

		this._updateViewStats();
	}

	setTool(tool: Tool) {
		this._tool = tool;
	}

	override setAnnotations(annotations: WADMAnnotation[]) {
		super.setAnnotations(annotations);
		this._annotationsBySection = new Map();
		for (const annotation of annotations) {
			const section = this.toSection(annotation.position);
			let array = this._annotationsBySection.get(section);
			if (!array) {
				array = [];
				this._annotationsBySection.set(section, array);
			}
			array.push(annotation);
		}
		this._renderAllAnnotations();
	}

	setShowAnnotations(show: boolean) {
		this._showAnnotations = show;
	}

	setAnnotationPopup(popup: AnnotationPopupParams<WADMAnnotation>) {
		this._annotationPopup = popup;
	}

	setSelectionPopup(popup: SelectionPopupParams<WADMAnnotation>) {
		this._selectionPopup = popup;
	}

	setOverlayPopup(popup: OverlayPopupParams) {
		this._overlayPopup = popup;
		this._overlayPopupDelayer.setOpen(!!popup);
	}

	// Unlike annotation, selection and overlay popups, find popup open state is determined
	// with .open property. All popup properties are preserved even when it's closed
	setFindPopup(popup: FindPopupParams) {
		const previousPopup = this._findPopup;
		this._findPopup = popup;
		if (!popup.open && previousPopup && previousPopup.open !== popup.open) {
			console.log('Closing find popup');
			if (this._findProcessor) {
				this._findProcessor = null;
			}
		}
		else if (popup.open) {
			if (!previousPopup
					|| previousPopup.query !== popup.query
					|| previousPopup.highlightAll !== popup.highlightAll
					|| previousPopup.caseSensitive !== popup.caseSensitive
					|| previousPopup.entireWord !== popup.entireWord) {
				console.log('Initiating new search', popup);
				this._findProcessor = new EPUBFindProcessor({
					view: this,
					book: this._book,
					startCFI: this.startCFI,
					section: this._book.spine.get(this.startCFI?.spinePos),
					query: popup.query,
					highlightAll: popup.highlightAll,
					caseSensitive: popup.caseSensitive,
					entireWord: popup.entireWord,
				});
				this.findNext();
			}
		}
	}
	
	setFlowMode(flowMode: FlowMode) {
		if (flowMode == 'paginated' && isSafari) {
			// Safari's column layout is unusably slow
			console.error('paginated mode is not supported in Safari');
			flowMode = 'scrolled';
		}
		
		switch (flowMode) {
			case 'paginated':
				for (const elem of [this._iframe, this._iframeDocument.body]) {
					elem.classList.add('paginated');
					elem.classList.remove('scrolled');
				}
				break;
			case 'scrolled':
				for (const elem of [this._iframe, this._iframeDocument.body]) {
					elem.classList.add('scrolled');
					elem.classList.remove('paginated');
				}
				break;
		}
		this._viewState.flowMode = flowMode;
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	focus() {
		this._lastFocusTarget?.focus();
	}

	async findNext() {
		console.log('Find next');
		if (this._findProcessor) {
			let processor = this._findProcessor;
			const startSection = processor.section;
			let result = processor.next();
			while (result.done) {
				processor = this._findProcessor = await result.nextProcessor;
				result = processor.next();
				if (processor.section == startSection) {
					break;
				}
			}
			if (!result.done) {
				this.navigate({ pageNumber: result.cfi });
				this._renderAllAnnotations();
			}
		}
	}

	async findPrevious() {
		console.log('Find previous');
		if (this._findProcessor) {
			let processor = this._findProcessor;
			const startSection = processor.section;
			let result = processor.prev();
			while (result.done) {
				processor = this._findProcessor = await result.nextProcessor;
				result = processor.prev();
				if (processor.section == startSection) {
					break;
				}
			}
			if (!result.done) {
				this.navigate({ pageNumber: result.cfi });
				this._renderAllAnnotations();
			}
		}
	}

	zoomIn() {
		const cfiBefore = this.startCFI;
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._viewState.scale = scale;
		this._iframeDocument.documentElement.style.setProperty('--content-font-size', scale + 'em');
		this._handleViewUpdate();
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, true);
		}
	}

	zoomOut() {
		const cfiBefore = this.startCFI;
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale -= 0.1;
		this._viewState.scale = scale;
		this._iframeDocument.documentElement.style.setProperty('--content-font-size', scale + 'em');
		this._handleViewUpdate();
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, true);
		}
	}

	zoomReset() {
		const cfiBefore = this.startCFI;
		this._viewState.scale = 1;
		this._iframeDocument.documentElement.style.setProperty('--content-font-size', '1em');
		this._handleViewUpdate();
		if (cfiBefore) {
			this.navigate({ pageNumber: cfiBefore.toString() }, true);
		}
	}

	override navigate(location: NavLocation, skipPushToNavStack = false) {
		console.log('Navigating to', location);
		if (!skipPushToNavStack) {
			this._pushCurrentLocationToNavStack();
		}
		if (location.pageNumber) {
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
			this._scrollIntoView(getCommonAncestorElement(range) as HTMLElement, { block: 'start' });
		}
		else if (location.href) {
			const [pathname, hash] = location.href.split('#');
			const section = this._book.spine.get(pathname);
			if (!section) {
				console.error('Unable to find section for pathname', pathname);
				return;
			}
			const target = hash && this._sectionViews[section.index].container
				.querySelector('[id="' + hash.replace(/"/g, '"') + '"]');
			if (target) {
				this._scrollIntoView(target as HTMLElement, { block: 'start' });
			}
			else {
				const view = this._sectionViews[section.index];
				if (!view) {
					console.error('Unable to find view for section', section.index);
					return;
				}
				this._scrollIntoView(view.container, { inline: 'start', block: 'start' });
			}
		}
		else {
			super.navigate(location);
		}
	}

	_scrollIntoView(elem: HTMLElement, options?: ScrollIntoViewOptions) {
		if (this._viewState.flowMode != 'paginated') {
			elem.scrollIntoView(options);
			return;
		}
		const elemOffset = elem.offsetLeft;
		const spreadWidth = this._sectionsContainer.offsetWidth + 60;
		const pageIndex = Math.floor(elemOffset / spreadWidth);
		this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex));
		this._handleViewUpdate();
	}

	// This is like back/forward navigation in browsers. Try Cmd-ArrowLeft and Cmd-ArrowRight in PDF view
	navigateBack() {
		this.navigate({ pageNumber: this._navStack.popBack() }, true);
	}

	navigateForward() {
		this.navigate({ pageNumber: this._navStack.popForward() }, true);
	}

	// Possibly we want different navigation types as well.
	// I.e. Books.app has a concept of "chapters"
	navigateToFirstPage() {
		console.log('Navigate to first page');
	}

	navigateToLastPage() {
		console.log('Navigate to last page');
	}
	
	canNavigateToPreviousPage() {
		if (this._viewState.flowMode == 'paginated') {
			return parseInt(this._iframeDocument.documentElement.style.getPropertyValue('--page-index') || '0') > 0;
		}
		else {
			return this._iframeWindow.scrollY >= this._iframe.clientHeight;
		}
	}
	
	canNavigateToNextPage() {
		if (this._viewState.flowMode == 'paginated') {
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
		if (this._viewState.flowMode != 'paginated') {
			this._iframeWindow.scrollBy({ top: -this._iframe.clientHeight });
			return;
		}
		const pageIndex = parseInt(this._iframeDocument.documentElement.style.getPropertyValue('--page-index') || '0');
		this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex - 1));
		this._handleViewUpdate();
	}

	navigateToNextPage() {
		if (!this.canNavigateToNextPage()) {
			return;
		}
		if (this._viewState.flowMode != 'paginated') {
			this._iframeWindow.scrollBy({ top: this._iframe.clientHeight });
			return;
		}
		const pageIndex = parseInt(this._iframeDocument.documentElement.style.getPropertyValue('--page-index') || '0');
		this._iframeDocument.documentElement.style.setProperty('--page-index', String(pageIndex + 1));
		this._handleViewUpdate();
	}

	// Still need to figure out how this is going to work
	print() {
		console.log('Print');
	}
	
	setSidebarOpen(_sidebarOpen: boolean) {
		window.dispatchEvent(new Event('resize'));
	}
}

type FlowMode = 'paginated' | 'scrolled';

export type EPUBViewState = {
	cfi?: string;
	persistedLocations?: string;
	scale?: number;
	flowMode?: FlowMode;
};

export default EPUBView;
