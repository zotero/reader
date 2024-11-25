// @ts-ignore
import injectCSS from './stylesheets/inject.scss';
// @ts-ignore
import annotationsCSS from './stylesheets/annotations.scss';

import {
	Annotation,
	AnnotationPopupParams,
	AnnotationType,
	ArrayRect,
	FindState,
	MaybePromise,
	NavLocation,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	Platform,
	SelectionPopupParams,
	Tool,
	ViewStats,
	WADMAnnotation,
} from "../../common/types";
import PopupDelayer from "../../common/lib/popup-delayer";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";
import {
	AnnotationOverlay,
	DisplayedAnnotation
} from "./components/overlay/annotation-overlay";
import React from "react";
import { Selector } from "./lib/selector";
import {
	caretPositionFromPoint,
	getBoundingPageRect,
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes,
	PersistentRange,
	supportsCaretPositionFromPoint
} from "./lib/range";
import { getSelectionRanges } from "./lib/selection";
import { FindProcessor } from "./lib/find";
import { SELECTION_COLOR } from "../../common/defines";
import { debounceUntilScrollFinishes, isMac, isSafari } from "../../common/lib/utilities";
import {
	closestElement,
	isElement
} from "./lib/nodes";
import { debounce } from "../../common/lib/debounce";
import {
	getBoundingRect,
	isPageRectVisible,
	rectContains
} from "./lib/rect";
import { History } from "../../common/lib/history";

abstract class DOMView<State extends DOMViewState, Data> {
	readonly MIN_SCALE = 0.6;

	readonly MAX_SCALE = 1.8;

	initializedPromise: Promise<void>;

	protected readonly _container: Element;

	protected readonly _iframe: HTMLIFrameElement;

	protected _iframeWindow!: Window & typeof globalThis;

	protected _iframeDocument!: Document;

	protected _tool!: Tool;

	protected _selectedAnnotationIDs: string[];

	protected _annotations: WADMAnnotation[] = [];

	protected _annotationsByID: Map<string, WADMAnnotation> = new Map();

	protected _showAnnotations: boolean;

	protected _displayedAnnotationCache: WeakMap<WADMAnnotation, DisplayedAnnotation> = new WeakMap();

	protected _boundingPageRectCache: WeakMap<Range, DOMRectReadOnly> = new WeakMap();

	protected _annotationShadowRoot!: ShadowRoot;

	protected _annotationRenderRootEl!: HTMLElement;

	protected _annotationRenderRoot!: Root;

	protected _useDarkMode: boolean;

	protected _colorScheme: string | null;

	protected _annotationPopup: AnnotationPopupParams<WADMAnnotation> | null;

	protected _selectionPopup: SelectionPopupParams<WADMAnnotation> | null;

	protected _overlayPopup: OverlayPopupParams | null;

	protected _findState: FindState | null;

	protected abstract _find: FindProcessor | null;

	protected readonly _options: DOMViewOptions<State, Data>;

	protected _overlayPopupDelayer: PopupDelayer;

	protected readonly _history: History;

	protected _suspendHistorySaving = false;

	protected _highlightedPosition: Selector | null = null;

	protected _pointerMovedWhileDown = false;

	protected _gotPointerUp = false;

	protected _handledPointerIDs = new Set<number>();

	protected _lastScrollTime: number | null = null;

	protected _isCtrlKeyDown = false;

	protected _lastSelectionRange: PersistentRange | null = null;

	protected _iframeCoordScaleFactor = 1;

	protected _previewAnnotation: NewAnnotation<WADMAnnotation> | null = null;

	protected _touchAnnotationStartPosition: CaretPosition | null = null;

	protected _draggingNoteAnnotation: WADMAnnotation | null = null;

	protected _resizingAnnotationID: string | null = null;

	protected _outline!: OutlineItem[];

	scale = 1;

	protected constructor(options: DOMViewOptions<State, Data>) {
		this._options = options;
		this._container = options.container;

		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		// Don't show annotations if this is false
		this._showAnnotations = options.showAnnotations;
		this._useDarkMode = options.useDarkMode;
		this._colorScheme = options.colorScheme;
		this._annotationPopup = options.annotationPopup;
		this._selectionPopup = options.selectionPopup;
		this._overlayPopup = options.overlayPopup;
		this._findState = options.findState;
		this._overlayPopupDelayer = new PopupDelayer({ open: !!this._overlayPopup });
		this._history = new History({
			onUpdate: () => this._updateViewStats(),
			onNavigate: location => this.navigate(location, { skipHistory: true, behavior: 'auto' }),
		});

		this._iframe = document.createElement('iframe');
		this._iframe.sandbox.add('allow-same-origin', 'allow-modals');
		// A WebKit bug prevents listeners added by the parent page (us) from running inside a child frame (this._iframe)
		// unless the allow-scripts permission is added to the frame's sandbox. We prevent scripts in the frame from
		// running via the CSP.
		// https://bugs.webkit.org/show_bug.cgi?id=218086

		// TEMP: Add allow-scripts on all browsers until we can reliably detect Safari on all platforms
		// if (isSafari) {
		if (options.platform !== 'zotero') {
			this._iframe.sandbox.add('allow-scripts');
		}
		// }

		// Set the CSP directly on the iframe; we also add it as a <meta> tag in the srcdoc for browsers that don't
		// support the csp attribute (currently all browsers besides Chrome derivatives)
		this._iframe.setAttribute('csp', this._getCSP());
		this.initializedPromise = this._initialize();
		options.container.append(this._iframe);
	}

	protected async _initialize(): Promise<void> {
		this._iframe.srcdoc = await this._getSrcDoc();
		return new Promise<void>((resolve, reject) => {
			this._iframe.addEventListener('load', () => {
				this._handleIFrameLoad()
					.then(() => this._iframe.classList.add('loaded'))
					.then(resolve, reject);
			}, { once: true });
		});
	}

	protected _getCSP(): string {
		let url = this._options.data.url ? new URL(this._options.data.url) : null;
		// When url is http[s], use the origin
		// In the client, though, url will be a zotero: URI and its origin will be the string "null"
		// for some reason. In that case, just allow the entire protocol. (In practice zotero:// URIs are always
		// allowed because the protocol is marked as URI_IS_LOCAL_RESOURCE, which exempts it from CSP, but we want
		// to be safe here.)
		// https://bugzilla.mozilla.org/show_bug.cgi?id=1551253
		let origin = url && (url.protocol.startsWith('http') ? url.origin : url.protocol);

		// Allow resources from the same origin as the URL
		let defaultSrc = origin || "'none'";
		// Allow images from data: and blob: URIs and from that origin
		let imgSrc = (origin || '') + ' data: blob:';
		// Allow styles from data: URIs, inline, and from that origin
		let styleSrc = (origin || '') + " data: 'unsafe-inline'";
		// Allow fonts from data: and blob: URIs and from that origin
		let fontSrc = (origin || '') + ' data: blob:';
		// Don't allow any scripts
		let scriptSrc = "'unsafe-eval'";
		// Don't allow any child frames
		let childSrc = "'none'";
		// Don't allow form submissions
		let formAction = "'none'";
		return `default-src ${defaultSrc}; img-src ${imgSrc}; style-src ${styleSrc}; font-src ${fontSrc}; `
			+ `script-src ${scriptSrc}; child-src ${childSrc}; form-action ${formAction}`;
	}

	protected abstract _getSrcDoc(): MaybePromise<string>;

	abstract getData(): Data;

	protected abstract _onInitialDisplay(viewState: Partial<Readonly<State>>): MaybePromise<void>;

	// ***
	// Utilities for annotations - abstractions over the specific types of selectors used by the two views
	// ***

	abstract toSelector(range: Range): Selector | null;

	abstract toDisplayedRange(selector: Selector): Range | null;

	protected abstract _navigateToSelector(selector: Selector, options?: NavigateOptions): void;

	// ***
	// Abstractions over document structure
	// ***

	protected abstract _getHistoryLocation(): NavLocation | null;

	protected abstract _getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null;

	protected abstract _updateViewState(): void;

	protected abstract _updateViewStats(): void;

	// ***
	// Utilities - called in appropriate event handlers
	// ***

	protected async _pushHistoryPoint(transient = false) {
		if (!transient) {
			this._suspendHistorySaving = true;
			await debounceUntilScrollFinishes(this._iframeDocument, 100);
			this._suspendHistorySaving = false;
		}

		let loc = this._getHistoryLocation();
		if (!loc) return;
		this._history.save(loc, transient);
	}

	protected _isExternalLink(link: HTMLAnchorElement): boolean {
		let href = link.getAttribute('href');
		if (!href) {
			return false;
		}
		return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('tel:');
	}

	protected _getViewportBoundingRect(range: Range): DOMRect {
		let rect = range.getBoundingClientRect();
		return new DOMRect(
			rect.x + this._iframe.getBoundingClientRect().x - this._container.getBoundingClientRect().x,
			rect.y + this._iframe.getBoundingClientRect().y - this._container.getBoundingClientRect().y,
			rect.width,
			rect.height
		);
	}

	protected _getBoundingPageRectCached(range: Range): DOMRectReadOnly {
		if (this._boundingPageRectCache.has(range)) {
			return this._boundingPageRectCache.get(range)!;
		}

		let rect = getBoundingPageRect(range);
		this._boundingPageRectCache.set(range, rect);
		return rect;
	}

	protected _scaleDOMRect(rect: DOMRect): DOMRect {
		return new DOMRect(
			rect.x * this._iframeCoordScaleFactor,
			rect.y * this._iframeCoordScaleFactor,
			rect.width * this._iframeCoordScaleFactor,
			rect.height * this._iframeCoordScaleFactor
		);
	}

	protected _getAnnotationFromTextSelection(type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		let selection = this._iframeDocument.getSelection();
		if (!selection || selection.isCollapsed) {
			return null;
		}
		let range = makeRangeSpanning(...getSelectionRanges(selection));
		return this._getAnnotationFromRange(range, type, color);
	}

	protected _tryUseTool() {
		this._updateViewStats();

		if (this._tool.type == 'pointer') {
			if (this._gotPointerUp) {
				let selection = this._iframeWindow.getSelection();
				if (selection && !selection.isCollapsed) {
					this._openSelectionPopup(selection);
				}
			}
			return;
		}

		if (this._tool.type == 'highlight' || this._tool.type == 'underline') {
			if (this._gotPointerUp) {
				let annotation = this._touchAnnotationStartPosition
					? this._previewAnnotation
					: this._getAnnotationFromTextSelection(this._tool.type, this._tool.color);
				if (annotation && annotation.text) {
					this._options.onAddAnnotation(annotation);
				}
				this._iframeWindow.getSelection()?.removeAllRanges();
				this._previewAnnotation = null;
			}
			else {
				this._previewAnnotation = this._getAnnotationFromTextSelection(this._tool.type, this._tool.color);
			}
			this._renderAnnotations();
		}
	}

	protected _tryUseToolDebounced = debounce(this._tryUseTool.bind(this), 500);

	protected _handleViewUpdate() {
		this._updateViewState();
		this._updateViewStats();
		this._displayedAnnotationCache = new WeakMap();
		this._boundingPageRectCache = new WeakMap();
		this._renderAnnotations(true);
		this._repositionPopups();
	}

	protected _repositionPopups() {
		// Update annotation popup position
		if (this._annotationPopup) {
			let { annotation } = this._annotationPopup;
			if (annotation) {
				// Note: There is currently a bug in React components part therefore the popup doesn't
				// properly update its position when window is resized
				this._openAnnotationPopup(annotation as WADMAnnotation);
			}
		}

		// Update selection popup position
		if (this._selectionPopup) {
			let selection = this._iframeWindow.getSelection();
			if (selection) {
				this._openSelectionPopup(selection);
			}
		}

		// Close overlay popup
		this._options.onSetOverlayPopup();
	}

	protected _renderAnnotations(synchronous = false) {
		if (!this._annotationRenderRootEl) {
			return;
		}
		if (!this._showAnnotations) {
			this._annotationRenderRootEl.replaceChildren();
			return;
		}
		let displayedAnnotations: DisplayedAnnotation[] = this._annotations.map((annotation) => {
			if (this._displayedAnnotationCache.has(annotation)) {
				return this._displayedAnnotationCache.get(annotation)!;
			}

			let range = this.toDisplayedRange(annotation.position);
			if (!range) return null;
			let displayedAnnotation = {
				id: annotation.id,
				type: annotation.type,
				color: annotation.color,
				sortIndex: annotation.sortIndex,
				text: annotation.text,
				comment: annotation.comment,
				readOnly: annotation.readOnly,
				key: annotation.id,
				range,
			};
			this._displayedAnnotationCache.set(annotation, displayedAnnotation);
			return displayedAnnotation;
		}).filter(a => !!a) as DisplayedAnnotation[];
		let findAnnotations = this._find?.getAnnotations();
		if (findAnnotations) {
			displayedAnnotations.push(...findAnnotations.map(a => ({
				...a,
				range: a.range.toRange(),
			})));
		}
		if (this._highlightedPosition) {
			let range = this.toDisplayedRange(this._highlightedPosition);
			if (range) {
				displayedAnnotations.push({
					type: 'highlight',
					color: SELECTION_COLOR,
					key: '_highlightedPosition',
					range,
				});
			}
		}
		if (this._previewAnnotation) {
			let range = this.toDisplayedRange(this._previewAnnotation.position);
			if (range) {
				displayedAnnotations.push({
					sourceID: this._draggingNoteAnnotation?.id,
					type: this._previewAnnotation.type,
					color: this._previewAnnotation.color,
					sortIndex: this._previewAnnotation.sortIndex,
					text: this._previewAnnotation.text,
					comment: this._previewAnnotation.comment,
					key: '_previewAnnotation',
					range,
				});
			}
		}

		displayedAnnotations = displayedAnnotations.filter(
			a => a.id === this._resizingAnnotationID
				|| isPageRectVisible(this._getBoundingPageRectCached(a.range), this._iframeWindow)
		);

		let doRender = () => this._annotationRenderRoot.render(
			<AnnotationOverlay
				iframe={this._iframe}
				annotations={displayedAnnotations}
				selectedAnnotationIDs={this._selectedAnnotationIDs}
				onPointerDown={this._handleAnnotationPointerDown}
				onPointerUp={this._handleAnnotationPointerUp}
				onContextMenu={this._handleAnnotationContextMenu}
				onDragStart={this._handleAnnotationDragStart}
				onResizeStart={this._handleAnnotationResizeStart}
				onResizeEnd={this._handleAnnotationResizeEnd}
			/>
		);
		if (synchronous) {
			// We have to flushSync() when we're rendering due to a page change,
			// or another DOM change external to React. Without it, React will
			// take its sweet time rendering the annotations, and they'll show
			// in the wrong position relative to the text until it's done.
			flushSync(doRender);
		}
		else {
			doRender();
		}
	}

	protected _openSelectionPopup(selection: Selection) {
		if (selection.isCollapsed) {
			return;
		}
		let range = moveRangeEndsIntoTextNodes(makeRangeSpanning(...getSelectionRanges(selection)));
		let domRect = this._scaleDOMRect(this._getViewportBoundingRect(range));
		let rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		let annotation = this._getAnnotationFromRange(range, 'highlight');
		if (annotation) {
			this._options.onSetSelectionPopup({ rect, annotation });
		}
		else {
			this._options.onSetSelectionPopup(null);
		}
	}

	protected _openAnnotationPopup(annotation?: WADMAnnotation) {
		if (!annotation) {
			if (this._selectedAnnotationIDs.length != 1) {
				console.log('No selected annotation to open popup for');
				return;
			}
			annotation = this._annotationsByID.get(this._selectedAnnotationIDs[0]);
			if (!annotation) {
				// Shouldn't happen
				console.log('Selected annotation not found');
				return;
			}
		}

		// Note: Popup won't be visible if sidebar is opened
		let domRect;
		if (annotation.type == 'note') {
			domRect = this._annotationRenderRootEl.querySelector(`[data-annotation-id="${annotation.id}"]`)
				?.getBoundingClientRect();
		}
		if (!domRect) {
			let range = this.toDisplayedRange(annotation.position);
			if (!range) {
				return;
			}
			domRect = this._getViewportBoundingRect(range);
		}
		domRect = this._scaleDOMRect(domRect);
		let rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		this._options.onSetAnnotationPopup({ rect, annotation });
	}

	/**
	 * For use in the console during development.
	 */
	protected _normalizeAnnotations() {
		this._options.onUpdateAnnotations(this._annotations.map((annotation) => {
			let range = this.toDisplayedRange(annotation.position);
			if (!range) {
				console.warn('Could not create range for annotation', annotation);
				return annotation;
			}
			range = moveRangeEndsIntoTextNodes(range);
			let newAnnotation = this._getAnnotationFromRange(range, annotation.type, annotation.color);
			if (!newAnnotation) {
				console.warn('Could not create annotation from normalized range', annotation);
				return annotation;
			}
			return {
				...annotation,
				...newAnnotation,
			};
		}));
	}

	// ***
	// Event handlers
	// ***

	protected async _handleIFrameLoad() {
		this._iframeWindow = this._iframe.contentWindow as Window & typeof globalThis;
		this._iframeDocument = this._iframe.contentDocument!;

		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('keyup', this._handleKeyUp.bind(this));
		this._iframeWindow.addEventListener('click', this._handleClick.bind(this));
		this._iframeDocument.body.addEventListener('pointerover', this._handlePointerOver.bind(this));
		this._iframeDocument.body.addEventListener('pointerdown', this._handlePointerDown.bind(this), true);
		this._iframeDocument.body.addEventListener('pointerup', this._handlePointerUp.bind(this));
		this._iframeDocument.body.addEventListener('pointermove', this._handlePointerMove.bind(this), { passive: true });
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		this._iframeWindow.addEventListener('dragenter', this._handleDragEnter.bind(this));
		this._iframeWindow.addEventListener('dragover', this._handleDragOver.bind(this));
		this._iframeWindow.addEventListener('dragend', this._handleDragEnd.bind(this));
		this._iframeWindow.addEventListener('drop', this._handleDrop.bind(this));
		// @ts-ignore
		this._iframeWindow.addEventListener('copy', this._handleCopy.bind(this));
		this._iframeWindow.addEventListener('resize', this._handleResize.bind(this));
		this._iframeWindow.addEventListener('focus', this._handleFocus.bind(this));
		this._iframeDocument.addEventListener('scroll', this._handleScroll.bind(this), { passive: true });
		this._iframeDocument.addEventListener('scroll', this._handleScrollCapture.bind(this), { passive: true, capture: true });
		this._iframeDocument.addEventListener('wheel', this._handleWheelCapture.bind(this), { passive: false, capture: true });
		this._iframeDocument.addEventListener('selectionchange', this._handleSelectionChange.bind(this));

		let injectStyle = this._iframeDocument.createElement('style');
		injectStyle.innerHTML = injectCSS;
		this._iframeDocument.head.append(injectStyle);

		let annotationOverlay = this._iframeDocument.createElement('div');
		annotationOverlay.id = 'annotation-overlay';
		this._annotationShadowRoot = annotationOverlay.attachShadow({ mode: 'open' });
		this._iframeDocument.body.append(annotationOverlay);

		this._annotationRenderRootEl = this._iframeDocument.createElement('div');
		this._annotationRenderRootEl.id = 'annotation-render-root';
		this._annotationShadowRoot.append(this._annotationRenderRootEl);
		this._annotationRenderRoot = createRoot(this._annotationRenderRootEl);

		let annotationsStyle = this._iframeDocument.createElement('style');
		annotationsStyle.innerHTML = annotationsCSS;
		this._annotationShadowRoot.append(annotationsStyle);

		this._iframeDocument.documentElement.classList.toggle('is-safari', isSafari);

		// Pass options to setters that were delayed until iframe initialization
		this.setAnnotations(this._options.annotations);
		this.setTool(this._options.tool);
		this.setUseDarkMode(this._options.useDarkMode);
		this.setColorScheme(this._options.colorScheme);

		await this._onInitialDisplay(this._options.viewState || {});
		setTimeout(() => {
			this._handleViewUpdate();
		});
	}

	protected _handlePointerOver(event: PointerEvent) {
		const link = (event.target as Element).closest('a');
		if (link) {
			if (this._isExternalLink(link)) {
				link.title = link.href;
			}
			else {
				this._handlePointerOverInternalLink(link);
			}
		}

		if (this._tool.type == 'note') {
			let range = this._getNoteTargetRange(event);
			if (range) {
				this._previewAnnotation = this._getAnnotationFromRange(range, 'note', this._tool.color);
				this._renderAnnotations();
			}
		}
	}

	protected _handlePointerOverInternalLink(link: HTMLAnchorElement) {
		// Do nothing by default
	}

	protected _handleDragEnter(event: DragEvent) {
		if (!this._draggingNoteAnnotation) {
			return;
		}
		event.preventDefault();
		let range = this._getNoteTargetRange(event);
		if (range) {
			this._previewAnnotation = this._getAnnotationFromRange(range, 'note', this._draggingNoteAnnotation.color);
			this._renderAnnotations();
		}
	}

	protected _handleDragOver(event: DragEvent) {
		if (!this._draggingNoteAnnotation || !this._previewAnnotation) {
			return;
		}
		event.preventDefault();
	}

	protected _handleDrop() {
		if (!this._draggingNoteAnnotation || !this._previewAnnotation) {
			return;
		}
		this._draggingNoteAnnotation.position = this._previewAnnotation.position;
		this._draggingNoteAnnotation.pageLabel = this._previewAnnotation.pageLabel;
		this._draggingNoteAnnotation.sortIndex = this._previewAnnotation.sortIndex;
		this._draggingNoteAnnotation.text = this._previewAnnotation.text;
		this._previewAnnotation = null;
		this._options.onUpdateAnnotations([this._draggingNoteAnnotation]);
	}

	protected _getNoteTargetRange(event: PointerEvent | DragEvent): Range | null {
		// Use composedPath()[0] to get the actual target, even if it's within a shadow tree
		let target = event.composedPath()[0] as Element;
		// Disable pointer events and rerender so we can get the cursor position in the text layer,
		// not the annotation layer, even if the mouse is over the annotation layer
		let range = this._iframeDocument.createRange();
		if (target.tagName === 'IMG') { // Allow targeting images directly
			range.selectNode(target);
		}
		else if (target.closest('[data-annotation-id]')) {
			let annotation = this._annotationsByID.get(
				target.closest('[data-annotation-id]')!.getAttribute('data-annotation-id')!
			)!;
			let annotationRange = this.toDisplayedRange(annotation.position)!;
			range.setStart(annotationRange.startContainer, annotationRange.startOffset);
			range.setEnd(annotationRange.endContainer, annotationRange.endOffset);
		}
		else {
			let pos = supportsCaretPositionFromPoint()
				&& caretPositionFromPoint(this._iframeDocument, event.clientX, event.clientY);
			let node = pos ? pos.offsetNode : target;
			// Expand to the closest block element
			while (node.parentNode
			&& (!isElement(node) || this._iframeWindow.getComputedStyle(node).display.includes('inline'))) {
				node = node.parentNode;
			}
			range.selectNode(node);
		}
		let rect = range.getBoundingClientRect();
		if (rect.right <= 0 || rect.left >= this._iframeWindow.innerWidth
				|| rect.bottom <= 0 || rect.top >= this._iframeWindow.innerHeight) {
			return null;
		}
		return range;
	}

	protected _handleClick(event: MouseEvent) {
		let link = (event.target as Element).closest('a');
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
		let { key } = event;
		let shift = event.shiftKey;

		// To figure out if wheel events are pinch-to-zoom
		this._isCtrlKeyDown = event.key === 'Control';

		// Focusable elements in PDF view are annotations and overlays (links, citations, figures).
		// Once TAB is pressed, arrows can be used to navigate between them
		let focusableElements: HTMLElement[] = [];
		let focusedElementIndex = -1;
		let focusedElement: HTMLElement | null = this._iframeDocument.activeElement as HTMLElement | null;
		if (focusedElement?.getAttribute('tabindex') != '-1') {
			focusedElement = null;
		}
		for (let element of this._iframeDocument.querySelectorAll('[tabindex="-1"]')) {
			focusableElements.push(element as HTMLElement);
			if (element === focusedElement) {
				focusedElementIndex = focusableElements.length - 1;
			}
		}

		if (key === 'Escape' && !this._resizingAnnotationID) {
			if (this._selectedAnnotationIDs.length) {
				this._options.onSelectAnnotations([], event);
			}
			else if (focusedElement) {
				focusedElement.blur();
			}
			this._iframeWindow.getSelection()?.removeAllRanges();
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
					let annotationID = focusedElement.getAttribute('data-annotation-id')!;
					let annotation = this._annotationsByID.get(annotationID);
					if (annotation) {
						this._options.onSelectAnnotations([annotationID], event);
						if (this._selectedAnnotationIDs.length == 1) {
							this._openAnnotationPopup(annotation);
						}
						return;
					}
				}
			}
		}

		// Pass keydown even to the main window where common keyboard
		// shortcuts are handled i.e. Delete, Cmd-Minus, Cmd-f, etc.
		this._options.onKeyDown(event);
	}

	protected _handleKeyUp(event: KeyboardEvent) {
		if (event.key === 'Control') {
			this._isCtrlKeyDown = false;
		}

		this._options.onKeyUp(event);
	}

	private _handleDragStart(event: DragEvent) {
		this._previewAnnotation = null;
		if (!event.dataTransfer) {
			return;
		}
		let annotation = this._getAnnotationFromTextSelection('highlight');
		if (!annotation) {
			return;
		}
		console.log('Dragging text', annotation);
		this._options.onSetDataTransferAnnotations(event.dataTransfer, annotation, true);
	}

	private _handleDragEnd(_event: DragEvent) {
		this._draggingNoteAnnotation = null;
		this._previewAnnotation = null;
		this._renderAnnotations();
	}

	private _handleContextMenu(event: MouseEvent) {
		if (this._options.platform === 'web') {
			return;
		}
		// Prevent native context menu
		event.preventDefault();
		let br = this._iframe.getBoundingClientRect();
		let overlay;
		let a = (event.target as Element).closest('a');
		if (a && this._isExternalLink(a)) {
			overlay = {
				type: 'external-link' as const,
				url: a.href,
			};
		}
		this._options.onOpenViewContextMenu({
			x: br.x + event.clientX * this._iframeCoordScaleFactor,
			y: br.y + event.clientY * this._iframeCoordScaleFactor,
			overlay,
		});
	}

	private _handleAnnotationContextMenu = (id: string, event: React.MouseEvent) => {
		if (this._selectionContainsPoint(event.clientX, event.clientY)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		let br = this._iframe.getBoundingClientRect();
		if (this._selectedAnnotationIDs.includes(id)) {
			this._options.onOpenAnnotationContextMenu({
				ids: this._selectedAnnotationIDs,
				x: br.x + event.clientX * this._iframeCoordScaleFactor,
				y: br.y + event.clientY * this._iframeCoordScaleFactor,
				view: true,
			});
		}
		else {
			this._options.onSelectAnnotations([id], event.nativeEvent);
			this._options.onOpenAnnotationContextMenu({
				ids: [id],
				x: br.x + event.clientX * this._iframeCoordScaleFactor,
				y: br.y + event.clientY * this._iframeCoordScaleFactor,
				view: true,
			});
		}
	};

	private _handleSelectionChange() {
		let selection = this._iframeDocument.getSelection();
		if (!selection || selection.isCollapsed) {
			this._options.onSetSelectionPopup(null);
		}
		else {
			this._updateViewStats();
			this._tryUseTool();
		}

		// Regardless of whether the selection is collapsed, save it for Find
		if (selection?.rangeCount) {
			this._lastSelectionRange = new PersistentRange(selection.getRangeAt(0));
		}
	}

	private _handleAnnotationPointerDown = (id: string, event: React.PointerEvent) => {
		// pointerdown handles:
		//  - Selecting annotations when cycling isn't possible (no overlap between pointer and selected annotations)
		//  - Opening the annotation context menu

		if (event.button == 0) {
			if (this._selectedAnnotationIDs.length) {
				let idsHere = this._getAnnotationsAtPoint(event.clientX, event.clientY);
				// Annotation cycling happens on pointerup, so only set selected annotations now if the clicked position
				// doesn't overlap with any of the currently selected annotations
				if (!idsHere.length || this._selectedAnnotationIDs.some(id => idsHere.includes(id))) {
					return;
				}
				this._options.onSelectAnnotations([idsHere[0]], event.nativeEvent);
				// In view mode (mobile), we assume that there's no special processing inside
				// onSelectAnnotations() for e.g. the Shift key that might result in multiple annotations
				// being selected, annotations being deselected, and so on. On desktop, there might be,
				// but we can also count on onSelectAnnotations() being handled synchronously.
				// Revisit if either assumption no longer holds true.
				if (this._options.mobile || this._selectedAnnotationIDs.length == 1) {
					this._openAnnotationPopup(this._annotationsByID.get(idsHere[0])!);
				}
			}
			else {
				// If there's a selection and the pointer is inside it, abort
				if (this._selectionContainsPoint(event.clientX, event.clientY)) {
					return;
				}

				this._options.onSelectAnnotations([id], event.nativeEvent);
				// See above
				if (this._options.mobile || this._selectedAnnotationIDs.length == 1) {
					this._openAnnotationPopup(this._annotationsByID.get(id)!);
				}
			}
		}
		this._handledPointerIDs.add(event.pointerId);
	};

	private _handleAnnotationPointerUp = (id: string, event: React.PointerEvent) => {
		// If pointerdown already performed an action due to this pointer, don't do anything
		if (this._handledPointerIDs.has(event.pointerId)) {
			this._handledPointerIDs.delete(event.pointerId);
			return;
		}

		if (event.button != 0 || !this._selectedAnnotationIDs.length) {
			return;
		}
		// Cycle selection on left click if clicked annotation is already selected
		let idsHere = this._getAnnotationsAtPoint(event.clientX, event.clientY);
		let selectedID = this._selectedAnnotationIDs.find(id => idsHere.includes(id));
		if (!selectedID) {
			return;
		}
		let nextID = idsHere[(idsHere.indexOf(selectedID) + 1) % idsHere.length];
		this._options.onSelectAnnotations([nextID], event.nativeEvent);
		if (this._selectedAnnotationIDs.length == 1) {
			this._openAnnotationPopup(this._annotationsByID.get(nextID)!);
		}
	};

	private _getAnnotationsAtPoint(clientX: number, clientY: number): string[] {
		return this._annotationShadowRoot.elementsFromPoint(clientX, clientY)
			.map(target => target.getAttribute('data-annotation-id'))
			.filter(Boolean)
			.sort() as string[];
	}

	private _handleAnnotationDragStart = (id: string, dataTransfer: DataTransfer) => {
		let sel = this._iframeWindow.getSelection();
		// If there's a selection at this point, that means the pointer was inside the selection in our pointerdown
		// handler, preventing it from being cleared. We should synthesize a drag from the selection instead of the
		// annotation.
		if (sel && !sel.isCollapsed) {
			// Normally the browser does the work of generating the drag image for a text drag. We can't use that
			// here, so instead we'll do something silly with a canvas to make a passable drag image (probably not
			// a great one).

			let text = sel.toString();
			if (text.length > 100) {
				text = text.slice(0, 100) + '…';
			}

			let computedStyle = getComputedStyle(closestElement(sel.anchorNode!)!);
			let fontSize = computedStyle.fontSize;
			let fontFamily = computedStyle.fontFamily;
			let font = fontSize + ' ' + fontFamily;

			let canvas = document.createElement('canvas');
			let ctx = canvas.getContext('2d')!;
			ctx.font = font;
			let metrics = ctx.measureText(text);

			canvas.width = metrics.width;
			canvas.height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
			ctx.font = font;
			ctx.textBaseline = 'top';
			ctx.fillText(text, 0, 0);

			dataTransfer.setDragImage(canvas, 0, 0);
			return;
		}

		let annotation = this._annotationsByID.get(id)!;
		this._options.onSetDataTransferAnnotations(dataTransfer, annotation);
		if (this._selectedAnnotationIDs.length == 1 && annotation.type === 'note' && !annotation.readOnly) {
			this._draggingNoteAnnotation = annotation;
		}
		this._previewAnnotation = null;
		this._renderAnnotations();
	};

	private _handleAnnotationResizeStart = (id: string) => {
		this._resizingAnnotationID = id;
		this._options.onSetAnnotationPopup(null);
		this._iframeDocument.body.classList.add('resizing-annotation');
	};

	private _handleAnnotationResizeEnd = (id: string, range: Range, cancelled: boolean) => {
		this._resizingAnnotationID = null;
		this._iframeDocument.body.classList.remove('resizing-annotation');
		if (cancelled) {
			return;
		}
		let annotation = this._annotationsByID.get(id)!;
		let updatedAnnotation = this._getAnnotationFromRange(range, annotation.type);
		if (!updatedAnnotation) {
			throw new Error('Invalid resized range');
		}
		annotation.position = updatedAnnotation.position;
		annotation.pageLabel = updatedAnnotation.pageLabel;
		annotation.sortIndex = updatedAnnotation.sortIndex;
		annotation.text = updatedAnnotation.text;
		this._options.onUpdateAnnotations([annotation]);

		// If the resize ends over a link, that somehow counts as a click in Fx
		// (even though the mousedown wasn't over the link - weird). Prevent that.
		this._preventNextClickEvent();
	};

	protected _handleCopy(event: ClipboardEvent) {
		if (!event.clipboardData) {
			return;
		}
		if (this._selectedAnnotationIDs.length) {
			// It's enough to provide only one of selected annotations,
			// others will be included automatically by _onSetDataTransferAnnotations
			let annotation = this._annotationsByID.get(this._selectedAnnotationIDs[0]);
			if (!annotation) {
				return;
			}
			console.log('Copying annotation', annotation);
			this._options.onSetDataTransferAnnotations(event.clipboardData, annotation);
		}
		else {
			let annotation = this._getAnnotationFromTextSelection('highlight');
			if (!annotation) {
				return;
			}
			console.log('Copying text', annotation);
			this._options.onSetDataTransferAnnotations(event.clipboardData, annotation, true);
		}
		event.preventDefault();
	}

	protected _handlePointerDown(event: PointerEvent) {
		if (event.button == 0) {
			this._gotPointerUp = false;
			this._pointerMovedWhileDown = false;

			if ((event.pointerType === 'touch' || event.pointerType === 'pen')
					&& (this._tool.type === 'highlight' || this._tool.type === 'underline')) {
				this._touchAnnotationStartPosition = caretPositionFromPoint(this._iframeDocument, event.clientX, event.clientY);
				this._iframeDocument.body.classList.add('creating-touch-annotation');
				event.stopPropagation();
			}
		}

		this._options.onSetOverlayPopup();

		// Create note annotation on pointer down event, if note tool is active.
		// The note tool will be automatically deactivated in reader.js,
		// because this is what we do in PDF reader
		if (event.button == 0 && this._tool.type == 'note' && this._previewAnnotation) {
			this._options.onAddAnnotation(this._previewAnnotation!, true);
			this._renderAnnotations(true);
			this._openAnnotationPopup();
			event.preventDefault();

			// preventDefault() doesn't stop pointerup/click from firing, so our link handler will still fire
			// if the note is added to a link. "Fix" this by eating any click event in the next half second.
			// Very silly.
			this._preventNextClickEvent();

			return;
		}

		if (!(event.target as Element).closest('#annotation-overlay')) {
			// Deselect annotations when clicking outside the annotation layer
			if (this._selectedAnnotationIDs.length) {
				this._options.onSelectAnnotations([], event);
			}
		}
	}

	protected _handlePointerUp(event: PointerEvent) {
		if (event.button !== 0) {
			return;
		}

		this._gotPointerUp = true;
		// If we're using a tool that immediately creates an annotation based on the current selection, we want to use
		// debounced _tryUseTool() in order to wait for double- and triple-clicks to complete. A multi-click is only
		// possible if the pointer hasn't moved while down.
		if (!this._pointerMovedWhileDown && (this._tool.type == 'highlight' || this._tool.type == 'underline')) {
			this._tryUseToolDebounced();
		}
		else {
			this._tryUseTool();
		}
		this._touchAnnotationStartPosition = null;
		this._iframeDocument.body.classList.remove('creating-touch-annotation');
	}

	protected _handlePointerMove(event: PointerEvent) {
		if (event.buttons % 1 == 0) {
			this._pointerMovedWhileDown = true;

			if (this._touchAnnotationStartPosition
					&& (event.pointerType === 'touch' || event.pointerType === 'pen')
					&& (this._tool.type === 'highlight' || this._tool.type === 'underline')) {
				let endPos = caretPositionFromPoint(this._iframeDocument, event.clientX, event.clientY);
				if (endPos) {
					let range = this._iframeDocument.createRange();
					range.setStart(this._touchAnnotationStartPosition.offsetNode, this._touchAnnotationStartPosition.offset);
					range.setEnd(endPos.offsetNode, endPos.offset);
					if (range.collapsed) {
						range.setStart(endPos.offsetNode, endPos.offset);
						range.setEnd(this._touchAnnotationStartPosition.offsetNode, this._touchAnnotationStartPosition.offset);
					}
					let annotation = this._getAnnotationFromRange(range, this._tool.type, this._tool.color);
					if (annotation) {
						this._previewAnnotation = annotation;
						this._renderAnnotations();
					}
				}
				event.stopPropagation();
			}
		}
	}

	protected _handleResize() {
		this._handleViewUpdate();
	}

	protected _handleScroll(event: Event) {
		this._lastScrollTime = event.timeStamp;
		requestAnimationFrame(() => {
			this._renderAnnotations();
			this._repositionPopups();
		});
	}

	protected _handleScrollCapture(event: Event) {
		// The annotation layer is positioned at the top-left of the document, so it moves along with the content when
		// the document is scrolled. But scrollable sub-frames (e.g. elements with overflow: auto) don't have their own
		// annotation layers. When one of them is scrolled, trigger a rerender so annotations get repositioned.
		if (event.target !== this._iframeDocument) {
			this._renderAnnotations(true);
		}
	}

	protected _handleWheelCapture(event: WheelEvent) {
		if (!event.ctrlKey && !(event.metaKey && isMac())) {
			return;
		}

		// Handle pinch-to-zoom and modifier scrolls
		// This routine is a simplified version of PDF.js webViewerWheel()
		// See pdf.js/web/app.js

		event.preventDefault();
		event.stopPropagation();

		// Don't turn a scroll into a zoom when modifier is pressed
		if (this._lastScrollTime !== null && event.timeStamp - this._lastScrollTime < 100) {
			this._lastScrollTime = event.timeStamp;
			return;
		}

		let deltaMode = event.deltaMode;
		let scaleFactor = Math.exp(-event.deltaY / 100);
		let isPinchToZoom = event.ctrlKey
			&& !this._isCtrlKeyDown
			&& deltaMode === WheelEvent.DOM_DELTA_PIXEL
			&& event.deltaX === 0
			&& (Math.abs(scaleFactor - 1) < 0.05 || isMac())
			&& event.deltaZ === 0;

		if (isPinchToZoom) {
			this.zoomBy(scaleFactor - 1);
		}
		else {
			let delta = -event.deltaY;
			if (deltaMode === WheelEvent.DOM_DELTA_LINE
				|| deltaMode === WheelEvent.DOM_DELTA_PAGE) {
				delta *= 0.01;
			}
			else {
				delta *= 0.001;
			}
			this.zoomBy(delta);
		}
	}

	private _handleFocus() {
		this._options.onFocus();
	}

	private _preventNextClickEvent() {
		let clickListener = (event: Event) => {
			event.stopImmediatePropagation();
			event.preventDefault();
		};
		this._iframeDocument.addEventListener('click', clickListener, { once: true, capture: true });
		setTimeout(() => {
			this._iframeDocument.removeEventListener('click', clickListener);
		}, 500);
	}

	private _selectionContainsPoint(x: number, y: number): boolean {
		let selection = this._iframeDocument.getSelection();
		if (!selection) return false;
		let selectionBoundingRect = getBoundingRect(
			getSelectionRanges(selection).map(range => range.getBoundingClientRect())
		);
		return rectContains(selectionBoundingRect, x, y);
	}

	destroy() {
		this._overlayPopupDelayer.destroy();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setTool(tool: Tool) {
		this._tool = tool;

		// When highlighting or underlining, we draw a preview annotation during selection, so set the browser's
		// selection highlight color to transparent. Otherwise, use the default selection color.
		let selectionColor = tool.type == 'highlight' || tool.type == 'underline' ? 'transparent' : SELECTION_COLOR;
		if (selectionColor.startsWith('#')) {
			// 50% opacity, like annotations -- not needed if we're using a system color
			selectionColor += '80';
		}
		this._iframeDocument.documentElement.style.setProperty('--selection-color', selectionColor);

		// When using any tool besides pointer, touches should annotate but pinch-zoom should still be allowed
		this._iframeDocument.documentElement.style.touchAction = tool.type != 'pointer' ? 'none' : 'auto';

		if (this._previewAnnotation && tool.type !== 'note') {
			this._previewAnnotation = null;
		}
		this._renderAnnotations();
	}

	setAnnotations(annotations: WADMAnnotation[]) {
		// Individual annotation object reference changes only if that annotation was modified,
		// so it's possible to do rendering optimizations by skipping other annotations
		this._annotations = annotations;
		this._annotationsByID = new Map(annotations.map(a => [a.id, a]));
		this._renderAnnotations();
		this._repositionPopups();
	}

	setShowAnnotations(show: boolean) {
		this._showAnnotations = show;
		this._renderAnnotations();
	}

	setUseDarkMode(use: boolean) {
		this._useDarkMode = use;
		this._iframeDocument.documentElement.classList.toggle('disable-dark-mode', !use);
		this._annotationRenderRootEl.classList.toggle('disable-dark-mode', !use);
	}

	setColorScheme(colorScheme: string | null) {
		this._colorScheme = colorScheme;
		if (colorScheme) {
			this._iframeDocument.documentElement.dataset.colorScheme = colorScheme;
			this._annotationRenderRootEl.dataset.colorScheme = colorScheme;
		}
		else {
			delete this._iframeDocument.documentElement.dataset.colorScheme;
			delete this._annotationRenderRootEl.dataset.colorScheme;
		}
	}

	setSelectedAnnotationIDs(ids: string[]) {
		this._selectedAnnotationIDs = ids;
		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._options.onSetAnnotationPopup();
		this._renderAnnotations();

		this._iframeWindow.getSelection()?.empty();

		this._updateViewStats();
	}

	get selectedAnnotationIDs() {
		return this._selectedAnnotationIDs.slice();
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

	setOutline(outline: OutlineItem[]) {
		this._outline = outline;
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	focus() {
		this._iframe.focus();
	}

	zoomIn() {
		this.zoomBy(0.1);
	}

	zoomOut() {
		this.zoomBy(-0.1);
	}

	zoomBy(delta: number) {
		let scale = this.scale;
		if (scale === undefined) scale = 1;
		scale += delta;
		scale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, scale));
		this._setScale(scale);
		this._handleViewUpdate();
	}

	zoomReset() {
		this._setScale(1);
		this._handleViewUpdate();
	}

	protected abstract _setScale(scale: number): void;

	navigate(location: NavLocation, options: NavigateOptions = {}) {
		if (location.annotationID) {
			options.block ||= 'center';
			options.ifNeeded ??= true;

			let annotation = this._annotationsByID.get(location.annotationID);
			if (!annotation) {
				return;
			}
			let selector = annotation.position;
			this._navigateToSelector(selector, options);
		}
		else if (location.position) {
			options.block ||= 'center';
			options.ifNeeded ??= true;

			let selector = location.position as Selector;
			this._navigateToSelector(selector, options);
			this._highlightedPosition = selector;
			this._renderAnnotations(true);

			setTimeout(() => {
				if (this._highlightedPosition === selector) {
					this._highlightedPosition = null;
					this._renderAnnotations(true);
				}
			}, 2000);
		}
	}

	navigateBack() {
		this._history.navigateBack();
	}

	navigateForward() {
		this._history.navigateForward();
	}

	abstract print(): Promise<void>;
}

export type DOMViewOptions<State extends DOMViewState, Data> = {
	primary?: boolean;
	mobile?: boolean;
	container: Element;
	tool: Tool;
	platform: Platform;
	selectedAnnotationIDs: string[];
	annotations: WADMAnnotation[];
	showAnnotations: boolean;
	useDarkMode: boolean;
	colorScheme: string | null;
	annotationPopup: AnnotationPopupParams<WADMAnnotation> | null;
	selectionPopup: SelectionPopupParams<WADMAnnotation> | null;
	overlayPopup: OverlayPopupParams | null;
	findState: FindState;
	viewState?: State;
	fontFamily?: string;
	hyphenate?: boolean;
	onSetOutline: (outline: OutlineItem[]) => void;
	onChangeViewState: (state: State, primary?: boolean) => void;
	onChangeViewStats: (stats: ViewStats) => void;
	onSetDataTransferAnnotations: (dataTransfer: DataTransfer, annotation: NewAnnotation<WADMAnnotation> | NewAnnotation<WADMAnnotation>[], fromText?: boolean) => void;
	onAddAnnotation: (annotation: NewAnnotation<WADMAnnotation>, select?: boolean) => void;
	onUpdateAnnotations: (annotations: Annotation[]) => void;
	onOpenLink: (url: string) => void;
	onSelectAnnotations: (ids: string[], triggeringEvent?: KeyboardEvent | MouseEvent) => void;
	onSetSelectionPopup: (params?: SelectionPopupParams<WADMAnnotation> | null) => void;
	onSetAnnotationPopup: (params?: AnnotationPopupParams<WADMAnnotation> | null) => void;
	onSetOverlayPopup: (params?: OverlayPopupParams) => void;
	onSetFindState: (state?: FindState) => void;
	onSetZoom?: (iframe: HTMLIFrameElement, zoom: number) => void;
	onOpenViewContextMenu: (params: { x: number, y: number, overlay?: { type: 'external-link', url: string } }) => void;
	onOpenAnnotationContextMenu: (params: { ids: string[], x: number, y: number, view: boolean }) => void;
	onFocus: () => void;
	onTabOut: (isShiftTab?: boolean) => void;
	onKeyUp: (event: KeyboardEvent) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	onEPUBEncrypted: () => void;
	data: Data & {
		buf?: Uint8Array,
		url?: string
	};
};

export interface DOMViewState {
	scale?: number;
}

export interface CustomScrollIntoViewOptions extends Omit<ScrollIntoViewOptions, 'inline'> {
	block?: 'center' | 'start';
	ifNeeded?: boolean;
	offsetY?: number;
}

export interface NavigateOptions extends CustomScrollIntoViewOptions {
	skipHistory?: boolean;
}

export default DOMView;
