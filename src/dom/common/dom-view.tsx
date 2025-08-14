import injectCSS from './stylesheets/inject.scss';
import annotationsCSS from './stylesheets/annotations.scss';
import {
	Annotation,
	AnnotationPopupParams,
	AnnotationType,
	ArrayRect,
	ColorScheme,
	FindState,
	MaybePromise,
	NavLocation,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	Platform,
	SelectionPopupParams,
	Theme,
	Tool,
	ToolType,
	ViewContextMenuOverlay,
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
	getColumnSeparatedPageRects,
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes,
	PersistentRange,
	supportsCaretPositionFromPoint
} from "./lib/range";
import { getSelectionRanges } from "./lib/selection";
import { FindProcessor } from "./lib/find";
import { SELECTION_COLOR } from "../../common/defines";
import {
	debounceUntilScrollFinishes,
	getCodeCombination, getCurrentColorScheme,
	getKeyCombination, getModeBasedOnColors,
	isMac,
	isSafari,
	placeA11yVirtualCursor
} from "../../common/lib/utilities";
import {
	closestElement,
	getContainingBlock, isBlock
} from "./lib/nodes";
import { debounce } from "../../common/lib/debounce";
import {
	getBoundingRect,
	isPageRectVisible,
	pageRectToClientRect,
	rectContains
} from "./lib/rect";
import { History } from "../../common/lib/history";
import { closestMathTeX } from "./lib/math";
import { DEFAULT_REFLOWABLE_APPEARANCE } from "./defines";

abstract class DOMView<State extends DOMViewState, Data> {
	readonly MIN_SCALE = 0.6;

	readonly MAX_SCALE = 1.8;

	initializedPromise: Promise<void>;

	initialized = false;

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

	protected _lightTheme: Theme | null;

	protected _darkTheme: Theme | null;

	protected _colorScheme: ColorScheme | null;

	protected _theme!: Theme;

	protected _themeColorScheme!: ColorScheme;

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

	protected _lastPinchDistance = 0;

	protected _outline!: OutlineItem[];

	protected _lastKeyboardFocusedAnnotationID: string | null = null;

	protected _a11yVirtualCursorTarget: Node | null;

	protected _a11yShouldFocusVirtualCursorTarget: boolean;

	appearance?: ReflowableAppearance;

	scale = 1;

	protected constructor(options: DOMViewOptions<State, Data>) {
		this._options = options;
		this._container = options.container;

		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		// Don't show annotations if this is false
		this._showAnnotations = options.showAnnotations;
		this._lightTheme = options.lightTheme;
		this._darkTheme = options.darkTheme;
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
		this._a11yVirtualCursorTarget = null;
		this._a11yShouldFocusVirtualCursorTarget = false;

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
		this.initializedPromise.then(() => this.initialized = true);
		options.container.append(this._iframe);
	}

	protected async _initialize(): Promise<void> {
		this._iframe.srcdoc = await this._getSrcDoc();
		return new Promise<void>((resolve, reject) => {
			this._iframe.addEventListener('load', () => {
				this._iframeWindow = this._iframe.contentWindow as Window & typeof globalThis;
				this._iframeDocument = this._iframe.contentDocument!;
				Promise.resolve(this._handleIFrameLoaded())
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
		// Allow fonts from resource: (for TeX fonts), data:, and blob: URIs and from that origin
		let fontSrc = (origin || '') + ' resource: data: blob:';
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

	protected async _handleIFrameLoaded(): Promise<void> {
		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('keyup', this._handleKeyUp.bind(this));
		this._iframeWindow.addEventListener('click', this._handleClick.bind(this));
		this._iframeDocument.addEventListener('pointerover', this._handlePointerOver.bind(this));
		this._iframeDocument.addEventListener('pointerout', this._handlePointerLeave.bind(this));
		this._iframeDocument.addEventListener('pointerdown', this._handlePointerDown.bind(this), true);
		this._iframeDocument.addEventListener('pointerup', this._handlePointerUp.bind(this));
		this._iframeDocument.addEventListener('pointercancel', this._handlePointerUp.bind(this));
		this._iframeDocument.addEventListener('pointermove', this._handlePointerMove.bind(this));
		this._iframeDocument.addEventListener('touchstart', this._handleTouchStart.bind(this));
		this._iframeDocument.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		this._iframeWindow.addEventListener('dragenter', this._handleDragEnter.bind(this));
		this._iframeWindow.addEventListener('dragover', this._handleDragOver.bind(this));
		this._iframeWindow.addEventListener('dragend', this._handleDragEnd.bind(this));
		this._iframeWindow.addEventListener('drop', this._handleDrop.bind(this));
		this._iframeDocument.addEventListener('copy', this._handleCopy.bind(this));
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
		this._annotationShadowRoot.addEventListener("focusin", this._handleAnnotationFocusIn.bind(this));

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

		this._updateColorScheme();
		this._iframeWindow.matchMedia('(prefers-color-scheme: dark)')
			.addEventListener('change', () => this._updateColorScheme());

		await this._handleViewCreated(this._options.viewState || {});
		setTimeout(() => {
			this._handleViewUpdate();
		});
	}

	protected async _handleViewCreated(viewState: Partial<Readonly<State>>): Promise<void> {
		this.setHyphenate(this._options.hyphenate ?? true);

		if (viewState.appearance) {
			this.setAppearance(viewState.appearance);
		}
		else {
			this.setAppearance(DEFAULT_REFLOWABLE_APPEARANCE);
		}
	}

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

	protected _getContainingRoot(node: Node): HTMLElement | null {
		return this._iframeDocument.body.contains(node)
			? this._iframeDocument.body
			: null;
	}

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

	protected _clientRectToViewportRect(rect: DOMRect): DOMRect {
		return this._scaleDOMRect(new DOMRect(
			rect.x + this._iframe.getBoundingClientRect().x - this._container.getBoundingClientRect().x,
			rect.y + this._iframe.getBoundingClientRect().y - this._container.getBoundingClientRect().y,
			rect.width,
			rect.height
		));
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
		let range: Range;
		if (type === 'highlight' || type === 'underline') {
			range = makeRangeSpanning(...getSelectionRanges(selection));
		}
		else if (type === 'note') {
			let element = closestElement(selection.getRangeAt(0).commonAncestorContainer);
			if (!element) {
				return null;
			}
			let blockElement = getContainingBlock(element);
			if (!blockElement) {
				return null;
			}
			range = this._iframeDocument.createRange();
			range.selectNode(blockElement);
		}
		else {
			return null;
		}
		return this._getAnnotationFromRange(range, type, color);
	}

	/**
	 * @returns Whether tool was used
	 */
	protected _tryUseTool() {
		this._updateViewStats();

		if (this._tool.type == 'pointer') {
			if (this._gotPointerUp) {
				let selection = this._iframeWindow.getSelection();
				if (selection && !selection.isCollapsed) {
					this._openSelectionPopup(selection);
					return true;
				}
			}
		}
		else if (this._tool.type == 'highlight' || this._tool.type == 'underline') {
			if (this._gotPointerUp) {
				let annotation = this._touchAnnotationStartPosition
					? this._previewAnnotation
					: this._getAnnotationFromTextSelection(this._tool.type, this._tool.color);
				this._iframeWindow.getSelection()?.removeAllRanges();
				this._previewAnnotation = null;
				this._renderAnnotations();

				if (annotation?.text) {
					this._options.onAddAnnotation(annotation);
					return true;
				}
			}
			else {
				this._previewAnnotation = this._getAnnotationFromTextSelection(this._tool.type, this._tool.color);
				this._renderAnnotations();
			}
		}

		return false;
	}

	protected _tryUseToolDebounced = debounce(this._tryUseTool.bind(this), 500);

	protected _getFocusState() {
		let getFocusedElement = () => {
			let focusedElement = this._iframeDocument.activeElement as HTMLElement | SVGElement | null;
			if (focusedElement === this._annotationShadowRoot.host) {
				focusedElement = this._annotationShadowRoot.activeElement as HTMLElement | SVGElement | null;
				if (!focusedElement?.matches('[tabindex="-1"]')
						|| !this._annotationRenderRootEl.classList.contains('keyboard-focus')) {
					focusedElement = null;
				}
			}
			else if (!focusedElement?.matches('a, area')) {
				focusedElement = null;
			}
			return focusedElement;
		};

		let getFocusedElementIndex = () => {
			return obj.focusedElement ? obj.focusableElements.indexOf(obj.focusedElement) : -1;
		};

		let getFocusableElements = () => {
			let focusableElements = [
				...this._iframeDocument.querySelectorAll('a, area'),
				...this._annotationShadowRoot.querySelectorAll('[tabindex="-1"]')
			] as (HTMLElement | SVGElement)[];
			focusableElements = focusableElements.filter((el) => {
				let style = getComputedStyle(el);
				// Only include visible/focusable elements that are scrolled into view
				return style.visibility === 'visible'
					&& style.display !== 'none'
					&& isPageRectVisible(getBoundingPageRect(el), this._iframeWindow, 0);
			});
			focusableElements.sort((a, b) => {
				let rangeA;
				if (a.getRootNode() === this._annotationShadowRoot && a.hasAttribute('data-annotation-id')) {
					rangeA = this.toDisplayedRange(this._annotationsByID.get(a.getAttribute('data-annotation-id')!)!.position);
				}
				if (!rangeA) {
					rangeA = this._iframeDocument.createRange();
					rangeA.selectNode(a);
				}
				let rangeB;
				if (b.getRootNode() === this._annotationShadowRoot && b.hasAttribute('data-annotation-id')) {
					rangeB = this.toDisplayedRange(this._annotationsByID.get(b.getAttribute('data-annotation-id')!)!.position);
				}
				if (!rangeB) {
					rangeB = this._iframeDocument.createRange();
					rangeB.selectNode(b);
				}
				return rangeA.compareBoundaryPoints(Range.START_TO_START, rangeB);
			});
			return focusableElements;
		};

		let obj = {
			get focusedElement() {
				let value = getFocusedElement();
				Object.defineProperty(this, 'focusedElement', { value });
				return value;
			},

			get focusedElementIndex() {
				let value = getFocusedElementIndex();
				Object.defineProperty(this, 'focusedElementIndex', { value });
				return value;
			},

			get focusableElements() {
				let value = getFocusableElements();
				Object.defineProperty(this, 'focusableElements', { value });
				return value;
			},
		};

		return obj;
	}

	protected _updateAnnotationRange(annotation: WADMAnnotation, range: Range): WADMAnnotation {
		let newAnnotation = this._getAnnotationFromRange(range, annotation.type);
		if (!newAnnotation) {
			throw new Error('Invalid updated range');
		}
		return {
			...annotation,
			position: newAnnotation.position,
			pageLabel: newAnnotation.pageLabel,
			sortIndex: newAnnotation.sortIndex,
			text: newAnnotation.text,
		};
	}

	protected _handleViewUpdate() {
		if (!this.initialized) {
			return;
		}
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
		// Split the selection into its column-separated parts and get the
		// bounding rect encompassing the visible ones. This gives us a more
		// accurate anchor for the popup.
		let columnSeparatedPageRects = getColumnSeparatedPageRects(range);
		// If no column rects were visible, just use the bounding rect. This
		// essentially serves as a placeholder until the selection comes back
		// into view.
		if (!columnSeparatedPageRects.length) {
			columnSeparatedPageRects = [getBoundingPageRect(range)];
		}
		let domRect = this._clientRectToViewportRect(
			pageRectToClientRect(
				getBoundingRect(columnSeparatedPageRects),
				this._iframeWindow
			)
		);
		let annotation = this._getAnnotationFromRange(range, 'highlight');
		if (annotation) {
			let rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
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
			let noteElem = this._annotationRenderRootEl.querySelector(`[data-annotation-id="${annotation.id}"]`);
			if (noteElem) {
				domRect = this._scaleDOMRect(noteElem.getBoundingClientRect());
			}
		}
		if (!domRect) {
			let range = this.toDisplayedRange(annotation.position);
			if (!range) {
				this._options.onSetAnnotationPopup();
				return;
			}
			domRect = this._clientRectToViewportRect(range.getBoundingClientRect());
		}
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

	protected _updateColorScheme() {
		let colorScheme = getCurrentColorScheme(this._colorScheme);
		let theme: Theme;
		if (colorScheme === 'light' && this._lightTheme) {
			theme = this._lightTheme;
		}
		else if (colorScheme === 'dark' && this._darkTheme) {
			theme = this._darkTheme;
		}
		else {
			theme = {
				id: 'light',
				label: '',
				background: '#ffffff',
				foreground: '#121212'
			};
		}
		let themeColorScheme = getModeBasedOnColors(theme.background, theme.foreground);

		let roots = [this._iframeDocument.documentElement, this._annotationRenderRootEl];
		for (let root of roots) {
			root.dataset.colorScheme = themeColorScheme;
			root.style.colorScheme = themeColorScheme;
			root.style.setProperty('--background-color', theme.background);
			root.style.setProperty('--text-color', theme.foreground);
		}

		this._theme = theme;
		this._themeColorScheme = themeColorScheme;
	}

	// ***
	// Event handlers
	// ***

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

	protected _handlePointerLeave(event: PointerEvent) {
		const link = (event.target as Element).closest('a');
		if (link && !this._isExternalLink(link) && event.relatedTarget) {
			this._handlePointerLeftInternalLink();
		}
	}

	protected _handlePointerOverInternalLink(link: HTMLAnchorElement) {
		// Do nothing by default
	}

	protected _handlePointerLeftInternalLink() {
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
		let newAnnotation: WADMAnnotation = {
			...this._draggingNoteAnnotation,
			position: this._previewAnnotation.position,
			pageLabel: this._previewAnnotation.pageLabel,
			sortIndex: this._previewAnnotation.sortIndex,
			text: this._previewAnnotation.text,
		};
		this._previewAnnotation = null;
		this._options.onUpdateAnnotations([newAnnotation]);
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
			let element = closestElement(pos ? pos.offsetNode : target);
			if (!element) return null;
			let blockElement = getContainingBlock(element);
			if (!blockElement) return null;
			range.selectNode(blockElement);
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
		if (event.altKey) {
			return;
		}
		if (this._isExternalLink(link)) {
			this._options.onOpenLink(link.href);
		}
		else {
			this._handleInternalLinkClick(link);
		}
	}

	protected abstract _handleInternalLinkClick(link: HTMLAnchorElement): void;

	protected _handleKeyDown(event: KeyboardEvent) {
		let activeElementBefore = !!this._iframeDocument.activeElement
			&& this._iframeDocument.activeElement !== this._iframeDocument.body;
		this._handleKeyDownInternal(event);
		let activeElementAfter = !!this._iframeDocument.activeElement
			&& this._iframeDocument.activeElement !== this._iframeDocument.body;

		// If focus was gained via keyboard (e.g. Tab), show focus rings
		if (!activeElementBefore && activeElementAfter) {
			this._annotationRenderRootEl.classList.add('keyboard-focus');
		}
		// If focus was lost via keyboard (e.g. Escape), hide focus rings
		else if (activeElementBefore && !activeElementAfter) {
			this._annotationRenderRootEl.classList.remove('keyboard-focus');
		}
	}

	private _handleKeyDownInternal(event: KeyboardEvent) {
		// To figure out if wheel events are pinch-to-zoom
		this._isCtrlKeyDown = event.key === 'Control';

		let key = getKeyCombination(event);
		let code = getCodeCombination(event);

		let f = this._getFocusState();

		if (key === 'Escape' && !this._resizingAnnotationID) {
			if (this._selectedAnnotationIDs.length) {
				this._options.onSelectAnnotations([], event);
				if (this._lastKeyboardFocusedAnnotationID) {
					(this._annotationRenderRootEl.querySelector(
						`[tabindex="-1"][data-annotation-id="${this._lastKeyboardFocusedAnnotationID}"]`
					) as HTMLElement | SVGElement | null)
					?.focus({ preventScroll: true });
				}
			}
			else if (f.focusedElement) {
				f.focusedElement.blur();
			}
			this._iframeWindow.getSelection()?.removeAllRanges();
			// The keyboard shortcut was handled here, therefore no need to
			// pass it to this._onKeyDown(event) below
			return;
		}
		else if (key === 'Shift-Tab') {
			if (f.focusedElement) {
				f.focusedElement.blur();
			}
			else {
				this._options.onTabOut(true);
			}
			event.preventDefault();
			return;
		}
		else if (key === 'Tab') {
			if (!f.focusedElement && this._iframeDocument.getSelection()!.isCollapsed && !this._selectedAnnotationIDs.length) {
				// In PDF view the first visible object (annotation, overlay) is focused
				if (f.focusableElements.length) {
					f.focusableElements[0].focus({ preventScroll: true });
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

		if (f.focusedElement) {
			if (!window.rtl && key === 'ArrowRight' || window.rtl && key === 'ArrowLeft' || key === 'ArrowDown') {
				f.focusableElements[(f.focusedElementIndex + 1) % f.focusableElements.length]
					?.focus({ preventScroll: true });
				event.preventDefault();
				return;
			}
			else if (!window.rtl && key === 'ArrowLeft' || window.rtl && key === 'ArrowRight' || key === 'ArrowUp') {
				f.focusableElements[(f.focusedElementIndex - 1 + f.focusableElements.length) % f.focusableElements.length]
					?.focus({ preventScroll: true });
				event.preventDefault();
				return;
			}
			else if (['Enter', 'Space'].includes(key)) {
				if (f.focusedElement.matches('a, area')) {
					(f.focusedElement as HTMLElement).click();
					event.preventDefault();
					return;
				}
				else if (f.focusedElement.hasAttribute('data-annotation-id')) {
					let annotationID = f.focusedElement.getAttribute('data-annotation-id')!;
					let annotation = this._annotationsByID.get(annotationID);
					if (annotation) {
						this._options.onSelectAnnotations([annotationID], event);
						if (this._selectedAnnotationIDs.length == 1) {
							this._openAnnotationPopup(annotation);
						}
						this._lastKeyboardFocusedAnnotationID = annotationID;
						f.focusedElement.blur();
						event.preventDefault();
						return;
					}
				}
			}
		}
		else if (this._selectedAnnotationIDs.length === 1 && key === 'Enter') {
			this._openAnnotationPopup(this._annotationsByID.get(this._selectedAnnotationIDs[0])!);
		}

		if (this._selectedAnnotationIDs.length === 1 && key.includes('Shift-Arrow')) {
			let annotation = this._annotationsByID.get(this._selectedAnnotationIDs[0])!;
			let oldRange = this.toDisplayedRange(annotation.position);
			if (!oldRange) {
				event.preventDefault();
				return;
			}
			if (annotation.type === 'note') {
				let root = this._getContainingRoot(oldRange.startContainer);
				if (!root) {
					throw new Error('Annotation is outside of root?');
				}
				let walker = this._iframeDocument.createTreeWalker(
					root,
					NodeFilter.SHOW_ELEMENT,
					node => (isBlock(node as Element) && !node.contains(oldRange!.startContainer)
						? NodeFilter.FILTER_ACCEPT
						: NodeFilter.FILTER_SKIP),
				);
				walker.currentNode = oldRange.startContainer;

				let newRange = this._iframeDocument.createRange();
				if (key.endsWith('Arrow' + (window.rtl ? 'Left' : 'Right'))
						|| key.endsWith('ArrowDown')) {
					walker.nextNode();
				}
				else {
					walker.previousNode();
				}
				newRange.selectNode(walker.currentNode);
				try {
					annotation = this._updateAnnotationRange(annotation, newRange);
				}
				catch (e) {
					// Reached the end of the section (EPUB)
					// TODO: Allow movement between sections
					event.preventDefault();
					return;
				}
				this._options.onUpdateAnnotations([annotation]);
				this._navigateToSelector(annotation.position, {
					block: 'center',
					behavior: 'smooth',
					skipHistory: true,
					ifNeeded: true,
				});
			}
			else {
				let resizeStart = key.startsWith('Cmd-') || key.startsWith('Ctrl-');
				let granularity;
				// Up/down set via granularity, not direction
				if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
					granularity = 'line';
				}
				else if (event.altKey) {
					granularity = 'word';
				}
				else {
					granularity = 'character';
				}
				let selection = this._iframeDocument.getSelection()!;

				selection.removeAllRanges();
				selection.addRange(oldRange);
				if (resizeStart) {
					selection.collapseToStart();
				}
				else {
					selection.collapseToEnd();
				}
				selection.modify(
					'move',
					event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 'right' : 'left',
					granularity
				);
				let newRange = selection.getRangeAt(0);
				if (resizeStart) {
					newRange.setEnd(oldRange.endContainer, oldRange.endOffset);
				}
				else {
					newRange.setStart(oldRange.startContainer, oldRange.startOffset);
				}
				selection.removeAllRanges();

				if (!newRange.collapsed) {
					this._options.onUpdateAnnotations([this._updateAnnotationRange(annotation, newRange)]);
				}
			}

			this._options.onSetAnnotationPopup(null);
			event.preventDefault();
			return;
		}

		if (!this._selectedAnnotationIDs.length
				&& (code === 'Ctrl-Alt-Digit1' || code === 'Ctrl-Alt-Digit2' || code === 'Ctrl-Alt-Digit3')) {
			let type: AnnotationType;
			switch (code) {
				case 'Ctrl-Alt-Digit1':
					type = 'highlight';
					break;
				case 'Ctrl-Alt-Digit2':
					type = 'underline';
					break;
				case 'Ctrl-Alt-Digit3':
					type = 'note';
					break;
			}
			let annotation = this._getAnnotationFromTextSelection(type, this._options.tools[type].color);
			if (!annotation && type === 'note') {
				let pos = caretPositionFromPoint(
					this._iframeDocument,
					this._iframeWindow.innerWidth / 2,
					this._iframeWindow.innerHeight / 2
				);
				let elem = pos && closestElement(pos.offsetNode);
				let block = elem && getContainingBlock(elem);
				if (block) {
					let range = this._iframeDocument.createRange();
					range.selectNode(block);
					annotation = this._getAnnotationFromRange(range, type, this._options.tools[type].color);
				}
			}
			if (annotation) {
				this._options.onAddAnnotation(annotation, true);
				this._navigateToSelector(annotation.position, {
					block: 'center',
					behavior: 'smooth',
					skipHistory: true,
					ifNeeded: true,
				});
				this._iframeWindow.getSelection()?.removeAllRanges();
				if (type === 'note') {
					this._renderAnnotations(true);
					this._openAnnotationPopup();
				}
			}
			event.preventDefault();
			return;
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
		let overlay = this._getContextMenuOverlay(event.target as Element);
		this._options.onOpenViewContextMenu({
			x: br.x + event.clientX * this._iframeCoordScaleFactor,
			y: br.y + event.clientY * this._iframeCoordScaleFactor,
			overlay,
		});
	}

	private _getContextMenuOverlay(el: Element): ViewContextMenuOverlay | undefined {
		let a = el.closest('a');
		if (a && this._isExternalLink(a)) {
			return {
				type: 'external-link',
				url: a.href,
			};
		}

		let math = closestMathTeX(el);
		if (math) {
			return {
				type: 'math',
				tex: math,
			};
		}

		return undefined;
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

		// Safari fails to follow user-select: none, so manually collapse
		// the selection if it's on the annotation overlay
		if (selection && isSafari
				&& selection.rangeCount > 0
				&& selection.getRangeAt(0).startContainer.childNodes[selection.getRangeAt(0).startOffset]
					=== this._annotationShadowRoot.host) {
			selection.collapseToStart();
			return;
		}

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
		event.stopPropagation();

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
			this._iframeDocument.body.focus();
			this._lastKeyboardFocusedAnnotationID = null;
		}
		this._handledPointerIDs.add(event.pointerId);
	};

	private _handleAnnotationPointerUp = (id: string, event: React.PointerEvent) => {
		event.stopPropagation();

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
		this._lastKeyboardFocusedAnnotationID = null;
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
		this._options.onUpdateAnnotations([this._updateAnnotationRange(annotation, range)]);

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
		if ((event.buttons & 1) === 1 && event.isPrimary) {
			this._gotPointerUp = false;
			this._pointerMovedWhileDown = false;

			if ((event.pointerType === 'touch' || event.pointerType === 'pen')
					&& (this._tool.type === 'highlight' || this._tool.type === 'underline')
					&& event.target !== this._annotationShadowRoot.host) {
				this._touchAnnotationStartPosition = caretPositionFromPoint(this._iframeDocument, event.clientX, event.clientY);
				this._iframeDocument.body.classList.add('creating-touch-annotation');
				event.stopPropagation();
			}
		}

		this._options.onSetOverlayPopup();

		// If we marked a node as future focus target for screen readers, clear it to not interfere with focus
		this._a11yVirtualCursorTarget = null;

		// Hide focus rings
		this._annotationRenderRootEl.classList.remove('keyboard-focus');

		// Create note annotation on pointer down event, if note tool is active.
		// The note tool will be automatically deactivated in reader.js,
		// because this is what we do in PDF reader
		if ((event.buttons & 1) === 1 && this._tool.type == 'note' && this._previewAnnotation) {
			this._options.onAddAnnotation(this._previewAnnotation!, true);
			this._previewAnnotation = null;
			this._renderAnnotations(true);
			this._openAnnotationPopup();
			event.preventDefault();

			// preventDefault() doesn't stop pointerup/click from firing, so our link handler will still fire
			// if the note is added to a link. "Fix" this by eating any click event in the next half second.
			// Very silly.
			this._preventNextClickEvent();

			return;
		}

		if (event.target !== this._annotationShadowRoot.host) {
			// Deselect annotations when clicking outside the annotation layer
			if (this._selectedAnnotationIDs.length) {
				this._options.onSelectAnnotations([], event);
				this._handledPointerIDs.add(event.pointerId);
			}
		}
	}

	protected _handlePointerUp(event: PointerEvent) {
		this._handledPointerIDs.delete(event.pointerId);

		if (!event.isPrimary || event.defaultPrevented) {
			return;
		}

		this._gotPointerUp = true;
		if (event.type === 'pointercancel') {
			this._previewAnnotation = null;
			this._renderAnnotations();
		}
		// If we're using a tool that immediately creates an annotation based on the current selection, we want to use
		// debounced _tryUseTool() in order to wait for double- and triple-clicks to complete. A multi-click is only
		// possible if the pointer hasn't moved while down.
		else if (!this._pointerMovedWhileDown && (this._tool.type == 'highlight' || this._tool.type == 'underline')) {
			this._tryUseToolDebounced();
		}
		else {
			let wasToolUsed = this._tryUseTool();
			if (!wasToolUsed
					&& !this._pointerMovedWhileDown
					&& !this._handledPointerIDs.has(event.pointerId)
					&& !(event.target as Element).closest('a')) {
				this._options.onBackdropTap?.(event);
			}
		}
		this._touchAnnotationStartPosition = null;
		this._previewAnnotation = null;
		this._renderAnnotations();
		this._iframeDocument.body.classList.remove('creating-touch-annotation');
	}

	protected _handlePointerMove(event: PointerEvent) {
		if ((event.buttons & 1) !== 1 || !event.isPrimary) {
			return;
		}
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

	protected _handleTouchStart(event: TouchEvent) {
		if (event.touches.length === 2) {
			this._lastPinchDistance = Math.hypot(event.touches[0].pageX - event.touches[1].pageX, event.touches[0].pageY - event.touches[1].pageY);
		}
	}

	protected _handleTouchMove(event: TouchEvent) {
		// We need to stop annotation-creating/resizing touches from scrolling
		// the view. Unfortunately:
		// 1. The recommended way to prevent touch scrolling is via the
		//    touch-action CSS property, but a WebKit bug causes changes to
		//    that property not to take effect in child nodes until they're
		//    invalidated in some other way (text is selected, the web inspector
		//    highlights them, ...).
		// 2. A WebKit quirk (I think this is technically spec-compliant) makes
		//    pointermove events non-cancellable, even when the listener is
		//    initialized with { passive: false }.
		// So we do it with a separate touchmove listener.
		if (this._touchAnnotationStartPosition && (this._tool.type === 'highlight' || this._tool.type === 'underline')
				|| this._resizingAnnotationID) {
			event.preventDefault();
		}
		// Handle pinch-to-zoom
		else if (event.touches.length === 2) {
			event.preventDefault();

			let pinchDistance = Math.hypot(event.touches[0].pageX - event.touches[1].pageX, event.touches[0].pageY - event.touches[1].pageY);
			this.zoomBy((pinchDistance / this._lastPinchDistance - 1) / 10);
			this._lastPinchDistance = pinchDistance;
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
		let target = event.target as Node;
		if (target !== this._iframeDocument) {
			for (let annotation of this._annotations) {
				if (this.toDisplayedRange(annotation.position)?.intersectsNode(target)) {
					this._displayedAnnotationCache.delete(annotation);
				}
			}
			requestAnimationFrame(() => {
				this._renderAnnotations(true);
				this._repositionPopups();
			});
		}
	}

	protected _handleWheelCapture(event: WheelEvent) {
		if (!event.ctrlKey && !(event.metaKey && isMac())) {
			this._lastScrollTime = event.timeStamp;
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

		// Help screen readers understand where to place virtual cursor
		placeA11yVirtualCursor(this._a11yVirtualCursorTarget);
	}

	private _handleAnnotationFocusIn(event: Event) {
		let annotationID = (event.target as HTMLElement | SVGElement).dataset.annotationId;
		if (annotationID) {
			this._options.onFocusAnnotation(this._annotationsByID.get(annotationID)!);
		}
	}

	private _preventNextClickEvent() {
		let clickListener = (event: Event) => {
			event.stopImmediatePropagation();
			event.preventDefault();
		};
		this._iframeDocument.addEventListener('click', clickListener, { once: true, capture: true });
		setTimeout(() => {
			this._iframeDocument.removeEventListener('click', clickListener, { capture: true });
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
		this._annotationRenderRoot.unmount();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setTool(tool: Tool) {
		this._tool = tool;

		this._iframeDocument.body.dataset.tool = tool.type;

		// When highlighting or underlining, we draw a preview annotation during selection, so set the browser's
		// selection highlight color to transparent. Otherwise, use the default selection color.
		let selectionColor = tool.type == 'highlight' || tool.type == 'underline' ? 'transparent' : SELECTION_COLOR;
		if (selectionColor.startsWith('#')) {
			// 50% opacity, like annotations -- not needed if we're using a system color
			selectionColor += '80';
		}
		this._iframeDocument.documentElement.style.setProperty('--selection-color', selectionColor);

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

	setLightTheme(theme: Theme | null) {
		this._lightTheme = theme;
		this._updateColorScheme();
	}

	setDarkTheme(theme: Theme | null) {
		this._darkTheme = theme;
		this._updateColorScheme();
	}

	setColorScheme(colorScheme: ColorScheme | null) {
		this._colorScheme = colorScheme;
		this._updateColorScheme();
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

	setAppearance(partialAppearance: Partial<ReflowableAppearance>) {
		let appearance = {
			...DEFAULT_REFLOWABLE_APPEARANCE,
			...partialAppearance
		};
		this.appearance = appearance;
		this._iframeDocument.documentElement.style.setProperty('--content-line-height-adjust', String(appearance.lineHeight));
		this._iframeDocument.documentElement.style.setProperty('--content-word-spacing-adjust', String(appearance.wordSpacing));
		this._iframeDocument.documentElement.style.setProperty('--content-letter-spacing-adjust', String(appearance.letterSpacing));
		this._iframeDocument.documentElement.classList.toggle('use-original-font', appearance.useOriginalFont);

		let pageWidth;
		switch (appearance.pageWidth) {
			case PageWidth.Narrow:
				pageWidth = 'narrow';
				break;
			case PageWidth.Normal:
				pageWidth = 'normal';
				break;
			case PageWidth.Full:
				pageWidth = 'full';
				break;
		}
		this._iframeDocument.documentElement.dataset.pageWidth = pageWidth;
		this._handleViewUpdate();
	}

	setFontFamily(fontFamily: string) {
		this._iframeDocument.documentElement.style.setProperty('--content-font-family', fontFamily);
		this._renderAnnotations(true);
	}

	setHyphenate(hyphenate: boolean) {
		this._iframeDocument.documentElement.classList.toggle('hyphenate', hyphenate);
		this._renderAnnotations(true);
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

	protected _setHighlight(selector: Selector) {
		this._highlightedPosition = selector;
		this._renderAnnotations(true);

		setTimeout(() => {
			if (this._highlightedPosition === selector) {
				this._highlightedPosition = null;
				this._renderAnnotations(true);
			}
		}, 2000);
	}

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
			this._setHighlight(selector);
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
	preview?: boolean;
	readOnly?: boolean;
	container: Element;
	tools: Record<ToolType, Tool>;
	tool: Tool;
	platform: Platform;
	location?: NavLocation;
	selectedAnnotationIDs: string[];
	annotations: WADMAnnotation[];
	showAnnotations: boolean;
	lightTheme: Theme | null;
	darkTheme: Theme | null;
	colorScheme: ColorScheme | null;
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
	onAddAnnotation: (annotation: NewAnnotation<WADMAnnotation>, select?: boolean) => WADMAnnotation;
	onUpdateAnnotations: (annotations: Partial<Annotation>[]) => void;
	onOpenLink: (url: string) => void;
	onSelectAnnotations: (ids: string[], triggeringEvent?: KeyboardEvent | MouseEvent) => void;
	onSetSelectionPopup: (params?: SelectionPopupParams<WADMAnnotation> | null) => void;
	onSetAnnotationPopup: (params?: AnnotationPopupParams<WADMAnnotation> | null) => void;
	onSetOverlayPopup: (params?: OverlayPopupParams) => void;
	onSetFindState: (state?: FindState) => void;
	onSetZoom?: (iframe: HTMLIFrameElement, zoom: number) => void;
	onOpenViewContextMenu: (params: { x: number, y: number, overlay?: ViewContextMenuOverlay }) => void;
	onOpenAnnotationContextMenu: (params: { ids: string[], x: number, y: number, view: boolean }) => void;
	onFocus: () => void;
	onTabOut: (isShiftTab?: boolean) => void;
	onKeyUp: (event: KeyboardEvent) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	onEPUBEncrypted: () => void;
	onFocusAnnotation: (annotation: WADMAnnotation) => void;
	onSetHiddenAnnotations: (ids: string[]) => void;
	onBackdropTap?: (event: PointerEvent) => void;
	getLocalizedString?: (name: string) => string;
	data: Data & {
		buf?: Uint8Array,
		url?: string
	};
};

export interface DOMViewState {
	scale?: number;
	appearance?: Partial<ReflowableAppearance>;
}

export interface CustomScrollIntoViewOptions extends Omit<ScrollIntoViewOptions, 'inline'> {
	block?: 'center' | 'start';
	ifNeeded?: boolean;
	offsetBlock?: number;
}

export interface NavigateOptions extends CustomScrollIntoViewOptions {
	skipHistory?: boolean;
}

export interface ReflowableAppearance {
	lineHeight: number;
	wordSpacing: number;
	letterSpacing: number;
	pageWidth: PageWidth;
	useOriginalFont: boolean;
}

export const enum PageWidth {
	Narrow = -1,
	Normal = 0,
	Full = 1
}

export default DOMView;
