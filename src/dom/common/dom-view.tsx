import {
	Annotation,
	AnnotationPopupParams,
	AnnotationType,
	ArrayRect,
	WADMAnnotation,
	FindState,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	SelectionPopupParams,
	Tool,
	ViewStats,
	NavLocation,
} from "../../common/types";
import PopupDelayer from "../../common/lib/popup-delayer";
import ReactDOM from "react-dom";
import {
	AnnotationOverlay,
	DisplayedAnnotation
} from "./components/overlay/annotation-overlay";
import React from "react";
import { IGNORE_CLASS } from "../epub/defines";
import {
	Selector
} from "./lib/selector";
import {
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes
} from "./lib/range";
import { getSelectionRanges } from "./lib/selection";
import { FindProcessor } from "./find";
import { SELECTION_COLOR } from "../../common/defines";
import { isSafari } from "../../common/lib/utilities";

abstract class DOMView<State> {
	protected readonly _container: Element;
	
	protected readonly _iframe: HTMLIFrameElement;

	protected _iframeWindow!: Window & typeof globalThis;
	
	protected _iframeDocument!: Document;

	protected _tool: Tool;

	protected _selectedAnnotationIDs: string[];

	protected _annotations!: WADMAnnotation[];

	protected _annotationsByID!: Map<string, WADMAnnotation>;

	protected _showAnnotations: boolean;

	protected _annotationPopup: AnnotationPopupParams<WADMAnnotation> | null;

	protected _selectionPopup: SelectionPopupParams<WADMAnnotation> | null;

	protected _overlayPopup: OverlayPopupParams | null;

	protected _findState: FindState | null;

	protected abstract _find: FindProcessor | null;

	protected _viewState: Partial<State>;

	protected readonly _options: DOMViewOptions<State>;

	protected _overlayPopupDelayer: PopupDelayer;

	protected _disableAnnotationPointerEvents = false;

	protected _highlightedPosition: Selector | null = null;

	protected _gotPointerUp = false;

	protected constructor(options: DOMViewOptions<State>) {
		this._options = options;
		this._container = options.container;

		// The variables below are from reader._state and are constantly updated
		// using setTool, setAnnotation, etc.

		// Tool type can be 'highlight', 'note' or 'pointer' (no tool at all), also 'underline' in future
		this._tool = options.tool;
		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		this.setAnnotations(options.annotations);
		// Don't show annotations if this is false
		this._showAnnotations = options.showAnnotations;
		this._annotationPopup = options.annotationPopup;
		this._selectionPopup = options.selectionPopup;
		this._overlayPopup = options.overlayPopup;
		this._findState = options.findState;
		this._viewState = options.viewState || {};
		this._overlayPopupDelayer = new PopupDelayer({ open: !!this._overlayPopup });

		this._iframe = document.createElement('iframe');
		this._iframe.sandbox.add('allow-same-origin');
		// A WebKit bug prevents listeners added by the parent page (us) from running inside a child frame (this._iframe)
		// unless the allow-scripts permission is added to the frame's sandbox. That means that we have to allow scripts
		// and very carefully sanitize.
		// https://bugs.webkit.org/show_bug.cgi?id=218086
		if (isSafari) {
			this._iframe.sandbox.add('allow-scripts');
		}
		this._iframe.srcdoc = this._getSrcDoc();
		this._iframe.addEventListener('load', () => this._handleIFrameLoad(), { once: true });
		options.container.append(this._iframe);
	}
	
	protected abstract _getSrcDoc(): string;

	protected abstract _onInitialDisplay(viewState: Partial<State>): void;

	// ***
	// Utilities for annotations - abstractions over the specific types of selectors used by the two views
	// ***

	abstract toSelector(range: Range): Selector | null;

	abstract toDisplayedRange(selector: Selector): Range | null;
	
	protected abstract _navigateToSelector(selector: Selector): void;

	// ***
	// Abstractions over document structure
	// ***
	
	protected abstract _getAnnotationOverlayParent(): ParentNode | null;

	protected abstract _getViewportBoundingRect(range: Range): DOMRect;
	
	protected abstract _getAnnotationFromTextSelection(type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null;
	
	protected abstract _updateViewState(): void;
	
	protected abstract _updateViewStats(): void;
	
	protected abstract _isExternalLink(link: HTMLAnchorElement): boolean;

	// ***
	// Utilities - called in appropriate event handlers
	// ***

	protected _tryUseTool(): boolean {
		this._updateViewStats();
		if (this._gotPointerUp) {
			// Open text selection popup if current tool is pointer
			if (this._tool.type == 'pointer') {
				const selection = this._iframeWindow.getSelection();
				if (selection && !selection.isCollapsed) {
					this._openSelectionPopup(selection);
					return true;
				}
			}
			if (this._tool.type === 'highlight') {
				const annotation = this._getAnnotationFromTextSelection('highlight', this._tool.color);
				if (annotation && annotation.text) {
					this._options.onAddAnnotation(annotation);
				}
				this._iframeWindow.getSelection()?.removeAllRanges();
				return true;
			}
		}
		return false;
	}

	protected _handleViewUpdate() {
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
	}
	
	protected _renderAnnotations() {
		const root = this._getAnnotationOverlayParent();
		if (!root) {
			return;
		}
		const doc = root.ownerDocument!;
		let container = root.querySelector('#annotation-overlay');
		if (!container) {
			container = doc.createElement('div');
			container.id = 'annotation-overlay';
			container.classList.add(IGNORE_CLASS);
			root.append(container);
		}
		const displayedAnnotations: DisplayedAnnotation[] = [
			...this._annotations.map(a => ({
				id: a.id,
				type: a.type,
				color: a.color,
				text: a.text,
				hasComment: !!a.comment,
				range: this.toDisplayedRange(a.position),
			})).filter(a => !!a.range) as DisplayedAnnotation[],
			...this._find?.getAnnotations() ?? []
		];
		if (this._highlightedPosition) {
			displayedAnnotations.push({
				type: 'highlight',
				color: SELECTION_COLOR,
				hasComment: false,
				range: this.toDisplayedRange(this._highlightedPosition)!,
			});
		}
		ReactDOM.render((
			<AnnotationOverlay
				annotations={displayedAnnotations}
				selectedAnnotationIDs={this._selectedAnnotationIDs}
				onSelect={id => this._openAnnotationPopup(this._annotationsByID.get(id)!)}
				onDragStart={(dataTransfer, id) => {
					this._options.onSetDataTransferAnnotations(dataTransfer, this._annotationsByID.get(id)!);
				}}
				onResize={(id, range) => this._handleAnnotationResize(id, range)}
				disablePointerEvents={this._disableAnnotationPointerEvents}
			/>
		), container);
	}

	protected _openSelectionPopup(selection: Selection) {
		if (selection.isCollapsed) {
			return;
		}
		const range = moveRangeEndsIntoTextNodes(makeRangeSpanning(...getSelectionRanges(selection)));
		const domRect = this._getViewportBoundingRect(range);
		const rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		const annotation = this._getAnnotationFromTextSelection('highlight');
		if (annotation) {
			this._options.onSetSelectionPopup({ rect, annotation });
		}
	}

	protected _openAnnotationPopup(annotation: WADMAnnotation) {
		// Note: Popup won't be visible if sidebar is opened
		const range = this.toDisplayedRange(annotation.position);
		if (!range) {
			return;
		}
		const domRect = this._getViewportBoundingRect(range);
		const rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		this._options.onSelectAnnotations([annotation.id]);
		this._options.onSetAnnotationPopup({ rect, annotation });
	}

	protected _openExternalLinkOverlayPopup(linkNode: HTMLAnchorElement) {
		const range = linkNode.ownerDocument.createRange();
		range.selectNode(linkNode);
		const domRect = this._getViewportBoundingRect(range);
		const rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		const overlayPopup = {
			type: 'external-link',
			url: linkNode.href,
			rect,
			ref: linkNode
		};
		this._options.onSetOverlayPopup(overlayPopup);
	}

	// ***
	// Event handlers
	// ***

	protected _handleIFrameLoad() {
		this._iframeWindow = this._iframe.contentWindow as Window & typeof globalThis;
		this._iframeDocument = this._iframe.contentDocument!;

		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('click', this._handleClick.bind(this));
		this._iframeWindow.addEventListener('pointerover', this._handlePointerOver.bind(this));
		this._iframeWindow.addEventListener('pointerdown', this._handlePointerDown.bind(this), true);
		this._iframeWindow.addEventListener('pointerup', this._handlePointerUp.bind(this));
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		// @ts-ignore
		this._iframeWindow.addEventListener('copy', this._handleCopy.bind(this));
		this._iframeWindow.addEventListener('resize', this._handleResize.bind(this));
		this._iframeWindow.addEventListener('scroll', this._handleScroll.bind(this), { passive: true });
		this._iframeWindow.addEventListener('focus', this._handleFocus.bind(this));
		this._iframeDocument.addEventListener('selectionchange', this._handleSelectionChange.bind(this));

		this._onInitialDisplay(this._options.viewState || {});
	}

	protected _handlePointerOver(event: PointerEvent) {
		const link = (event.target as Element).closest('a');
		if (link && this._isExternalLink(link)) {
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

	protected _handleClick(event: MouseEvent) {
		const link = (event.target as Element).closest('a');
		if (!link) {
			return;
		}
		event.preventDefault();
		if (this._isExternalLink(link)) {
			this._options.onOpenLink(link.href);
		}
		else {
			this._handleInternalLinkClick(link);
		}
	}
	
	protected abstract _handleInternalLinkClick(link: HTMLAnchorElement): void;
	
	protected _handleKeyDown(event: KeyboardEvent) {
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

	private _handleContextMenu(event: MouseEvent) {
		// Prevent native context menu
		event.preventDefault();
		const br = this._iframe.getBoundingClientRect();
		this._options.onOpenViewContextMenu({ x: br.x + event.clientX, y: br.y + event.clientY });
	}

	private _handleSelectionChange() {
		if (!this._iframeDocument.hasFocus()) {
			this._iframe.focus();
		}
		const selection = this._iframeDocument.getSelection();
		if (!selection || selection.isCollapsed) {
			this._options.onSetSelectionPopup(null);
		}
		else {
			this._updateViewStats();
			this._tryUseTool();
		}
	}

	private _handleAnnotationResize(id: string, range: Range) {
		if (!range.toString().length
			// Just bail if the browser thinks the mouse is over the SVG - that seems to only happen momentarily
			|| range.startContainer.nodeType == Node.ELEMENT_NODE && (range.startContainer as Element).closest('svg')
			|| range.endContainer.nodeType == Node.ELEMENT_NODE && (range.endContainer as Element).closest('svg')) {
			return;
		}

		const annotation = this._annotationsByID.get(id)!;
		const selector = this.toSelector(moveRangeEndsIntoTextNodes(range));
		if (!selector) {
			// Probably resized past the end of a section - don't worry about it
			return;
		}
		annotation.position = selector;
		annotation.text = range.toString();
		this._options.onUpdateAnnotations([annotation]);
	}

	protected _handleCopy(event: ClipboardEvent) {
		if (!event.clipboardData) {
			return;
		}
		if (this._selectedAnnotationIDs.length) {
			// It's enough to provide only one of selected annotations,
			// others will be included automatically by _onSetDataTransferAnnotations
			const annotation = this._annotationsByID.get(this._selectedAnnotationIDs[0]);
			if (!annotation) {
				return;
			}
			console.log('Copying annotation', annotation);
			this._options.onSetDataTransferAnnotations(event.clipboardData, annotation);
		}
		else {
			const annotation = this._getAnnotationFromTextSelection('highlight');
			if (!annotation) {
				return;
			}
			console.log('Copying text', annotation);
			this._options.onSetDataTransferAnnotations(event.clipboardData, annotation, true);
		}
		event.preventDefault();
	}

	protected _handlePointerDown(event: PointerEvent) {
		this._gotPointerUp = false;

		this._options.onSetOverlayPopup();

		if (event.button !== 0) {
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

	protected _handlePointerUp(event: PointerEvent) {
		if (event.button !== 0) {
			return;
		}

		this._gotPointerUp = true;
		this._tryUseTool();

		this._disableAnnotationPointerEvents = false;
		this._renderAnnotations();
	}

	protected _handleResize() {
		this._handleViewUpdate();
	}

	private _handleScroll() {
		this._handleViewUpdate();
	}

	private _handleFocus() {
		this._options.onFocus();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setTool(tool: Tool) {
		this._tool = tool;
	}

	setAnnotations(annotations: WADMAnnotation[]) {
		// Individual annotation object reference changes only if that annotation was modified,
		// so it's possible to do rendering optimizations by skipping other annotations
		this._annotations = annotations;
		this._annotationsByID = new Map(annotations.map(a => [a.id, a]));
		this._renderAnnotations();
	}

	setShowAnnotations(show: boolean) {
		this._showAnnotations = show;
	}

	setSelectedAnnotationIDs(ids: string[]) {
		this._selectedAnnotationIDs = ids;
		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._options.onSetAnnotationPopup();
		this._renderAnnotations();

		this._iframeWindow.getSelection()?.empty();

		this._updateViewStats();
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

	// ***
	// Public methods to control the view from the outside
	// ***

	focus() {
		this._iframe.focus();
	}

	navigate(location: NavLocation) {
		if (location.annotationID) {
			const annotation = this._annotationsByID.get(location.annotationID);
			if (!annotation) {
				return;
			}
			const selector = annotation.position;
			this._navigateToSelector(selector);
		}
		else if (location.position) {
			const selector = location.position as Selector;
			this._navigateToSelector(selector);
			this._highlightedPosition = selector;

			this._renderAnnotations();
			setTimeout(() => {
				this._highlightedPosition = null;
				this._renderAnnotations();
			}, 2000);
		}
	}
}

export type DOMViewOptions<State> = {
	portal?: boolean;
	container: Element;
	tool: Tool;
	selectedAnnotationIDs: string[];
	annotations: WADMAnnotation[];
	showAnnotations: boolean;
	annotationPopup: AnnotationPopupParams<WADMAnnotation> | null;
	selectionPopup: SelectionPopupParams<WADMAnnotation> | null;
	overlayPopup: OverlayPopupParams | null;
	findState: FindState;
	viewState?: State;
	onSetOutline: (outline: OutlineItem[]) => void;
	onChangeViewState: (state: State, primary?: boolean) => void;
	onChangeViewStats: (stats: ViewStats) => void;
	onSetDataTransferAnnotations: (dataTransfer: DataTransfer, annotation: NewAnnotation<WADMAnnotation>, fromText?: boolean) => void;
	onAddAnnotation: (annotation: NewAnnotation<WADMAnnotation>, select?: boolean) => void;
	onUpdateAnnotations: (annotations: Annotation[]) => void;
	onOpenLink: (url: string) => void;
	onSelectAnnotations: (ids: string[]) => void;
	onSetSelectionPopup: (params?: SelectionPopupParams<WADMAnnotation> | null) => void;
	onSetAnnotationPopup: (params?: AnnotationPopupParams<WADMAnnotation> | null) => void;
	onSetOverlayPopup: (params?: OverlayPopupParams) => void;
	onSetFindState: (state?: FindState) => void;
	onOpenViewContextMenu: (params: { x: number, y: number }) => void;
	onFocus: () => void;
	onTabOut: (isShiftTab?: boolean) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	buf: ArrayBuffer;
};

export default DOMView;
