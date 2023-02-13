import { isMac } from '../../common/lib/utilities';
import {
	AnnotationPopupParams,
	AnnotationType,
	WADMAnnotation,
	FindPopupParams,
	NavLocation,
	NewAnnotation,
	OverlayPopupParams,
	SelectionPopupParams,
	Tool,
	ViewStats
} from "../../common/types";
import { getSelectionRanges } from "../common/lib/selection";
import {
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes,
	scrollToCenter
} from "../common/lib/range";
import {
	CssSelector,
	textPositionFromRange,
	Selector,
	textPositionToRange
} from "../common/lib/selector";
import DOMView, { DOMViewOptions } from "../common/dom-view";
import { getUniqueSelectorContaining } from "../common/lib/unique-selector";
import NavStack from "../common/lib/nav-stack";
import { SnapshotFindProcessor } from "./find";

class SnapshotView extends DOMView<SnapshotViewState> {
	private readonly _iframe: HTMLIFrameElement;
	
	private _iframeWindow!: Window & typeof globalThis;

	private readonly _navStack = new NavStack<[number, number]>();

	protected _findProcessor: SnapshotFindProcessor | null = null;

	constructor(options: DOMViewOptions<SnapshotViewState>) {
		super(options);
		
		const enc = new TextDecoder('utf-8');
		const text = enc.decode(options.buf);
		this._iframe = document.createElement('iframe');
		this._iframe.sandbox.add('allow-same-origin');
		this._iframe.srcdoc = text;
		this._iframe.addEventListener('load', () => {
			this._iframeWindow = this._iframe.contentWindow as Window & typeof globalThis;
			this._setInitialViewState(options.viewState);
			this._onIFrameLoad();
		});
		this._container.append(this._iframe);
	}

	private _onIFrameLoad() {
		const win = this._iframeWindow;
		const doc = this._iframeWindow.document;
		win.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		win.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		win.addEventListener('click', this._handleClick.bind(this));
		win.addEventListener('mouseover', this._handleMouseEnter.bind(this));
		win.addEventListener('mousedown', this._handlePointerDown.bind(this), true);
		win.addEventListener('mouseup', this._handlePointerUp.bind(this));
		win.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		// @ts-ignore
		win.addEventListener('copy', this._handleCopy.bind(this));
		win.addEventListener('resize', this._handleResize.bind(this));
		win.addEventListener('focus', this._handleFocus.bind(this));
		doc.addEventListener('scroll', this._handleScroll.bind(this));
		doc.addEventListener('selectionchange', this._handleSelectionChange.bind(this));
		this._handleViewUpdate();
	}

	private _setInitialViewState(viewState?: SnapshotViewState) {
		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		if (viewState) {
			if (viewState.scale !== undefined) {
				this._iframeWindow.document.body.style.fontSize = viewState.scale + 'em';
			}
		}
	}

	protected override _getSectionAnnotations(_section: number): WADMAnnotation[] {
		return this._annotations;
	}

	protected override _getSectionDocument(_section: number): Document {
		return this._iframeWindow.document;
	}

	protected _getSelectorSection(_selector: Selector): number {
		return 0;
	}
	
	protected override _getAnnotationFromTextSelection(type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		const selection = this._iframeWindow.getSelection();
		if (!selection || !selection.rangeCount) {
			return null;
		}
		const text = selection.toString();
		const range = moveRangeEndsIntoTextNodes(makeRangeSpanning(...getSelectionRanges(selection)));
		const selector = this.toSelector(range);
		if (!selector) {
			return null;
		}
		return {
			type,
			color,
			sortIndex: '0', // TODO
			position: selector,
			text
		};
	}

	toSelector(range: Range): Selector | null {
		const doc = range.commonAncestorContainer.ownerDocument;
		if (!doc) return null;
		const commonAncestorQuery = getUniqueSelectorContaining(range.commonAncestorContainer, doc.body);
		if (commonAncestorQuery) {
			const newCommonAncestor = doc.body.querySelector(commonAncestorQuery);
			if (!newCommonAncestor) {
				throw new Error('commonAncestorQuery did not match');
			}
			const selector: CssSelector = {
				type: 'CssSelector',
				value: commonAncestorQuery
			};
			// If the user has highlighted the full text content of the element, no need to add a
			// TextPositionSelector.
			if (range.toString().trim() !== newCommonAncestor.textContent?.trim()) {
				selector.refinedBy = textPositionFromRange(range, newCommonAncestor) || undefined;
			}
			return selector;
		}
		else {
			return textPositionFromRange(range, doc.body);
		}
	}

	toDisplayedRange(selector: Selector): Range | null {
		const doc = this._iframeWindow.document;
		switch (selector.type) {
			case 'CssSelector': {
				if (selector.refinedBy && selector.refinedBy.type != 'TextPositionSelector') {
					throw new Error('CssSelectors can only be refined by TextPositionSelectors');
				}
				const root = doc.querySelector(selector.value);
				if (!root) {
					return null;
				}
				let range;
				if (selector.refinedBy) {
					range = textPositionToRange(selector.refinedBy, root);
				}
				else {
					range = doc.createRange();
					range.selectNodeContents(root);
				}
				return range;
			}
			case 'TextPositionSelector': {
				if (selector.refinedBy) {
					throw new Error('Refinement of TextPositionSelectors is not supported');
				}
				return textPositionToRange(selector, doc.body);
			}
			default:
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}

	protected override _renderAnnotations() {
		if (!this._iframeWindow) {
			return;
		}
		super._renderAnnotations(0);
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

	protected _navigateToSelector(selector: Selector) {
		const range = this.toDisplayedRange(selector);
		if (range) {
			scrollToCenter(range);
		}
		else {
			console.warn('Not a valid snapshot selector', selector);
		}
	}

	private _tryUseTool(): boolean {
		this._updateViewStats();
		return false;
	}

	private _updateViewState() {
		const viewState = {
			scale: 1,
			...this._viewState
		};
		this._viewState = viewState;
		this._options.onChangeViewState(viewState);
	}

	private _updateViewStats() {
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

	private _handleClick(event: Event) {
		const link = (event.target as Element).closest('a');
		if (!link) {
			return;
		}
		const href = link.getAttribute('href');
		if (!href) {
			return;
		}

		event.preventDefault();
		if (href.startsWith('#')) {
			this._pushCurrentLocationToNavStack();
			this._iframeWindow.location.hash = href;
		}
		else {
			this._options.onOpenLink(link.href);
		}
	}

	private _handleMouseEnter(event: MouseEvent) {
		const link = (event.target as Element).closest('a');
		if (link && !link.getAttribute('href')?.startsWith('#')) {
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
		const br = this._iframe.getBoundingClientRect();
		this._options.onOpenViewContextMenu({ x: br.x + event.clientX, y: br.y + event.clientY });
	}

	private _handlePointerDown(event: MouseEvent) {
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
			this._renderAnnotations();
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
		this._tryUseTool();

		this._disableAnnotationPointerEvents = false;
		this._renderAnnotations();
	}

	private _handleKeyDown(event: KeyboardEvent) {
		const { key: _key } = event;
		const ctrl = event.ctrlKey;
		const cmd = event.metaKey && isMac();
		const _mod = ctrl || cmd;
		const _alt = event.altKey;
		const _shift = event.shiftKey;
		
		// TODO

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
		// TODO
	}

	private _handleResize(_event: Event) {
		this._handleViewUpdate();
	}

	private _handleFocus(_event: FocusEvent) {
		this._options.onFocus();
	}

	private _handleSelectionChange(_event: Event) {
		const doc = this._iframeWindow.document;
		if (!doc.hasFocus()) {
			this._iframe.focus();
		}
		const selection = doc.getSelection();
		if (selection && !selection.isCollapsed) {
			this._openSelectionPopup(selection);
		}
		else {
			this._options.onSetSelectionPopup(null);
		}
	}

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
			const selection = this._iframeWindow.getSelection();
			if (selection) {
				this._openSelectionPopup(selection);
			}
		}
		// Close overlay popup
		this._options.onSetOverlayPopup();
		this._renderAnnotations();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setSelectedAnnotationIDs(ids: string[]) {
		this._selectedAnnotationIDs = ids;
		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._options.onSetAnnotationPopup();
		this._renderAnnotations();

		this._iframeWindow.getSelection()?.empty();

		this._updateViewStats();
	}

	setTool(tool: Tool) {
		this._tool = tool;
	}

	override setAnnotations(annotations: WADMAnnotation[]) {
		super.setAnnotations(annotations);
		this._renderAnnotations();
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
				this._findProcessor = new SnapshotFindProcessor({
					doc: this._iframeWindow.document,
					query: popup.query,
					highlightAll: popup.highlightAll,
					caseSensitive: popup.caseSensitive,
					entireWord: popup.entireWord,
				});
				this.findNext();
			}
		}
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	focus() {
		this._iframeWindow.focus();
	}

	findNext() {
		console.log('Find next');
		if (this._findProcessor) {
			const range = this._findProcessor.next();
			if (range) {
				scrollToCenter(range);
			}
			this._renderAnnotations();
		}
	}

	findPrevious() {
		console.log('Find previous');
		if (this._findProcessor) {
			const range = this._findProcessor.prev();
			if (range) {
				scrollToCenter(range);
			}
			this._renderAnnotations();
		}
	}

	zoomIn() {
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale += 0.1;
		this._viewState.scale = scale;
		this._iframeWindow.document.body.style.fontSize = scale + 'em';
		this._handleViewUpdate();
	}

	zoomOut() {
		let scale = this._viewState.scale;
		if (scale === undefined) scale = 1;
		scale -= 0.1;
		this._viewState.scale = scale;
		this._iframeWindow.document.body.style.fontSize = scale + 'em';
		this._handleViewUpdate();
	}

	zoomReset() {
		this._viewState.scale = 1;
		this._iframeWindow.document.body.style.fontSize = '';
		this._handleViewUpdate();
	}

	override navigate(location: NavLocation) {
		console.log('Navigating to', location);
		this._pushCurrentLocationToNavStack();
		super.navigate(location);
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

export type SnapshotViewState = {
	scale?: number;
};

export default SnapshotView;
