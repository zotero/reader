import { isMac } from '../../common/lib/utilities';
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
	Contents,
	EpubCFI,
	Location as EPUBLocation,
	NavItem,
	Rendition
} from "epubjs";
import { getSelectionRanges } from "../common/lib/selection";
import {
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes
} from "../common/lib/range";
import {
	FragmentSelectorConformsTo,
	isFragment,
	Selector
} from "../common/lib/selector";
import Section from "epubjs/types/section";
import View from "epubjs/types/managers/view";
import { EPUBFindProcessor } from "./find";
import {
	IGNORE_CLASS,
	PAGE_TURN_WHEEL_THRESHOLD,
	PAGE_TURN_WHEEL_TIMEOUT
} from "./defines";
import './stylesheets/main.scss';
import NavStack from "../common/lib/nav-stack";
import DOMView, { DOMViewOptions } from "../common/dom-view";

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

	private readonly _rendition: Rendition;

	private _displayPromise: Promise<void>;

	private _gotMouseUp = false;

	private _lastSelection: { cfi: string, contents: Contents } | null = null;
	
	private _lastFocusTarget: HTMLElement | null = null;
	
	private readonly _navStack = new NavStack<string>();
	
	private _wheelAmount = 0;
	
	private _wheelResetTimeout: number | null = null;

	constructor(options: DOMViewOptions<EPUBViewState>) {
		super(options);
		
		this._book = Epub(options.buf);
		this._book.ready.then(() => this._initLocations());
		
		this._rendition = this._book.renderTo(this._container, {
			width: '100%',
			height: '100%',
			ignoreClass: IGNORE_CLASS,
			manager: 'continuous',
		});
		
		this._rendition.on('rendered', (section: Section, view: View) => {
			if (view.contents) this._onContentsRendered(view.contents);
		});
		this._rendition.on('relocated', (location: EPUBLocation) => this._handleRelocated(location));
		this._rendition.on('selected',
			(cfiRange: string, contents: Contents) => this._handleSelected(cfiRange, contents));
		
		this._displayPromise = this._rendition.display();
		this._displayPromise.then(() => {
			this._setInitialViewState(options.viewState);
			this._onInitialDisplay();
		});
	}

	private async _initLocations() {
		const localStorageKey = this._book.key() + '-locations';
		if (window.dev && !this._viewState.persistedLocations) {
			this._viewState.persistedLocations = window.localStorage.getItem(localStorageKey) || undefined;
		}
		if (this._viewState.persistedLocations) {
			this._book.locations.load(this._viewState.persistedLocations);
		}
		else {
			await this._book.locations.generate(150);
			this._viewState.persistedLocations = this._book.locations.save();
			this._updateViewState();
			if (window.dev) {
				window.localStorage.setItem(localStorageKey, this._book.locations.save());
			}
		}
		await this._displayPromise;
		this._updateViewStats();
	}

	private _onInitialDisplay() {
		this._updateViewStats();
		this._initOutline();
	}

	private _initOutline() {
		const toOutlineItem: (navItem: NavItem) => OutlineItem = navItem => ({
			title: navItem.label,
			location: { href: navItem.href },
			items: navItem.subitems?.map(toOutlineItem),
			expanded: true,
		});
		
		if (!this._book.navigation.toc.length) {
			return;
		}
		
		// first is title page, so make it the root with everything else as its children
		const [first, ...rest] = this._book.navigation.toc;
		const root = toOutlineItem({
			...first,
			subitems: rest
		});
		
		this._options.onSetOutline([root]);
	}

	private _setInitialViewState(viewState?: EPUBViewState) {
		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		if (viewState) {
			if (viewState.scale) {
				this._rendition.themes.fontSize(viewState.scale + 'em');
			}
			else {
				viewState.scale = 1;
			}
			if (viewState.cfi) {
				this._displayPromise = this._displayPromise.then(() => this._rendition.display(viewState.cfi));
			}
			if (viewState.flowMode) {
				this.setFlowMode(viewState.flowMode);
			}
		}
	}

	protected override _getSectionAnnotations(section: number): WADMAnnotation[] {
		return this._annotationsBySection.get(section) ?? [];
	}

	protected override _getSectionDocument(section: number): Document | null {
		return this._rendition.views().find(section)?.contents?.document ?? null;
	}

	protected override _getSelectorSection(selector: Selector): number {
		if (!isFragment(selector) || selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
			throw new Error('Unsupported selector');
		}
		return new EpubCFI(selector.value).spinePos;
	}

	private _renderAllAnnotations() {
		if (!this._rendition) return;
		for (const view of this._rendition.views().all()) {
			this._renderAnnotations(view.section.index);
		}
	}

	override toSelector(range: Range): Selector | null {
		const contents = this._rendition.getContents()
			.find(c => c.document == range.startContainer.ownerDocument);
		if (!contents) return null;
		const cfi = contents.cfiFromRange(range, IGNORE_CLASS);
		return {
			type: 'FragmentSelector',
			conformsTo: FragmentSelectorConformsTo.EPUB3,
			value: cfi
		};
	}
	
	toRange(selector: Selector): Promise<Range | null> {
		switch (selector.type) {
			case 'FragmentSelector': {
				if (selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
					throw new Error(`Unsupported FragmentSelector.conformsTo: ${selector.conformsTo}`);
				}
				if (selector.refinedBy) {
					throw new Error('Refinement of FragmentSelectors is not supported');
				}
				// Book#getRange() returns a promise and searches across all sections
				return this._book.getRange(selector.value);
			}
			default:
				// No other selector types supported on EPUBs
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
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
				// Rendition#getRange() returns a range and searches only the currently displayed section
				return this._rendition.getRange(selector.value, IGNORE_CLASS) || null;
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
	
	_pushCurrentLocationToNavStack() {
		this._navStack.push(this._rendition.currentLocation().start.cfi);
		this._updateViewStats();
	}
	
	override _navigateToSelector(selector: Selector) {
		if (!isFragment(selector) || selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
			console.warn("Not a CFI FragmentSelector", selector);
			return;
		}
		this._displayPromise = this._displayPromise.then(() => this._rendition.display(selector.value));
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

	// Currently type is only 'highlight' but later there will also be 'underline'
	protected override _getAnnotationFromTextSelection(type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		if (!this._lastSelection) {
			return null;
		}
		const { cfi, contents } = this._lastSelection;
		const selection = contents.window.getSelection();
		if (!selection || !selection.rangeCount) {
			return null;
		}
		const text = selection.toString();
		const range = moveRangeEndsIntoTextNodes(makeRangeSpanning(...getSelectionRanges(selection)));
		const selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		const location = this._book.locations.locationFromCfi(cfi);
		const locationLabel = String(location + 1);
		let sortIndex = locationLabel.padStart(10, '0');
		
		// If possible, use the number of characters between the start of the location and the start of the selection
		// range to disambiguate the sortIndex
		const offsetRange = this._rendition.getRange(this._book.locations.cfiFromLocation(location) as string);
		if (offsetRange) {
			if (offsetRange.comparePoint(range.startContainer, range.startOffset) < 0) {
				offsetRange.setStart(range.startContainer, range.startOffset);
				// Why can locationFromCfi() return a location that apparently starts after the CFI? No idea
				// But we'll work around it by inverting the offset
				sortIndex += '|' + String(999 - offsetRange.toString().length).padStart(3, '0');
			}
			else {
				offsetRange.setEnd(range.startContainer, range.startOffset);
				sortIndex += '|' + String(offsetRange.toString().length).padStart(3, '0');
			}
		}
		return {
			type,
			color,
			sortIndex,
			pageLabel: locationLabel,
			position: selector,
			text
		};
	}

	private _tryUseTool(): boolean {
		this._updateViewStats();
		if (this._gotMouseUp && this._lastSelection) {
			// Open text selection popup if current tool is pointer
			if (this._tool.type == 'pointer') {
				const selection = this._lastSelection.contents.window.getSelection();
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
				this._lastSelection.contents.window.getSelection()?.removeAllRanges();
				return true;
			}
		}
		return false;
	}

	// ***
	// Event handlers
	// ***

	private _handleRelocated(_location: EPUBLocation) {
		this._updateViewStats();
	}

	private _handleSelected(cfiRange: string, contents: Contents) {
		this._updateViewStats();
		this._lastSelection = { cfi: cfiRange, contents };
		if (this._tryUseTool()) {
			return;
		}
		this._options.onSetSelectionPopup(null);
	}

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
		const ctrl = event.ctrlKey;
		const cmd = event.metaKey && isMac();
		const _mod = ctrl || cmd;
		const _alt = event.altKey;
		const shift = event.shiftKey;

		// Focusable elements in PDF view are annotations and overlays (links, citations, figures).
		// Once TAB is pressed, arrows can be used to navigate between them
		const focusableElements: HTMLElement[] = [];
		let focusedElementIndex = -1;
		let focusedElement: HTMLElement | null = null;
		for (const view of this._rendition.views().all()) {
			if (!view.contents) continue;
			if (!focusedElement && view.contents.document.activeElement) {
				focusedElement = view.contents.document.activeElement as HTMLElement;
			}
			for (const element of view.contents.document.querySelectorAll('[tabindex="-1"]')) {
				focusableElements.push(element as HTMLElement);
				if (element === focusedElement) {
					focusedElementIndex = focusableElements.length - 1;
				}
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
		this._handleViewUpdate();
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

	private _handleResize(_event: Event) {
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
		if (doc.getSelection()?.isCollapsed ?? true) {
			this._options.onSetSelectionPopup(null);
			this._lastSelection = null;
		}
	}
	
	private _handleLinkClicked(_href: string) {
		this._pushCurrentLocationToNavStack();
	}
	
	private _updateViewState() {
		if (!this._rendition.currentLocation().start) {
			return;
		}
		const viewState: EPUBViewState = {
			...this._viewState,
			cfi: this._rendition.currentLocation().start.cfi,
		};
		this._viewState = viewState;
		this._options.onChangeViewState(viewState);
	}

	// View stats provide information about the view
	private _updateViewStats() {
		const currentLocation = this._rendition.currentLocation();
		const current = this._book.locations.locationFromCfi(currentLocation.start.cfi);
		const total = this._book.locations.total;
		const percentage = new Intl.NumberFormat(undefined, { style: 'percent' })
			.format(this._book.locations.percentageFromCfi(currentLocation.start.cfi));
		const viewStats: ViewStats = {
			pageIndex: current,
			pagesCount: total,
			percentage: percentage,
			canCopy: !!this._selectedAnnotationIDs.length || !!this._lastSelection,
			canZoomIn: this._viewState.scale === undefined || this._viewState.scale < 1.5,
			canZoomOut: this._viewState.scale === undefined || this._viewState.scale > 0.8,
			canZoomReset: this._viewState.scale !== undefined && this._viewState.scale !== 1,
			canNavigateBack: this._navStack.canPopBack(),
			canNavigateForward: this._navStack.canPopForward(),
			canNavigateToFirstPage: !currentLocation.atStart,
			canNavigateToLastPage: !currentLocation.atEnd,
			canNavigateToPreviousPage: !currentLocation.atStart,
			canNavigateToNextPage: !currentLocation.atEnd,
			flowMode: this._viewState.flowMode,
		};
		this._options.onChangeViewStats(viewStats);
	}

	private _onContentsRendered(contents: Contents) {
		this._lastSelection = null;
		// Long-term goal is to make this reader touch friendly, which probably means using
		// not mouse* but pointer* or touch* events
		contents.window.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		contents.window.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		contents.window.addEventListener('click', this._handleClick.bind(this));
		contents.window.addEventListener('mouseover', this._handleMouseEnter.bind(this));
		contents.window.addEventListener('mousedown', this._handlePointerDown.bind(this), true);
		contents.window.addEventListener('mouseup', this._handlePointerUp.bind(this));
		contents.window.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		// @ts-ignore
		contents.window.addEventListener('copy', this._handleCopy.bind(this));
		contents.window.addEventListener('resize', this._handleResize.bind(this));
		contents.window.addEventListener('focus', this._handleFocus.bind(this));
		contents.document.addEventListener('scroll', this._handleScroll.bind(this), { passive: true });
		contents.document.addEventListener('wheel', this._handleWheel.bind(this));
		contents.document.addEventListener('selectionchange', this._handleSelectionChange.bind(this));
		contents.on('linkClicked', this._handleLinkClicked.bind(this));
		this._handleViewUpdate();
	}

	// Called on scroll, resize, etc.
	private _handleViewUpdate() {
		this._updateViewState();
		this._updateViewStats();
		// Update annotation popup position
		if (this._annotationPopup) {
			const { annotation } = this._annotationPopup;
			if (annotation) {
				// Note: There is currently a bug in React components part therefore the popup doesn't
				// properly update its position when window is resized
				this._openAnnotationPopup(annotation as WADMAnnotation);
			}
		}
		// Update selection popup position
		if (this._selectionPopup) {
			const selection = this._lastSelection?.contents.window.getSelection();
			if (selection) {
				this._openSelectionPopup(selection);
			}
		}
		// Close overlay popup
		this._options.onSetOverlayPopup();
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

		for (const view of this._rendition.views().all()) {
			view.contents?.window.getSelection()?.empty();
		}

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
					book: this._book,
					rendition: this._rendition,
					location: this._rendition.currentLocation(),
					section: this._book.spine.get(this._rendition.currentLocation().start.index),
					query: popup.query,
					highlightAll: popup.highlightAll,
					caseSensitive: popup.caseSensitive,
					entireWord: popup.entireWord,
				});
				this._displayPromise = this._displayPromise.then(() => this.findNext());
			}
		}
	}
	
	setFlowMode(flowMode: FlowMode) {
		switch (flowMode) {
			case 'paginated':
				this._rendition.flow('paginated');
				break;
			case 'scrolled':
				this._rendition.flow('scrolled');
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
				this._displayPromise.then(() => this._renderAllAnnotations());
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
				this._displayPromise.then(() => this._renderAllAnnotations());
			}
		}
	}

	zoomIn() {
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._viewState.scale = scale;
		this._rendition.themes.override('font-size', scale + 'em');
		this._handleViewUpdate();
	}

	zoomOut() {
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale -= 0.1;
		this._viewState.scale = scale;
		this._rendition.themes.override('font-size', scale + 'em');
		this._handleViewUpdate();
	}

	zoomReset() {
		this._viewState.scale = 1;
		this._rendition.themes.override('font-size', '1em');
		this._handleViewUpdate();
	}

	override navigate(location: NavLocation) {
		console.log('Navigating to', location);
		this._pushCurrentLocationToNavStack();
		if (location.pageNumber) {
			let cfi: string;
			if (location.pageNumber.startsWith('epubcfi(')) {
				cfi = location.pageNumber;
			}
			else {
				let locationIndex = parseInt(location.pageNumber);
				if (isNaN(locationIndex)) {
					console.warn('Invalid location index', locationIndex);
					return;
				}
				locationIndex--;
				if (locationIndex < 0) {
					locationIndex = 0;
				}
				if (locationIndex >= this._book.locations.length()) {
					locationIndex = this._book.locations.length() - 1;
				}
				cfi = this._book.locations.cfiFromLocation(locationIndex) as string;
			}
			this._displayPromise = this._displayPromise.then(() => this._rendition.display(cfi));
		}
		else if (location.href) {
			this._displayPromise = this._displayPromise.then(() => this._rendition.display(location.href));
		}
		else {
			super.navigate(location);
		}
	}

	// This is like back/forward navigation in browsers. Try Cmd-ArrowLeft and Cmd-ArrowRight in PDF view
	navigateBack() {
		this._displayPromise = this._displayPromise.then(() => this._rendition.display(this._navStack.popBack()));
	}

	navigateForward() {
		this._displayPromise = this._displayPromise.then(() => this._rendition.display(this._navStack.popForward()));
	}

	// Possibly we want different navigation types as well.
	// I.e. Books.app has a concept of "chapters"
	navigateToFirstPage() {
		console.log('Navigate to first page');
	}

	navigateToLastPage() {
		console.log('Navigate to last page');
	}

	navigateToPreviousPage() {
		this._displayPromise = this._displayPromise.then(() => this._rendition.prev());
	}

	navigateToNextPage() {
		this._displayPromise = this._displayPromise.then(() => this._rendition.next());
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
