import Page from './page';
import { p2v, v2p } from './lib/coordinates';
import {
	getLineSelectionRanges,
	getModifiedSelectionRanges,
	getRectRotationOnText,
	getReversedSelectionRanges,
	getSelectionRanges,
	getSelectionRangesByPosition,
	getSortIndex,
	getTextFromSelectionRanges,
	getWordSelectionRanges,
	setTextLayerSelection,
	getNodeOffset
} from './selection';
import {
	applyInverseTransform,
	applyTransform, adjustRectHeightByRatio,
	getPageIndexesFromAnnotations,
	getPositionBoundingRect,
	intersectAnnotationWithPoint,
	quickIntersectRect,
	transform,
	getBoundingBox,
	inverseTransform,
	scaleShape,
	getRotationTransform,
	getScaleTransform,
	calculateScale,
	getAxialAlignedBoundingBox,
	distanceBetweenRects,
	getTransformFromRects,
	getRotationDegrees,
	normalizeDegrees,
	getRectsAreaSize,
	getClosestObject,
	getOutlinePath,
} from './lib/utilities';
import {
	debounceUntilScrollFinishes,
	getCodeCombination,
	getKeyCombination,
	getAffectedAnnotations,
	isMac,
	isLinux,
	isWin,
	isFirefox,
	isSafari,
	throttle,
	getModeBasedOnColors,
	placeA11yVirtualCursor
} from '../common/lib/utilities';
import { debounce } from '../common/lib/debounce';
import { AutoScroll } from './lib/auto-scroll';
import { PDFThumbnails } from './pdf-thumbnails';
import {
	MIN_IMAGE_ANNOTATION_SIZE,
	PDF_NOTE_DIMENSIONS,
	A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH
} from '../common/defines';
import PDFRenderer from './pdf-renderer';
import { drawAnnotationsOnCanvas } from './lib/render';
import PopupDelayer from '../common/lib/popup-delayer';
import { adjustTextAnnotationPosition } from './lib/text-annotation';
import {
	applyTransformationMatrixToInkPosition,
	eraseInk,
	smoothPath
} from './lib/path';
import { History } from '../common/lib/history';
import { FindState, PDFFindController } from './pdf-find-controller';

class PDFView {
	constructor(options) {
		this._options = options;
		this._primary = options.primary;
		this._readOnly = options.readOnly;
		this._preview = options.preview;
		this._container = options.container;
		this._password = options.password;
		this._tools = options.tools;
		this._outline = options.outline;
		this._lightTheme = options.lightTheme;
		this._darkTheme = options.darkTheme;
		this._preferedColorTheme = options.colorScheme;
		this._onRequestPassword = options.onRequestPassword;
		this._onSetThumbnails = options.onSetThumbnails;
		this._onSetOutline = options.onSetOutline;
		this._onSetPageLabels = options.onSetPageLabels;
		this._onChangeViewState = options.onChangeViewState;
		this._onChangeViewStats = options.onChangeViewStats;
		this._onSetDataTransferAnnotations = options.onSetDataTransferAnnotations;
		this._onAddAnnotation = options.onAddAnnotation;
		this._onUpdateAnnotations = options.onUpdateAnnotations;
		this._onDeleteAnnotations = options.onDeleteAnnotations;
		this._onOpenLink = options.onOpenLink;
		this._onSelectAnnotations = options.onSelectAnnotations;
		this._onSetSelectionPopup = options.onSetSelectionPopup;
		this._onSetAnnotationPopup = options.onSetAnnotationPopup;
		this._onSetOverlayPopup = options.onSetOverlayPopup;
		this._onSetFindState = options.onSetFindState;
		this._onOpenViewContextMenu = options.onOpenViewContextMenu;
		this._onOpenAnnotationContextMenu = options.onOpenAnnotationContextMenu;
		this._onKeyUp = options.onKeyUp;
		this._onKeyDown = options.onKeyDown;
		this._onFocusAnnotation = options.onFocusAnnotation;

		this._onTabOut = options.onTabOut;

		this._viewState = options.viewState || { pageIndex: 0, scale: "page-width", scrollMode: 0, spreadMode: 0 };
		this._location = options.location;

		this._tool = options.tool;

		this._pageLabels = options.pageLabels;

		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		this._annotations = options.annotations;

		this._pages = [];
		this._pdfPages = {};

		this._focusedObject = null;
		this._lastFocusedObject = null;

		this._lastNavigationTime = 0;

		this._findState = options.findState;

		this._scrolling = false;


		// Create a MediaQueryList object
		let darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		// Initial check
		this._preferedColorTheme = darkModeMediaQuery.matches ? 'dark' : 'light';

		// Listen for changes
		darkModeMediaQuery.addEventListener('change', event => {
			this._preferedColorTheme = event.matches ? 'dark' : 'light';
			this._updateColorScheme();
		});

		this._updateColorScheme();

		this._history = new History({
			onUpdate: () => this._updateViewStats(),
			onNavigate: location => this.navigate(location, { skipHistory: true })
		});

		this._overlayPopupDelayer = new PopupDelayer({ open: !!this._overlayPopup });

		this._selectionRanges = [];

		this._iframe = document.createElement('iframe');
		this._iframe.addEventListener('load', () => this._iframe.classList.add('loaded'));
		this._iframe.src = 'pdf/web/viewer.html';

		this._iframeWindow = null;

		this.initializedPromise = new Promise(resolve => this._resolveInitializedPromise = resolve);
		this._pageLabelsPromise = new Promise(resolve => this._resolvePageLabelsPromise = resolve);

		this._a11yVirtualCursorTarget = null;
		this._a11yShouldFocusVirtualCursorTarget = false;

		let setOptions = () => {
			if (!this._iframeWindow?.PDFViewerApplicationOptions) {
				return;
			}
			this._iframeWindow.PDFViewerApplicationOptions.set('isEvalSupported', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('defaultUrl', '');
			this._iframeWindow.PDFViewerApplicationOptions.set('historyUpdateUrl', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('textLayerMode', this._preview ? 0 : 1);
			this._iframeWindow.PDFViewerApplicationOptions.set('sidebarViewOnLoad', 0);
			this._iframeWindow.PDFViewerApplicationOptions.set('ignoreDestinationZoom', true);
			this._iframeWindow.PDFViewerApplicationOptions.set('renderInteractiveForms', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('printResolution', 300);
			this._iframeWindow.PDFViewerApplicationOptions.set('enableScripting', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('disablePreferences', true);
			this._iframeWindow.PDFViewerApplicationOptions.set('disableHistory', true);
			this._iframeWindow.PDFViewerApplicationOptions.set('enableXfa', false);
		};

		window.addEventListener('webviewerloaded', () => {
			this._iframeWindow = this._iframe.contentWindow;
			setOptions();
		});

		this._iframe.addEventListener('load', () => {
			this._updateColorScheme();
			// This is necessary to make sure this is called after webviewerloaded
			setTimeout(() => {
				// Delete existing local history data
				// TODO: This can be removed in future
				try {
					localStorage.removeItem('pdfjs.history');
				}
				catch (e) {
				}
				try {
					this._iframeWindow.localStorage.removeItem('pdfjs.history');
				}
				catch (e) {
				}
				setOptions();
				this._iframeWindow.onAttachPage = this._attachPage.bind(this);
				this._iframeWindow.onDetachPage = this._detachPage.bind(this);
				if (this._preview) {
					setTimeout(this._resolveInitializedPromise);
				}
				else {
					this._init();
				}
				if (options.data.buf) {
					this._iframeWindow.PDFViewerApplication.open({ data: options.data.buf, password: this._password });
				}
				else {
					this._iframeWindow.PDFViewerApplication.open({ url: options.data.url, password: this._password });
				}
				window.PDFViewerApplication = this._iframeWindow.PDFViewerApplication;
				window.if = this._iframeWindow;

				this._iframeWindow.document.getElementById('viewerContainer').addEventListener('scroll', (event) => {
					this._scrolling = true;
					clearTimeout(this._scrollTimeout);
					this._scrollTimeout = setTimeout(() => {
						this._scrolling = false;
					}, 100);


					let x = event.target.scrollLeft;
					let y = event.target.scrollTop;

					if (this._overlayPopup) {
						this._overlayPopupDelayer.close(() => {
						});
						this._selectedOverlay = null;
						this._onSetOverlayPopup(null);
					}

					// TODO: Consider creating "getSelectionAnnotationPopup"
					if (this._annotationPopup) {
						let annotations = this.getSelectedAnnotations();
						if (annotations.length === 1) {
							let annotation = annotations[0];
							let rect = this.getClientRectForPopup(annotation.position, x, y);
							this._onSetAnnotationPopup({ rect, annotation });
						}
					}

					if (this._selectionPopup) {
						let selectionRange = this._selectionRanges[0];
						if (selectionRange) {
							let rect = this.getClientRectForPopup(selectionRange.position);
							this._onSetSelectionPopup({ ...this._selectionPopup, rect });
						}
					}
				});

				this._iframeWindow.addEventListener('focus', (event) => {
					options.onFocus();
					// Help screen readers understand where to place virtual cursor
					placeA11yVirtualCursor(this._a11yVirtualCursorTarget);
				});
			});
		});

		this._options.container.append(this._iframe);
	}

	async _init() {
		// this._iframeWindow.document.body.draggable = true;

		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keyup', this._onKeyUp);
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('pointerdown', this._handlePointerDown.bind(this), true);
		// mousedown event is necessary to get event.detail, but for touch pointerdown is necessary
		this._iframeWindow.addEventListener('mousedown', this._handlePointerDown.bind(this), true);
		// Touch events are passive by default
		this._iframeWindow.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
		this._iframeWindow.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
		this._iframeWindow.addEventListener('pointermove', this._handlePointerMove.bind(this), { passive: true });
		this._iframeWindow.addEventListener('pointerup', this._handlePointerUp.bind(this));
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		this._iframeWindow.addEventListener('dragend', this._handleDragEnd.bind(this));
		this._iframeWindow.addEventListener('dragover', this._handlePointerMove.bind(this), { passive: true });
		this._iframeWindow.addEventListener('dragover', this._handleDragOver.bind(this));
		this._iframeWindow.addEventListener('drop', this._handleDrop.bind(this), { capture: true });
		this._iframeWindow.addEventListener('copy', this._handleCopy.bind(this), true);
		this._iframeWindow.addEventListener('input', this._handleInput.bind(this));

		this._dragCanvas = this._iframeWindow.document.createElement('canvas');
		this._dragCanvas.style.position = 'absolute';
		this._dragCanvas.style.left = '-100%';
		this._iframeWindow.document.body.append(this._dragCanvas);


		this._autoScroll = new AutoScroll({
			container: this._iframeWindow.document.getElementById('viewerContainer')
		});

		this._iframeWindow.PDFViewerApplication.onPassword = () => {
			this._onRequestPassword();
		};

		await this._iframeWindow.PDFViewerApplication.initializedPromise;
		this._iframeWindow.PDFViewerApplication.eventBus.on('documentinit', this._handleDocumentInit.bind(this));

		this._findController = new PDFFindController({
			linkService: this._iframeWindow.PDFViewerApplication.pdfViewer.linkService,
			onNavigate: async (pageIndex, matchIndex) => {
				let matchPositions = await this._findController.getMatchPositionsAsync(pageIndex);
				this.navigateToPosition(matchPositions[matchIndex]);
			},
			onUpdateMatches: ({ matchesCount }) => {
				let result = {
					total: matchesCount.total,
					index: matchesCount.current - 1,
					pageIndex: matchesCount.currentPageIndex,
					snippets: matchesCount.snippets,
				};
				if (this._pdfjsFindState === FindState.PENDING) {
					result = null;
				}
				else if (matchesCount.current) {
					// Note: This modifies result.annotation after the result has already been emitted by an event,
					// which isn't a good practice
					(async () => {
						await this._ensureBasicPageData(matchesCount.currentPageIndex);
						let selectionRanges = getSelectionRanges(
							this._pdfPages,
							{ pageIndex: matchesCount.currentPageIndex, offset: matchesCount.currentOffsetStart },
							{ pageIndex: matchesCount.currentPageIndex, offset: matchesCount.currentOffsetEnd + 1 }
						);
						result.annotation = this._getAnnotationFromSelectionRanges(selectionRanges, 'highlight');
						// For a11y announcement in a11yAnnounceSearchMessage
						result.currentPageLabel = result.annotation.pageLabel;
						result.currentSnippet = result.snippets[matchesCount.current - 1];
					})();
				}
				this._onSetFindState({ ...this._findState, result });
				this._render();
			},
			onUpdateState: ({ matchesCount, state, rawQuery }) => {
				this._pdfjsFindState = state;
				let result = { total: matchesCount.total, index: matchesCount.current - 1, snippets: matchesCount.snippets };
				if (this._pdfjsFindState === FindState.PENDING || !rawQuery.length) {
					result = null;
				}
				else if (matchesCount.current) {
					// Note: This modifies result.annotation after the result has already been emitted by an event,
					// which isn't a good practice
					(async () => {
						await this._ensureBasicPageData(matchesCount.currentPageIndex);
						let selectionRanges = getSelectionRanges(
							this._pdfPages,
							{ pageIndex: matchesCount.currentPageIndex, offset: matchesCount.currentOffsetStart },
							{ pageIndex: matchesCount.currentPageIndex, offset: matchesCount.currentOffsetEnd + 1 }
						);
						result.annotation = this._getAnnotationFromSelectionRanges(selectionRanges, 'highlight');
						// For a11y announcement in a11yAnnounceSearchMessage
						result.currentPageLabel = result.annotation.pageLabel;
						result.currentSnippet = result.snippets[matchesCount.current - 1];
					})();
				}
				this._onSetFindState({ ...this._findState, result });
				this._render();
			}
		});
	}

	async _init2() {
		this._pdfRenderer = new PDFRenderer({ pdfView: this });

		if (this._primary && !this._preview) {
			// let outline = await this._iframeWindow.PDFViewerApplication.pdfDocument.getOutline2({});
			// this._onSetOutline(outline);
			this._pdfRenderer?.start();
		}

		this._init2 = null;

		this._iframeWindow.PDFViewerApplication.eventBus.on('updateviewarea', this._handleViewAreaUpdate.bind(this));
		this._updateViewStats();
	}

	async _handleDocumentInit() {
		this.setTool(this._tool);
		if (this._viewState) {
			await this._setState(this._viewState, !!this._location);
		}
		// Default state
		else {
			this._iframeWindow.PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width';
		}

		if (this._location) {
			this.navigate(this._location);
		}

		this._resolveInitializedPromise();

		await this._initProcessedData();
		this._findController.setDocument(this._iframeWindow.PDFViewerApplication.pdfDocument);
	}

	async _setState(state, skipScroll) {
		if (Number.isInteger(state.scrollMode)) {
			this._iframeWindow.PDFViewerApplication.pdfViewer.scrollMode = state.scrollMode;
		}

		if (Number.isInteger(state.spreadMode)) {
			this._iframeWindow.PDFViewerApplication.pdfViewer.spreadMode = state.spreadMode;
		}

		// Do this now and after pages are fully loaded.
		// For most PDFs the first one is enough and happens immediately,
		// for other PDFs we are repeating the navigation to correct it
		if (!skipScroll) {
			let dest = [null,
				{ name: 'XYZ' },
				// top/left must be null to be ignored
				state.left || null,
				state.top === undefined ? null : state.top,
				parseInt(state.scale) ? state.scale / 100 : state.scale];

			this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({
				pageNumber: (state.pageIndex || 0) + 1,
				destArray: dest,
				allowNegativeOffset: true
			});
		}

		// Note: Taken from pdf.js source:
		// For documents with different page sizes, once all pages are
		// resolved, ensure that the correct location becomes visible on load.
		// (To reduce the risk, in very large and/or slow loading documents,
		//  that the location changes *after* the user has started interacting
		//  with the viewer, wait for either `pagesPromise` or a timeout.)
		const FORCE_PAGES_LOADED_TIMEOUT = 10000;
		await Promise.race([
			this._iframeWindow.PDFViewerApplication.pdfViewer.pagesPromise,
			new Promise((resolve) => {
				setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT);
			}),
		]);

		if (!skipScroll) {
			let dest = [null,
				{ name: 'XYZ' },
				// top/left must be null to be ignored
				state.left || null,
				state.top === undefined ? null : state.top,
				parseInt(state.scale) ? state.scale / 100 : state.scale];

			this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({
				pageNumber: (state.pageIndex || 0) + 1,
				destArray: dest,
				allowNegativeOffset: true
			});
		}
	}

	async _initThumbnails() {
		this._pdfThumbnails = new PDFThumbnails({
			pdfView: this,
			window: this._iframeWindow,
			onUpdate: (thumbnails) => {
				// TODO: When rendering thumbnails it's also a good chance to getPageData with extracted pageLabel
				this._onSetThumbnails(thumbnails);
			}
		});
	}

	async _updateColorScheme() {
		if (this._forcedColorScheme === 'light') {
			this._colorScheme = 'light';
		}
		else if (this._forcedColorScheme === 'dark') {
			this._colorScheme = 'dark';
		}
		else {
			this._colorScheme = this._preferedColorTheme;
		}

		if (this._iframeWindow) {
			this._iframeWindow.document.documentElement.dataset.colorScheme = this._colorScheme;

			let root = this._iframeWindow.document.documentElement;

			if (this._colorScheme === 'light' && this._lightTheme) {
				this._iframeWindow.theme = this._lightTheme;
				root.style.setProperty('--background-color', this._lightTheme.background);
				this._themeColorScheme = getModeBasedOnColors(this._lightTheme.background, this._lightTheme.foreground);
			}
			else if (this._colorScheme === 'dark' && this._darkTheme) {
				this._iframeWindow.theme = this._darkTheme;
				root.style.setProperty('--background-color', this._darkTheme.background);
				this._themeColorScheme = getModeBasedOnColors(this._darkTheme.background, this._darkTheme.foreground);
			}
			else {
				this._iframeWindow.theme = null;
				root.style.setProperty('--background-color', '#FFFFFF');
				this._themeColorScheme = 'light';
			}

			for (let page of this._pages) {
				page.originalPage.reset();
			}
			await this._iframeWindow.PDFViewerApplication.initializedPromise;
			this._iframeWindow.PDFViewerApplication.pdfViewer.update();
			this._pdfThumbnails?.clear();
		}
	}

	async _initProcessedData() {
		let pageLabels = await this._iframeWindow.PDFViewerApplication.pdfDocument.getPageLabels2();
		this._onSetPageLabels(pageLabels);
		this._resolvePageLabelsPromise();
		this._render();
		this._updateViewStats();
		let { pages } = await this._iframeWindow.PDFViewerApplication.pdfDocument.getProcessedData();
		for (let key in pages) {
			this._pdfPages[key] = pages[key];
		}
		this._render();
		this._updateViewStats();
	}

	async _ensureBasicPageData(pageIndex) {
		if (!this._pdfPages[pageIndex]) {
			let pageData = await this._iframeWindow.PDFViewerApplication.pdfDocument.getPageData({ pageIndex });
			if (!this._pdfPages[pageIndex]) {
				this._pdfPages[pageIndex] = pageData;
			}
		}
	}

	async _attachPage(originalPage) {
		this._init2 && this._init2();

		if (this._preview) {
			this._detachPage(originalPage, true);
			let page = new Page(this, originalPage);
			this._pages.push(page);
			this._render();
			return;
		}

		if (this._primary && !this._pdfThumbnails) {
			this._initThumbnails();
		}

		this._detachPage(originalPage, true);

		// When actively changing zoom sometimes the PageView that was just attached no longer has canvas
		// which probably means that it is being destroyed
		if (!originalPage.canvas) {
			return;
		}

		originalPage.textLayerPromise.then(() => {
			// Text layer may no longer exist if it was detached in the meantime
			let textLayer = originalPage.div.querySelector('.textLayer');
			if (textLayer) {
				textLayer.draggable = true;
			}
		});

		let page = new Page(this, originalPage);

		let pageIndex = originalPage.id - 1;

		this._pages.push(page);
		this._render();

		if (!this._pdfPages[pageIndex]) {
			let pageData = await this._iframeWindow.PDFViewerApplication.pdfDocument.getPageData({ pageIndex });
			if (!this._pdfPages[pageIndex]) {
				this._pdfPages[pageIndex] = pageData;
				this._render();
			}
		}
	}

	_detachPage(originalPage, replacing) {
		let pageIndex = originalPage.id - 1;
		this._pages = this._pages.filter(x => x.originalPage !== originalPage);
		if (!replacing) {
			delete this._pdfPages[pageIndex];
		}
	}

	_getPageLabel(pageIndex, usePrevAnnotation) {
		let pageLabel = this._pageLabels[pageIndex] || (pageIndex + 1).toString()/* || '-'*/;
		if (usePrevAnnotation) {
			let annotations = this._annotations.slice().reverse();
			for (let annotation of annotations) {
				// Ignore read-only annotation because user can't fix its page label
				if (!annotation.readOnly
					&& annotation.pageLabel !== '-'
					&& annotation.position.pageIndex <= pageIndex) {
					if (parseInt(annotation.pageLabel) == annotation.pageLabel || (/[0-9]+[-\u2013][0-9]+/).test(annotation.pageLabel)) {
						pageLabel = (pageIndex + (parseInt(annotation.pageLabel) - annotation.position.pageIndex)).toString();
					}
					break;
				}
			}
		}
		return pageLabel;
	}

	_clearFocus() {
		this._focusedObject = null;
		this._render();
	}

	_focusNext(side) {
		let visiblePages = this._iframeWindow.PDFViewerApplication.pdfViewer._getVisiblePages();
		let visibleObjects = [];

		let scrollY = this._iframeWindow.PDFViewerApplication.pdfViewer.scroll.lastY;
		let scrollX = this._iframeWindow.PDFViewerApplication.pdfViewer.scroll.lastX;
		for (let view of visiblePages.views) {
			let visibleRect = [
				scrollX,
				scrollY,
				scrollX + this._iframeWindow.innerWidth,
				scrollY + this._iframeWindow.innerHeight,
			];

			let pageIndex = view.id - 1;

			let overlays = [];
			let pdfPage = this._pdfPages[pageIndex];
			if (pdfPage) {
				overlays = pdfPage.overlays.filter(x => x.type !== 'reference');
			}

			let objects = [];

			for (let annotation of this._annotations) {
				if (annotation.position.pageIndex === pageIndex
					|| annotation.position.nextPageRects && annotation.position.pageIndex + 1 === pageIndex) {
					objects.push({ type: 'annotation', object: annotation });
				}
			}

			for (let overlay of overlays) {
				objects.push({ type: 'overlay', object: overlay });
			}

			for (let object of objects) {
				let p = p2v(object.object.position, view.view.viewport, pageIndex);
				let br = getPositionBoundingRect(p, pageIndex);
				let absoluteRect = [
					view.x + br[0],
					view.y + br[1],
					view.x + br[2],
					view.y + br[3],
				];

				object.rect = absoluteRect;
				object.pageIndex = pageIndex;

				if (quickIntersectRect(absoluteRect, visibleRect)) {
					visibleObjects.push(object);
				}
			}
		}

		let nextObject;

		let focusedObject;
		if (this._focusedObject) {
			for (let visibleObject of visibleObjects) {
				if (visibleObject.object === this._focusedObject.object
					&& visibleObject.pageIndex === this._focusedObject.pageIndex) {
					focusedObject = visibleObject;
				}
			}
		}

		if (focusedObject && side) {
			let otherObjects = visibleObjects.filter(x => x !== focusedObject);
			nextObject = getClosestObject(focusedObject.rect, otherObjects, side);
		}
		else {
			let cornerPointRect = [scrollX, scrollY, scrollX, scrollY];
			nextObject = getClosestObject(cornerPointRect, visibleObjects);
		}

		if (nextObject) {
			this._focusedObject = nextObject;
			this._onFocusAnnotation(nextObject.object);
			this._lastFocusedObject = this._focusedObject;
			this._render();
			if (this._selectedOverlay) {
				this._selectedOverlay = null;
				this._onSetOverlayPopup(null);
			}
		}
		return !!this._focusedObject;
	}

	getPageByIndex(pageIndex) {
		return this._pages.find(x => x.pageIndex === pageIndex);
	}


	_render(pageIndexes) {
		for (let page of this._pages) {
			if (!pageIndexes || pageIndexes.includes(page.pageIndex)) {
				page.render();
			}
		}
	}

	destroy() {
		this._overlayPopupDelayer.destroy();
	}

	focus() {
		this._iframe.focus();
		// this._iframeWindow.focus();
	}

	async renderPageAnnotationsOnCanvas(canvas, viewport, pageIndex) {
		// Underline annotations need pdfPage[pageIndex].chars to determine text rotation
		if (this._annotations.find(x => x.position.pageIndex === pageIndex && x.type === 'underline')) {
			await this._ensureBasicPageData(pageIndex);
		}
		drawAnnotationsOnCanvas(canvas, viewport, this._annotations, pageIndex, this._pdfPages);
	}

	navigateToPosition(position, options = {}) {
		let element = this._iframeWindow.document.getElementById('viewerContainer');

		let rect = this.getPositionBoundingViewRect(position);

		let { clientWidth, clientHeight, scrollWidth, scrollHeight } = element;

		let verticalPadding = 5;

		let x = rect[0];
		let y = rect[1];

		// Calculate the new scroll position to center the bounding rectangle
		let left = x - (clientWidth / 2);
		let top = y - (options.block === 'start' ? 0 : (clientHeight / 2)) - verticalPadding;

		// Ensure the new scroll position does not go out of bounds
		left = Math.max(0, Math.min(left, scrollWidth - clientWidth));
		top = Math.max(0, Math.min(top, scrollHeight - clientHeight));

		let { first, last } = this._iframeWindow.PDFViewerApplication.pdfViewer._getVisiblePages();
		let startPageIndex = first.id - 1;
		let endPageIndex = last.id - 1;
		startPageIndex--;
		endPageIndex++;
		let close = startPageIndex <= position.pageIndex && position.pageIndex <= endPageIndex;

		// Scroll the element smoothly if it's close enough
		element.scrollTo({
			left,
			top,
			behavior: close ? 'smooth' : 'instant'
		});
	}

	setPageLabels(pageLabels) {
		this._pageLabels = pageLabels;

		for (let i = 0; i < this._iframeWindow.PDFViewerApplication.pdfViewer._pages.length; i++) {
			let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[i];
			let label = pageLabels[i];
			if (label != i + 1) {
				page.div.setAttribute('aria-label', `Page: ${label}. Index: ${i + 1}`);
			}
			else {
				page.div.setAttribute('aria-label', `Page: cd ${i + 1}`);
			}
		}
	}

	setReadOnly(readOnly) {
		this._readOnly = readOnly;
	}

	setTool(tool) {
		if (tool.type === 'hand') {
			this._iframeWindow.PDFViewerApplication.pdfCursorTools.switchTool(1);
		}
		else {
			this._iframeWindow.PDFViewerApplication.pdfCursorTools.switchTool(0);
		}

		this._iframeWindow.document.getElementById('viewerContainer').style.touchAction = tool.type !== 'pointer' ? 'none' : 'auto';
		this._tool = tool;
	}

	setAnnotations(annotations) {
		let affected = getAffectedAnnotations(this._annotations, annotations, true);
		let { created, updated, deleted } = affected;
		this._annotations = annotations;
		if (this._focusedObject?.type === 'annotation') {
			if (updated.find(x => x.id === this._focusedObject.object.id)) {
				this._focusedObject.object = updated.find(x => x.id === this._focusedObject.object.id);
			}
			else if (deleted.find(x => x.id === this._focusedObject.object.id)) {
				this._focusedObject = null;
			}
		}

		if (this._lastFocusedObject?.type === 'annotation') {
			if (updated.find(x => x.id === this._lastFocusedObject.object.id)) {
				this._lastFocusedObject.object = updated.find(x => x.id === this._lastFocusedObject.object.id);
			}
			else if (deleted.find(x => x.id === this._lastFocusedObject.object.id)) {
				this._lastFocusedObject = null;
			}
		}

		let all = [...created, ...updated, ...deleted];
		let pageIndexes = getPageIndexesFromAnnotations(all);
		this._render(pageIndexes);
		if (this._primary && !this._preview) {
			this._pdfThumbnails?.render(pageIndexes, true);
			this._pdfRenderer?.start();
		}
	}

	setLightTheme(theme) {
		this._lightTheme = theme;
		this._updateColorScheme();
	}

	setDarkTheme(theme) {
		this._darkTheme = theme;
		this._updateColorScheme();
	}

	setColorScheme(colorScheme) {
		this._forcedColorScheme = colorScheme;
		this._updateColorScheme();
	}

	setAnnotationPopup(popup) {
		this._annotationPopup = popup;
	}

	setSelectionPopup(popup) {
		this._selectionPopup = popup;
	}

	setOverlayPopup(popup) {
		this._overlayPopup = popup;
		this._overlayPopupDelayer.setOpen(!!popup);
	}

	setFindState(state) {
		if (!state.active && this._findState.active !== state.active) {
			this._findController.onClose();
		}

		if (state.active) {
			if (this._findState.query !== state.query
				|| this._findState.highlightAll !== state.highlightAll
				|| this._findState.caseSensitive !== state.caseSensitive
				|| this._findState.entireWord !== state.entireWord
				|| this._findState.active !== state.active) {
				// Immediately update find state because pdf.js find will trigger _updateFindMatchesCount
				// and _updateFindControlState that update the current find state
				this._findState = state;

				this._findController.find({
					type: 'find',
					query: state.query,
					phraseSearch: true,
					caseSensitive: state.caseSensitive,
					entireWord: state.entireWord,
					highlightAll: state.highlightAll,
					findPrevious: false
				});
			}
			// Make sure the state is updated regardless to have last _findState.result value
			this._findState = state;
			this.a11yWillPlaceVirtCursorOnSearchResult();
		}
		else {
			this._findState = state;
		}
	}

	findNext() {
		if (this._findState.active) {
			this._findController.find({
				type: 'again',
				query: this._findState.query,
				phraseSearch: true,
				caseSensitive: this._findState.caseSensitive,
				entireWord: this._findState.entireWord,
				highlightAll: this._findState.highlightAll,
				findPrevious: false
			});
		}
	}

	findPrevious() {
		if (this._findState.active) {
			this._findController.find({
				source: this._iframeWindow,
				type: 'again',
				query: this._findState.query,
				phraseSearch: true,
				caseSensitive: this._findState.caseSensitive,
				entireWord: this._findState.entireWord,
				highlightAll: this._findState.highlightAll,
				findPrevious: true
			});
		}
	}


	// After the search result is switched to, record which node the
	// search result is in to place screen readers' virtual cursor on it.
	a11yWillPlaceVirtCursorOnSearchResult = debounce(async () => {
		if (!this._findState.result?.annotation) return;
		let { position } = this._findState.result.annotation;
		let range = getSelectionRangesByPosition(this._pdfPages, position);
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer.getPageView(position.pageIndex);
		// The page may have been unloaded, in which case we need to wait for it to be rendered
		let waitCounter = 0;
		while (!page.div.querySelector('.textLayer') && waitCounter < 5) {
			await new Promise(resolve => setTimeout(resolve, 250));
			waitCounter += 1;
		}
		let container = page.div.querySelector('.textLayer');
		if (!container) return;
		let startNode = getNodeOffset(container, range[0].anchorOffset)?.node;
		let endNode = getNodeOffset(container, range[0].to)?.node;
		// pick node corresponding to the range that actually contains the query
		let node = endNode.textContent.includes(this._findState.query) ? endNode : startNode;
		this._a11yVirtualCursorTarget = node.parentNode;
	  }, A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH);

	// Record the current page that the virtual cursor enter when focus enters the content.
	// Debounce to not run this on every view stats update.
	a11yRecordCurrentPage = debounce(() => {
		// Do not interfere with marking search results as virtual cursor targets
		if (this._findState?.active) return;
		let { currentPageNumber } = this._iframeWindow.PDFViewerApplication.pdfViewer;
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer.getPageView(currentPageNumber - 1);
		// Mark the current page. Note: page.div is never removed but its content can be.
		// If the target were to be set on anything inside of page.div, JAWS would loose its virtual
		// cursor if the page is unloaded.
		this._a11yVirtualCursorTarget = page.div;
		if (this._a11yShouldFocusVirtualCursorTarget) {
			this._a11yShouldFocusVirtualCursorTarget = false;
			placeA11yVirtualCursor(this._a11yVirtualCursorTarget);
		}
	}, A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH);

	setSelectedAnnotationIDs(ids) {
		this._selectedAnnotationIDs = ids;
		this._setSelectionRanges();
		// this._clearFocus();

		this._render();

		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._onSetAnnotationPopup();
	}

	_openAnnotationPopup() {
		let annotations = this.getSelectedAnnotations();
		if (annotations.length === 1) {
			let annotation = annotations[0];
			let node = this._iframeWindow.document.getElementById('viewerContainer');
			let rect = this.getClientRectForPopup(annotation.position, node.scrollLeft, node.scrollTop);
			this._onSetAnnotationPopup({ rect, annotation });
		}
	}

	_setSelectionRanges(selectionRanges) {
		this._selectionRanges = selectionRanges || [];
		let selectionRange = this._selectionRanges[0];
		if (selectionRange && !selectionRange.collapsed) {
			let rect = this.getClientRectForPopup(selectionRange.position);
			let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
			this._onSetSelectionPopup({ rect, annotation });
		}
		else {
			this._onSetSelectionPopup();
		}
	}

	_isSelectionCollapsed() {
		return !this._selectionRanges.length || !!this._selectionRanges[0].collapsed;
	}

	showAnnotations(show) {

	}

	zoomReset() {
		this.zoomPageWidth();
	}

	zoomIn() {
		this._iframeWindow.PDFViewerApplication.zoomIn();
	}

	zoomOut() {
		this._iframeWindow.PDFViewerApplication.zoomOut();
	}

	zoomPageWidth() {
		this._iframeWindow.PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width';
	}

	zoomPageHeight() {
		this._iframeWindow.PDFViewerApplication.pdfViewer.currentScaleValue = 'page-fit';
	}

	zoomAuto() {
		this._iframeWindow.PDFViewerApplication.pdfViewer.currentScaleValue = 'auto';
	}

	async _pushHistoryPoint() {
		this._suspendHistorySaving = true;
		let container = this._iframeWindow.document.getElementById('viewerContainer');
		await debounceUntilScrollFinishes(container, 100);
		this._suspendHistorySaving = false;
		let { pageNumber, top, left } = this._iframeWindow.PDFViewerApplication.pdfViewer._location;
		let pageIndex = pageNumber - 1;
		this._history.save({ dest: [pageIndex, { name: 'XYZ' }, left, top, null] });
	}

	_highlightPosition(position) {
		this._highlightedPosition = position;
		this._render();
		setTimeout(() => {
			this._highlightedPosition = null;
			this._render();
		}, 2000);
	}

	async navigate(location, options = {}) {
		options.block ||= 'center';
		this._lastNavigationTime = Date.now();
		if (location.annotationID && this._annotations.find(x => x.id === location.annotationID)) {
			let annotation = this._annotations.find(x => x.id === location.annotationID);
			this.navigateToPosition(annotation.position, options);
		}
		else if (location.dest) {
			this._iframeWindow.PDFViewerApplication.pdfLinkService.goToDestination(location.dest);
		}
		else if (location.position) {
			this.navigateToPosition(location.position, options);
			this._highlightPosition(location.position);
		}
		else if (Number.isInteger(location.pageIndex)) {
			this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({
				pageNumber: location.pageIndex + 1
			});
		}
		else if (location.pageLabel) {
			await this._pageLabelsPromise;
			let pageIndex = this._pageLabels.findIndex(x => x === location.pageLabel);
			if (pageIndex !== -1) {
				this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({ pageNumber: pageIndex + 1 });
			}
		}
		else if (location.pageNumber) {
			await this._pageLabelsPromise;
			let pageIndex = this._pageLabels.findIndex(x => x === location.pageNumber);
			if (pageIndex !== -1) {
				this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({ pageNumber: pageIndex + 1 });
			}
			else {
				let pageIndex = parseInt(location.pageNumber) - 1;
				if (pageIndex !== -1) {
					this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({ pageNumber: pageIndex + 1 });
				}
			}
		}
		if (!options.skipHistory) {
			this._pushHistoryPoint();
		}
	}

	navigateBack() {
		this._history.navigateBack();
	}

	navigateForward() {
		this._history.navigateForward();
	}

	navigateToNextPage() {
		this._iframeWindow.PDFViewerApplication.pdfViewer.nextPage();
	}

	navigateToPreviousPage() {
		this._iframeWindow.PDFViewerApplication.pdfViewer.previousPage();
	}

	navigateToFirstPage() {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('firstpage');
	}

	navigateToLastPage() {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('lastpage');
	}

	rotateLeft() {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('rotateccw');
	}

	rotateRight() {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('rotatecw');
	}

	setSidebarOpen(_sidebarOpen) {
		// Ignore
	}

	getViewPoint(point, pageIndex, tm = [1, 0, 0, 1, 0, 0]) {
		let originalPage = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let scaleTransform = [originalPage.outputScale.sx, 0, 0, originalPage.outputScale.sy, 0, 0];
		let m = scaleTransform;
		// m = [1, 0, 0, 1, 0, 0];
		m = transform(m, originalPage.viewport.transform);
		m = transform(m, tm);
		return applyTransform(point, m);
	}

	getPdfPoint(p, pageIndex, tm) {
		let originalPage = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let scaleTransform = [originalPage.outputScale.sx, 0, 0, originalPage.outputScale.sy, 0, 0];
		let m = scaleTransform;
		// m = [1, 0, 0, 1, 0, 0];
		m = transform(m, originalPage.viewport.transform);
		m = transform(m, tm);
		return applyInverseTransform(p, m);
	}

	getViewRect(rect, pageIndex) {
		let originalPage = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let scaleTransform = [originalPage.outputScale.sx, 0, 0, originalPage.outputScale.sy, 0, 0];
		let m = scaleTransform;
		m = transform(m, originalPage.viewport.transform);
		let [x1, y2] = applyTransform(rect.slice(0, 2), m);
		let [x2, y1] = applyTransform(rect.slice(2, 4), m);
		return [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];
	}

	getViewportRotation(pageIndex) {
		let originalPage = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		return getRotationDegrees(originalPage.viewport.transform);
	}

	getPositionBoundingViewRect(position) {
		let { pageIndex } = position;
		let rect = getPositionBoundingRect(position, pageIndex);
		let viewport = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex].viewport;
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];

		let [x1, y2] = viewport.convertToViewportPoint(...rect);
		let [x2, y1] = viewport.convertToViewportPoint(...rect.slice(2, 4));
		let r = [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];
		let pr = page.div.getBoundingClientRect();


		let node = this._iframeWindow.document.getElementById('viewerContainer');

		let x = node.scrollLeft;
		let y = node.scrollTop;

		return [
			pr.x + r[0] + x,
			pr.y + r[1] + y,
			pr.x + r[2] + x,
			pr.y + r[3] + y,
		];
	}


	getClientRectForPopup(position, scrollLeft, scrollTop) {
		let pageIndex = position.nextPageRects ? position.pageIndex + 1 : position.pageIndex;
		let rect = getPositionBoundingRect(position, pageIndex);
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let [x1, y2] = page.viewport.convertToViewportPoint(...rect);
		let [x2, y1] = page.viewport.convertToViewportPoint(...rect.slice(2, 4));

		let r = [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];

		if (!this._pp || 1) {
			let pr = page.div.getBoundingClientRect();
			this._pp = {
				pr,
				scrollLeft,
				scrollTop
			};
			return [
				pr.x + r[0],
				pr.y + r[1],
				pr.x + r[2],
				pr.y + r[3],
			];
		}
		else {
			let pp = this._pp;
			let x = pp.pr.x;
			let y = pp.pr.y;
			y += pp.scrollTop - scrollTop;
			return [
				pp.pr.x + r[0],
				y + r[1],
				pp.pr.x + r[2],
				y + r[3],
			];
		}
	}

	getClientRect(rect, pageIndex) {
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let [x1, y2] = page.viewport.convertToViewportPoint(...rect);
		let [x2, y1] = page.viewport.convertToViewportPoint(...rect.slice(2, 4));

		let r = [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];

		let pr = this._pr;
		if (!pr) {
			pr = page.div.getBoundingClientRect();
		}
		return [
			pr.x + r[0],
			pr.y + r[1],
			pr.x + r[2],
			pr.y + r[3],
		];
	}

	getSelectedAnnotationAction(annotation, position) {
		// Prevent selected single-point ink annotation breaking all other actions in the page
		if (annotation.type === 'ink') {
			let br = getPositionBoundingRect(annotation.position);
			if (br[0] === br[2] || br[1] === br[3]) {
				return null;
			}
		}

		if (!annotation.position.nextPageRects && annotation.position.pageIndex !== position.pageIndex
			|| annotation.position.nextPageRects && !this._pdfPages[annotation.position.pageIndex + 1]) {
			return null;
		}

		// TODO: Likely it needs to be fixed for inter-page annotations
		if (this._readOnly || annotation.readOnly) {
			if (intersectAnnotationWithPoint(annotation.position, position)) {
				let r = position.rects[0];
				let br = getPositionBoundingRect(annotation.position);
				return { type: 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
			}
			return null;
		}

		// If the page isn't loaded
		if (!this._iframeWindow.PDFViewerApplication.pdfViewer._pages[position.pageIndex].outputScale) {
			return null;
		}

		let dd = 5 * devicePixelRatio;

		let p = this.getViewPoint(position.rects[0], position.pageIndex);


		p = [p[0], p[1], p[0], p[1]];

		if (['highlight', 'underline'].includes(annotation.type)) {
			// Calculate text resizing handle rectangles taking into account text rotation
			if (this._pdfPages[annotation.position.pageIndex]
				&& (!annotation.position.nextPageRects || this._pdfPages[annotation.position.pageIndex + 1])) {
				let { chars } = this._pdfPages[annotation.position.pageIndex];
				let startHandle;
				let endHandle;
				let padding = 3;
				if (annotation.position.nextPageRects) {
					if (annotation.position.pageIndex + 1 === position.pageIndex) {
						let { chars } = this._pdfPages[annotation.position.pageIndex + 1];
						let rotation = getRectRotationOnText(chars, annotation.position.nextPageRects.at(-1));
						// Add page rotation to text rotation
						rotation += this.getViewportRotation(annotation.position.pageIndex + 1);
						rotation = normalizeDegrees(rotation);
						let rect = this.getViewRect(annotation.position.nextPageRects.at(-1), annotation.position.pageIndex + 1);
						let [x1, y1, x2, y2] = rect;
						rect = (
							rotation === 0 && [x2 - padding, y1, x2 + padding, y2]
							|| rotation === 90 && [x1, y1 - padding, x2, y1 + padding]
							|| rotation === 180 && [x1 - padding, y1, x1 + padding, y2]
							|| rotation === 270 && [x1, y2 - padding, x2, y2 + padding]
						);
						endHandle = { rect, vertical: [90, 270].includes(rotation) };
					}
					else {
						let rotation = getRectRotationOnText(chars, annotation.position.rects[0]);
						// Add page rotation to text rotation
						rotation += this.getViewportRotation(annotation.position.pageIndex);
						rotation = normalizeDegrees(rotation);
						let rect = this.getViewRect(annotation.position.rects[0], annotation.position.pageIndex);
						let [x1, y1, x2, y2] = rect;
						rect = (
							rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
							|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
							|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
							|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
						);
						startHandle = { rect, vertical: [90, 270].includes(rotation) };
					}
				}
				else {
					let rotation = getRectRotationOnText(chars, annotation.position.rects[0]);
					// Add page rotation to text rotation
					rotation += this.getViewportRotation(annotation.position.pageIndex);
					rotation = normalizeDegrees(rotation);
					let rect = this.getViewRect(annotation.position.rects[0], annotation.position.pageIndex);
					let [x1, y1, x2, y2] = rect;
					rect = (
						rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
						|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
						|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
						|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
					);
					startHandle = { rect, vertical: [90, 270].includes(rotation) };
					rotation = getRectRotationOnText(chars, annotation.position.rects.at(-1));
					// Add page rotation to text rotation
					rotation += this.getViewportRotation(annotation.position.pageIndex);
					rotation = normalizeDegrees(rotation);
					rect = this.getViewRect(annotation.position.rects.at(-1), annotation.position.pageIndex);
					[x1, y1, x2, y2] = rect;
					rect = (
						rotation === 0 && [x2 - padding, y1, x2 + padding, y2]
						|| rotation === 90 && [x1, y1 - padding, x2, y1 + padding]
						|| rotation === 180 && [x1 - padding, y1, x1 + padding, y2]
						|| rotation === 270 && [x1, y2 - padding, x2, y2 + padding]
					);
					endHandle = { rect, vertical: [90, 270].includes(rotation) };
				}
				if (startHandle) {
					let { rect, vertical } = startHandle;
					if (quickIntersectRect(rect, p)) {
						let selectionRanges = getSelectionRangesByPosition(this._pdfPages, annotation.position);
						selectionRanges = getReversedSelectionRanges(selectionRanges);
						return { type: 'updateAnnotationRange', selectionRanges, annotation, vertical };
					}
				}
				if (endHandle) {
					let { rect, vertical } = endHandle;
					if (quickIntersectRect(rect, p)) {
						let selectionRanges = getSelectionRangesByPosition(this._pdfPages, annotation.position);
						return { type: 'updateAnnotationRange', selectionRanges, annotation, vertical };
					}
				}
			}
		}
		else if (['image', 'text', 'ink'].includes(annotation.type)) {
			let r = getPositionBoundingRect(annotation.position);

			if (annotation.type === 'text') {
				r = annotation.position.rects[0];
			}


			let tm = [1, 0, 0, 1, 0, 0];

			if (annotation.type === 'text' && annotation.position.rotation) {
				tm = getRotationTransform(r, annotation.position.rotation || 0);
			}

			let bottomLeft = this.getViewPoint([r[0], r[1]], position.pageIndex, tm);
			let bottomRight = this.getViewPoint([r[2], r[1]], position.pageIndex, tm);
			let topLeft = this.getViewPoint([r[0], r[3]], position.pageIndex, tm);
			let topRight = this.getViewPoint([r[2], r[3]], position.pageIndex, tm);
			let middleLeft = this.getViewPoint([r[0], r[1] + (r[3] - r[1]) / 2], position.pageIndex, tm);
			let middleRight = this.getViewPoint([r[2], r[1] + (r[3] - r[1]) / 2], position.pageIndex, tm);
			let middleTop = this.getViewPoint([r[0] + (r[2] - r[0]) / 2, r[3]], position.pageIndex, tm);
			let middleBottom = this.getViewPoint([r[0] + (r[2] - r[0]) / 2, r[1]], position.pageIndex, tm);
			let ROTATION_BOTTOM = 16;
			let rotation = this.getViewPoint([r[0] + (r[2] - r[0]) / 2, r[3] + ROTATION_BOTTOM], position.pageIndex, tm);

			let BOX_PADDING = 10 * devicePixelRatio;

			if (['text', 'ink'].includes(annotation.type)) {
				[bottomLeft, bottomRight, topLeft, topRight, middleLeft, middleRight, middleTop, middleBottom] = scaleShape([bottomLeft, bottomRight, topRight, topLeft], [bottomLeft, bottomRight, topLeft, topRight, middleLeft, middleRight, middleTop, middleBottom], BOX_PADDING);
			}

			let bottomLeftRect = [bottomLeft[0] - dd, bottomLeft[1] - dd, bottomLeft[0] + dd, bottomLeft[1] + dd];
			let bottomRightRect = [bottomRight[0] - dd, bottomRight[1] - dd, bottomRight[0] + dd, bottomRight[1] + dd];
			let topLeftRect = [topLeft[0] - dd, topLeft[1] - dd, topLeft[0] + dd, topLeft[1] + dd];
			let topRightRect = [topRight[0] - dd, topRight[1] - dd, topRight[0] + dd, topRight[1] + dd];

			let leftRect = [bottomLeft[0] - dd, topLeft[1], topLeft[0] + dd, bottomLeft[1]];
			let rightRect = [bottomRight[0] - dd, topRight[1] - dd, topRight[0] + dd, bottomRight[1] + dd];
			let topRect = [topLeft[0], topLeft[1] - dd, topRight[0], topRight[1] + dd];
			let bottomRect = [bottomLeft[0], bottomLeft[1] - dd, bottomRight[0], bottomRight[1] + dd];

			let middleLeftRect = [middleLeft[0] - dd, middleLeft[1] - dd, middleLeft[0] + dd, middleLeft[1] + dd];
			let middleRightRect = [middleRight[0] - dd, middleRight[1] - dd, middleRight[0] + dd, middleRight[1] + dd];
			let middleTopRect = [middleTop[0] - dd, middleTop[1] - dd, middleTop[0] + dd, middleTop[1] + dd];
			let middleBottomRect = [middleBottom[0] - dd, middleBottom[1] - dd, middleBottom[0] + dd, middleBottom[1] + dd];
			let rotationRect = [rotation[0] - dd, rotation[1] - dd, rotation[0] + dd, rotation[1] + dd];


			let dir;
			if (annotation.type === 'text' && quickIntersectRect(rotationRect, p)) {
				return { type: 'rotate', annotation };
			}
			else if (quickIntersectRect(topRightRect, p)) {
				dir = 'tr';
			}
			else if (quickIntersectRect(topLeftRect, p)) {
				dir = 'tl';
			}
			else if (quickIntersectRect(bottomRightRect, p)) {
				dir = 'br';
			}
			else if (quickIntersectRect(bottomLeftRect, p)) {
				dir = 'bl';
			}
			else if (['image', 'text'].includes(annotation.type) && quickIntersectRect(middleLeftRect, p)) {
				dir = 'l';
			}
			else if (['image', 'text'].includes(annotation.type) && quickIntersectRect(middleRightRect, p)) {
				dir = 'r';
			}
			else if (annotation.type === 'image' && quickIntersectRect(middleTopRect, p)) {
				dir = 't';
			}
			else if (annotation.type === 'image' && quickIntersectRect(middleBottomRect, p)) {
				dir = 'b';
			}
			if (dir) {
				return { type: 'resize', annotation, dir };
			}

			let rrr = [topLeft[0], topLeft[1], bottomRight[0], bottomRight[1]];
			//
			// if (quickIntersectRect(rrr, p)) {
			// 	let r = position.rects[0];
			// 	let br = getPositionBoundingRect(annotation.position);
			// 	return { type: ['note', 'text'].includes(annotation.type) ? 'moveAndDrag' : 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
			// }


			let inside = false;
			// Get rect with padding but inside object coordinates
			let p1 = this.getPdfPoint(bottomLeft, position.pageIndex, tm);
			let p2 = this.getPdfPoint(bottomRight, position.pageIndex, tm);
			let p3 = this.getPdfPoint(topLeft, position.pageIndex, tm);
			let p4 = this.getPdfPoint(topRight, position.pageIndex, tm);
			let points = [p1, p2, p3, p4];
			let rect = [
				Math.min(...points.map(x => x[0])),
				Math.min(...points.map(x => x[1])),
				Math.max(...points.map(x => x[0])),
				Math.max(...points.map(x => x[1]))
			];
			let pr = this.getPdfPoint(p, position.pageIndex, tm);
			pr = [pr[0], pr[1], pr[0], pr[1]];
			if (quickIntersectRect(rect, pr)) {
				inside = true;
			}

			if (inside && !this._textAnnotationFocused()) {
				let r = position.rects[0];
				// let br = getBoundingBox(annotation.position.rects[0], tm);
				let br = getPositionBoundingRect(annotation.position);
				return { type: ['text', 'ink'].includes(annotation.type) ? 'moveAndDrag' : 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
			}
		}

		if (
			['highlight', 'underline', 'note'].includes(annotation.type)
			&& intersectAnnotationWithPoint(annotation.position, position)
		) {
			let r = position.rects[0];
			let br = getPositionBoundingRect(annotation.position);
			return { type: ['note', 'text', 'ink'].includes(annotation.type) ? 'moveAndDrag' : 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
		}

		return null;
	}

	getMoveAction(annotation, position) {
		let r = position.rects[0];
		let br = getPositionBoundingRect(annotation.position);
		return { type: 'move', annotation, x: r[0] - br[0], y: r[1] - br[1] };
	}

	_getSelectableOverlay(position) {
		if (!position) {
			return;
		}
		let pdfPage = this._pdfPages[position.pageIndex];
		if (!pdfPage) {
			return;
		}
		let selectableOverlays = [];
		for (let overlay of pdfPage.overlays) {
			if (overlay.type === 'reference') {
				continue;
			}
			if (intersectAnnotationWithPoint(overlay.position, position)) {
				selectableOverlays.push(overlay);
			}
		}

		selectableOverlays.sort((a, b) => {
			let aSize, bSize;

			if (a.position.rects) {
				aSize = getRectsAreaSize(a.position.rects);
			}
			else if (a.position.paths) {
				aSize = 0;
			}

			if (b.position.rects) {
				bSize = getRectsAreaSize(b.position.rects);
			}
			else if (b.position.paths) {
				bSize = 0;
			}

			return aSize - bSize;
		});

		return selectableOverlays[0];
	}

	_getPageAnnotations(pageIndex) {
		return this._annotations.filter(
			x => x.position.pageIndex === pageIndex
			|| x.position.nextPageRects && x.position.pageIndex + 1 === pageIndex
		);
	}

	getSelectableAnnotations(position) {
		let page = this.getPageByIndex(position.pageIndex);
		if (!page) {
			return null;
		}
		let annotations = this._getPageAnnotations(position.pageIndex);
		let selectableAnnotations = [];
		for (let annotation of annotations) {
			if (annotation.type === 'text' && annotation.position.rotation) {
				let tm = getRotationTransform(annotation.position.rects[0], annotation.position.rotation);
				let rect = position.rects[0];
				let r1 = getBoundingBox(rect, inverseTransform(tm));
				let r2 = annotation.position.rects[0];
				if (quickIntersectRect(r1, r2)) {
					selectableAnnotations.push(annotation);
				}
			}
			else {
				if (intersectAnnotationWithPoint(annotation.position, position)) {
					selectableAnnotations.push(annotation);
				}
			}
		}

		let selectedTextAnnotation = selectableAnnotations.find(
			x => x.type === 'text'
			&& x.id === this._selectedAnnotationIDs[0]
		);
		if (selectedTextAnnotation) {
			return [selectedTextAnnotation];
		}

		selectableAnnotations.sort((a, b) => {
			let aSize, bSize;

			if (a.position.rects) {
				aSize = getRectsAreaSize(a.position.rects);
			}
			else if (a.position.paths) {
				aSize = 0;
			}

			if (b.position.rects) {
				bSize = getRectsAreaSize(b.position.rects);
			}
			else if (b.position.paths) {
				bSize = 0;
			}

			return aSize - bSize;
		});
		return selectableAnnotations;
	}

	getSelectedAnnotations() {
		return this._annotations.filter(x => this._selectedAnnotationIDs.includes(x.id));
	}

	// moveAndDrag, drag, resize, selectText, updateSelection, drawHighlight, drawUnderline, drawImage,

	// - Don't allow to select anything under the currently selected element
	// - Move text selection into getSingleSelectedObjectAction
	getActionAtPosition(position, event) {
		// Mouse events don't have pointerType
		let mouse = !event.pointerType || event.pointerType === 'mouse';
		// If using a mouse and not the main button is pressed
		if (mouse && event.button >= 1 || this._tool.type === 'hand') {
			return { action: { type: 'none' }, selectAnnotations: [] };
		}
		// If holding shift, only allow text selection, to select text under annotations
		// TODO: If an annotation is already selected, this might be interfering with
		//  annotation range selection with shift in reader.setSelectedAnnotations
		if (event.altKey) {
			return { action: { type: 'selectText' }, selectAnnotations: [] };
		}
		if (this._tool.type === 'ink') {
			return { action: { type: 'ink' }, selectAnnotations: [] };
		}
		else if (this._tool.type === 'eraser') {
			return { action: { type: 'erase', annotations: new Map() }, selectAnnotations: [] };
		}
		if (this._selectionRanges.length && ![2, 3].includes(event.detail)) {
			let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
			if (annotation && intersectAnnotationWithPoint(annotation.position, position)) {
				let r = position.rects[0];
				let br = getPositionBoundingRect(annotation.position);
				let action = { type: 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1], selection: true };
				return { action, selectAnnotations: null };
			}
		}

		// let overlay = this._getSelectableOverlay(position);
		// if (overlay) {
		// 	let action = { type: 'overlay', overlay };
		// 	return { action, selectAnnotations: [] };
		// }

		let selectedAnnotations = this.getSelectedAnnotations();
		let selectAnnotations = selectedAnnotations;
		// If single object selected, check if trying to transform it
		if (selectedAnnotations.length === 1) {
			let annotation = selectAnnotations[0];
			let action = this.getSelectedAnnotationAction(annotation, position);
			if (action) {
				return { action, selectAnnotations: null };
			}
		}

		let selectableAnnotation = (this.getSelectableAnnotations(position) || [])[0];

		let action = null;
		// If annotation was pressed
		if (selectableAnnotation) {
			// If it's between multiple selected annotations
			if (selectedAnnotations.includes(selectableAnnotation)) {
				action = { type: 'drag', annotation: selectableAnnotation, multiple: true };
				selectAnnotations = null;
			}
			// If annotation isn't selected
			else {
				selectAnnotations = [selectableAnnotation];
				let annotation = selectableAnnotation;
				if (!(this._readOnly || annotation.readOnly) && ['note', 'text', 'ink'].includes(annotation.type)) {
					let r = position.rects[0];
					let br = getPositionBoundingRect(annotation.position);
					action = { type: 'moveAndDrag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
				}
				else {
					let r = position.rects[0];
					let br = getPositionBoundingRect(annotation.position);
					action = { type: 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
				}
			}
		}
		else {
			selectAnnotations = [];
			if (this._tool.type === 'note') {
				action = { type: 'note' };
			}
			else if (this._tool.type === 'image') {
				action = { type: 'image' };
			}
			else if (this._tool.type === 'text') {
				action = { type: 'text' };
			}
			else {
				// Enable text selection if using mouse or pen or touch (finger) with highlight/underline tool
				if (mouse || event.pointerType === 'pen' || ['highlight', 'underline'].includes(this._tool.type)) {
					action = { type: 'selectText' };
				}
				// Otherwise don't trigger any action for touch/pen because it'll be scrolling
				else {
					return { action: { type: 'none' }, selectAnnotations: [] };
				}
			}
		}

		return { action, selectAnnotations };
	}

	updateCursor(action) {
		let cursor = 'default';
		if (action) {
			if (action.type === 'overlay') {
				cursor = 'pointer';
			}
			else if (action.type === 'updateAnnotationRange') {
				if (!action.triggered) {
					if (action.vertical) {
						cursor = 'ns-resize';
					}
					else {
						cursor = 'ew-resize';
					}
				}
				else {
					cursor = 'text';
				}
			}
			else if (action.type === 'resize') {
				if (action.annotation.position.rotation) {
					cursor = 'move';
				}
				else {
					if (['l', 'r'].includes(action.dir)) {
						cursor = 'ew-resize';
					}
					else if (['t', 'b'].includes(action.dir)) {
						cursor = 'ns-resize';
					}
					else if (['tl', 'br'].includes(action.dir)) {
						cursor = 'nwse-resize';
					}
					else if (['bl', 'tr'].includes(action.dir)) {
						cursor = 'nesw-resize';
					}
				}
			}
			else if (action.type === 'move') {
				cursor = 'grab';
			}
			else if (action.type === 'rotate') {
				cursor = 'move';
			}
			else if (action.type === 'ink') {
				cursor = 'crosshair';
			}
			else if (action.type === 'erase') {
				let transform = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[0].viewport.transform;
				let [a, b] = transform;
				let scale = Math.hypot(a, b);
				let size = this._tool.size * scale;
				let adjustedSize = size * window.devicePixelRatio;
				let adjustedStrokeWidth = 1 * window.devicePixelRatio;
				// For some reason just using media query in the SVG style doesn't work on Zotero, but works on fx102
				let color = window.matchMedia('(prefers-color-scheme: dark)').matches
					&& this._useDarkMode ? 'white' : 'black';
				let svgDataUrl = [
					'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"',
					`     width="${size}"`,
					`     height="${size}"`,
					`     viewBox="0 0 ${adjustedSize} ${adjustedSize}">`,
					`    <circle cx="${adjustedSize / 2}"`,
					`            cy="${adjustedSize / 2}"`,
					`            r="${(adjustedSize - adjustedStrokeWidth) / 2}"`,
					`            stroke="${color}"`,
					`            stroke-width="${adjustedStrokeWidth}"`,
					'            fill="none" />',
					'</svg>'
				].join('');
				cursor = `url('${svgDataUrl}') ${size / 2} ${size / 2}, auto`;
			}
			else if (['selectText'].includes(action.type)) {
				cursor = 'text';
			}
		}
		// cursor = 'move';
		let viewerContainer = this._iframeWindow.document.getElementById('viewerContainer');
		viewerContainer.style.cursor = cursor;
	}

	_updateScrollVector() {

	}

	_handlePointerDown(event) {
		if (event.pointerType === 'mouse') {
			return;
		}
		if (this._pointerDownTriggered) {
			return;
		}
		this._pointerDownTriggered = true;
		this._highlightedPosition = null;

		// Clear textLayer selection
		if (!event.target.classList.contains('textAnnotation')) {
			this._iframeWindow.getSelection().removeAllRanges();
		}

		// Prevents showing focus box after pressing Enter and de-selecting annotation which was select with mouse
		this._lastFocusedObject = null;

		// If we marked a node as future focus target for screen readers, clear it to avoid scrolling to it
		this._a11yVirtualCursorTarget = null;
		if (!event.target.closest('#viewerContainer')) {
			return;
		}

		this._clearFocus();

		let shift = event.shiftKey;
		let position = this.pointerEventToPosition(event);

		if (event.button === 2) {
			// Right click will be handled in the contextmenu event
			return;
		}

		if (!position) {
			this._setSelectionRanges();
			this._onSelectAnnotations([], event);
			this._render();
			return;
		}
		let page = this.getPageByIndex(position.pageIndex);
		let { action, selectAnnotations } = this.getActionAtPosition(position, event);

		// if (action.type === 'overlay') {
		// 	// TODO: Only link overlay should block text selection, while citation and reference shouldn't
		// 	if (action.overlay.type === 'internal-link') {
		// 		this.navigate({ dest: action.overlay.dest });
		// 	}
		// 	else if (action.overlay.type === 'external-link') {
		// 		this._onOpenLink(action.overlay.url);
		// 	}
		// 	return;
		// }

		this.action = action;
		this.pointerDownPosition = position;
		// Select text, and/or object, otherwise unselect

		if (selectAnnotations && !(selectAnnotations.length === 0 && this._selectedAnnotationIDs.length === 0)) {
			this._onSelectAnnotations(selectAnnotations.map(x => x.id), event);
			if (selectAnnotations.length) {
				action.alreadySelectedAnnotations = true;
			}
			this._openAnnotationPopup();
		}

		// Deselect annotations, but only if shift isn't pressed which means doing text selection
		if (selectAnnotations && !selectAnnotations.length && !shift) {
			this._onSelectAnnotations([], event);
		}

		if (action.type === 'note') {
			let rect = position.rects[0];
			let newPosition = {
				pageIndex: position.pageIndex,
				rects: [[
					rect[0] - PDF_NOTE_DIMENSIONS / 2,
					rect[1] - PDF_NOTE_DIMENSIONS / 2,
					rect[2] + PDF_NOTE_DIMENSIONS / 2,
					rect[3] + PDF_NOTE_DIMENSIONS / 2
				]]
			};
			this._onAddAnnotation({
				type: 'note',
				color: this._tool.color,
				pageLabel: this._getPageLabel(this.pointerDownPosition.pageIndex, true),
				sortIndex: getSortIndex(this._pdfPages, newPosition),
				position: newPosition
			}, true);
		}
		else if (action.type === 'text') {
			let rect = position.rects[0];
			let fontSize = this._tool.size;
			let newPosition = {
				pageIndex: position.pageIndex,
				fontSize,
				rotation: 0,
				rects: [[
					rect[0] - fontSize / 2,
					rect[1] - fontSize / 2,
					rect[2] + fontSize / 2,
					rect[3] + fontSize / 2
				]]
			};
			this._onAddAnnotation({
				type: 'text',
				color: this._tool.color,
				pageLabel: this._getPageLabel(this.pointerDownPosition.pageIndex, true),
				sortIndex: getSortIndex(this._pdfPages, newPosition),
				position: newPosition
			}, true);
		}
		else if (action.type === 'ink') {
			let point = position.rects[0].slice(0, 2);
			action.annotation = {
				type: 'ink',
				color: this._tool.color,
				pageLabel: this._getPageLabel(this.pointerDownPosition.pageIndex, true),
				position: {
					pageIndex: this.pointerDownPosition.pageIndex,
					width: this._tool.size,
					paths: [[...point]]
				}
			};
			action.triggered = true;
		}
		else if (action.type === 'erase') {
			let annotations = [];
			for (let annotation of this._annotations) {
				if (annotation.type === 'ink'
					&& annotation.position.pageIndex === position.pageIndex
					&& !action.annotations.has(annotation.id)
				) {
					annotations.push(annotation);
				}
			}
			annotations.push(...action.annotations.values());
			let [x, y] = position.rects[0];
			let updatedAnnotations = eraseInk(x, y, this._tool.size, annotations);
			for (let annotation of updatedAnnotations) {
				action.annotations.set(annotation.id, annotation);
			}
			if (updatedAnnotations.length) {
				action.triggered = true;
			}
		}

		if (action.type === 'selectText') {
			if (event.detail === 1 || !event.detail) {
				if (shift && this._selectionRanges.length) {
					this._selectionRanges = getModifiedSelectionRanges(this._pdfPages, this._selectionRanges, position);
				}
				else {
					this._selectionRanges = getSelectionRanges(this._pdfPages, position, position);
				}
				this.action.mode = 'chars';
			}
			else if (event.detail === 2) {
				this._selectionRanges = getWordSelectionRanges(this._pdfPages, position, position);
				this.action.mode = 'words';
			}
			else if (event.detail === 3) {
				this._selectionRanges = getLineSelectionRanges(this._pdfPages, position, position);
				this.action.mode = 'lines';
			}
			if (this._selectionRanges.length && !this._selectionRanges[0].collapsed) {
				action.triggered = true;
			}
		}

		if (action.selection) {
			let selectionRange = this._selectionRanges[0];
			if (selectionRange && !selectionRange.collapsed) {
				let rect = this.getClientRectForPopup(selectionRange.position);
				let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
				this._onSetSelectionPopup({ rect, annotation });
			}
		}
		else {
			this._onSetSelectionPopup();
		}

		//

		//
		// if (selectAnnotations && !selectAnnotations.length) {
		// 	this._onSetAnnotationPopup();
		// }


		this._autoScroll.enable();

		this._render();
	}

	_handleTouchMove(event) {
		if (
			// Prevent default touch action (which is scroll) if any tool is enabled
			this._tool.type !== 'pointer'
			// Or a text selection action is triggered using a pen in the page (not the gray area)
			|| (this.action?.type === 'selectText' && event.target.id !== 'viewer')
		) {
			event.preventDefault();
		}
	}

	_handleTouchEnd(event) {
		// Prevent emulated mouse event firing (i.e. mousedown, which messes up things).
		// Although on chrome we get an error when trying to scroll:
		// "[Intervention] Ignored attempt to cancel a touchend event with cancelable=false,
		// for example because scrolling is in progress and cannot be interrupted"
		event.preventDefault();
		this._pointerDownTriggered = false;
	}

	_handlePointerMove = throttle((event) => {
		if (this._scrolling) {
			return;
		}

		let dragging = !!event.dataTransfer;
		// Set action cursor on hover
		if (!this.pointerDownPosition) {
			this._hover = null;
			let position = this.pointerEventToPosition(event);
			if (position) {
				let { action, selectAnnotations } = this.getActionAtPosition(position, event);

				let overlay = this._getSelectableOverlay(position);

				let overlayWithPopup = false;
				let clickableOverlay = false;
				if (overlay) {
					if (['citation', 'reference'].includes(overlay.type)
						|| overlay.type === 'internal-link') {
						overlayWithPopup = true;
					}
					if (['internal-link', 'external-link', 'citation'].includes(overlay.type)) {
						clickableOverlay = true;
					}
					if (overlay.type === 'external-link') {
						let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[overlay.position.pageIndex];
						page.div.title = overlay.url;
					}
					this._hover = overlay.position;
				}
				else {
					for (let page of this._iframeWindow.PDFViewerApplication.pdfViewer._pages) {
						if (page.div.title) {
							page.div.title = '';
						}
					}
				}

				if (clickableOverlay) {
					this.updateCursor({ type: 'overlay' });
				}
				else {
					this.updateCursor(action);
				}

				if (overlayWithPopup) {
					if (this._selectedOverlay !== overlay) {
						this._overlayPopupDelayer.open(overlay, async () => {
							this._selectedOverlay = overlay;
							let rect = this.getClientRect(overlay.position.rects[0], overlay.position.pageIndex);
							let overlayPopup = { ...overlay, rect };
							if (overlayPopup.type === 'internal-link') {
								let { image, width, height, x, y } = await this._pdfRenderer?.renderPreviewPage(overlay.destinationPosition);
								overlayPopup.image = image;
								overlayPopup.width = width;
								overlayPopup.height = height;
								overlayPopup.x = x;
								overlayPopup.y = y;
								this._onSetOverlayPopup(overlayPopup);
							}
							else if (['citation', 'reference'].includes(overlay.type)) {
								this._onSetOverlayPopup(overlayPopup);
							}
						});
					}
				}
				else /*if (this._selectedOverlay)*/ {
					this._overlayPopupDelayer.close(() => {
						this._selectedOverlay = null;
						this._onSetOverlayPopup(null);
					});
				}
			}
			else {
				this.updateCursor();
			}
			this._render();
			return;
		}

		this._selectedOverlay = null;
		this._onSetOverlayPopup(null);

		let action = this.action;
		if (!action) {
			return;
		}
		let originalPagePosition = this.pointerEventToAltPosition(event, this.pointerDownPosition.pageIndex);
		let position = this.pointerEventToPosition(event);
		if (!position && action.type === 'moveAndDrag') {
			action.position = null;
			action.triggered = false;
			this._render();
			return;
		}
		if (!position) {
			position = originalPagePosition;
		}
		let page = position && this.getPageByIndex(position.pageIndex);
		if (action.type === 'updateAnnotationRange') {
			action.selectionRanges = getModifiedSelectionRanges(this._pdfPages, action.selectionRanges, position);
			let { sortIndex, position: _position, text } = this._getAnnotationFromSelectionRanges(action.selectionRanges);
			action.annotation = { ...action.annotation, sortIndex, position: _position, text };
			// Use text cursor once action is triggered
			this.updateCursor(action);
			action.triggered = true;
		}
		else if (action.type === 'resize') {
			if (action.annotation.type === 'ink') {
				let [x, y] = originalPagePosition.rects[0];
				let rect = getPositionBoundingRect(action.annotation.position);
				if (action.dir.includes('l')) {
					rect[0] = x;
				}
				else if (action.dir.includes('r')) {
					rect[2] = x;
				}

				if (action.dir.includes('b')) {
					rect[1] = y;
				}
				else if (action.dir.includes('t')) {
					rect[3] = y;
				}

				let r1 = getPositionBoundingRect(action.annotation.position);
				let ratio = (r1[2] - r1[0]) / (r1[3] - r1[1]);
				if (action.dir.length === 2) {
					rect = adjustRectHeightByRatio(rect, ratio, action.dir);
				}
				let r2 = rect;
				let mm = getTransformFromRects(r1, r2);
				action.position = applyTransformationMatrixToInkPosition(mm, action.annotation.position);
				action.triggered = true;
			}
			else if (action.annotation.type === 'image') {
				let rect = action.annotation.position.rects[0].slice();
				let [x, y] = originalPagePosition.rects[0];
				let viewBox = page.originalPage.viewport.viewBox;
				if (action.dir.includes('l')) {
					x = x > rect[2] - MIN_IMAGE_ANNOTATION_SIZE && rect[2] - MIN_IMAGE_ANNOTATION_SIZE || x > viewBox[0] && x || viewBox[0];
				}
				else if (action.dir.includes('r')) {
					x = x < rect[0] + MIN_IMAGE_ANNOTATION_SIZE && rect[0] + MIN_IMAGE_ANNOTATION_SIZE || x < viewBox[2] && x || viewBox[2];
				}
				if (action.dir.includes('b')) {
					y = y > rect[3] - MIN_IMAGE_ANNOTATION_SIZE && rect[3] - MIN_IMAGE_ANNOTATION_SIZE || y > viewBox[1] && y || viewBox[1];
				}
				else if (action.dir.includes('t')) {
					y = y < rect[1] + MIN_IMAGE_ANNOTATION_SIZE && rect[1] + MIN_IMAGE_ANNOTATION_SIZE || y < viewBox[3] && y || viewBox[3];
				}

				if (action.dir.includes('l')) {
					rect[0] = x;
				}
				else if (action.dir.includes('r')) {
					rect[2] = x;
				}

				if (action.dir.includes('b')) {
					rect[1] = y;
				}
				else if (action.dir.includes('t')) {
					rect[3] = y;
				}

				action.position = JSON.parse(JSON.stringify(action.annotation.position));
				action.position.rects = [rect];
				action.triggered = true;
			}
			else if (action.annotation.type === 'text') {
				let rect = action.annotation.position.rects[0].slice();
				let [x, y] = originalPagePosition.rects[0];
				if (action.annotation.position.rotation) {
					let tm = getRotationTransform(rect, action.annotation.position.rotation);
					[x, y] = applyInverseTransform([x, y], tm);
				}

				if (action.dir.includes('l')) {
					rect[0] = x;
				}
				else if (action.dir.includes('r')) {
					rect[2] = x;
				}

				if (action.dir.includes('b')) {
					rect[1] = y;
				}
				else if (action.dir.includes('t')) {
					rect[3] = y;
				}

				let fontSize = 0;
				let r1 = action.annotation.position.rects[0];
				let m1 = getRotationTransform(r1, action.annotation.position.rotation);
				let ratio = (r1[2] - r1[0]) / (r1[3] - r1[1]);
				if (action.dir.length === 2) {
					rect = adjustRectHeightByRatio(rect, ratio, action.dir);
				}
				let r2 = rect;
				let m2 = getRotationTransform(r2, action.annotation.position.rotation);
				let mm = getScaleTransform(r1, r2, m1, m2, action.dir);
				let mmm = transform(m2, mm);
				mmm = inverseTransform(mmm);
				r2 = [
					...applyTransform(r2, m2),
					...applyTransform(r2.slice(2), m2)
				];
				rect = [
					...applyTransform(r2, mmm),
					...applyTransform(r2.slice(2), mmm)
				];
				let scale = calculateScale(action.annotation.position.rects[0], rect);
				if (action.dir.length !== 2) {
					scale = 1;
				}
				fontSize = action.annotation.position.fontSize * scale;
				fontSize = Math.floor(fontSize * 2) / 2;

				action.position = JSON.parse(JSON.stringify(action.annotation.position));
				action.position.rects = [rect];
				if (fontSize) {
					action.position.fontSize = fontSize;
				}
				if (action.dir.length !== 2) {
					action.position = this.adjustTextAnnotationPosition({
						...action.annotation,
						position: action.position
					});
				}
				action.triggered = true;
			}
		}
		else if (action.type === 'rotate') {
			let rect = action.annotation.position.rects[0];
			let rr = position.rects[0];
			let m1 = getRotationTransform(rect, action.annotation.position.rotation);
			rr = getAxialAlignedBoundingBox(rr, inverseTransform(m1));
			let x = rect[0] + (rect[2] - rect[0]) / 2;
			let y = rect[1] + (rect[3] - rect[1]) / 2;
			const angleRadians = -Math.atan2(rr[0] - x, (rr[1] - y));
			const angleDegrees = angleRadians * (180 / Math.PI);
			// Note: Add +180 if handle is moved from top to bottom
			let angle = action.annotation.position.rotation + angleDegrees;
			// Normalize angle
			angle = normalizeDegrees(angle);
			const stickyAngles = [0, 90, 180, 270, 360];
			const threshold = 7;
			for (const rightAngle of stickyAngles) {
				if (Math.abs(angle - rightAngle) <= threshold) {
					angle = rightAngle;
					break;
				}
			}
			if (angle === 360) {
				angle = 0;
			}
			action.position = JSON.parse(JSON.stringify(action.annotation.position));
			action.position.rotation = angle;
			action.triggered = true;
		}
		else if (action.type === 'selectText') {
			if (action.mode === 'chars') {
				this._selectionRanges = getModifiedSelectionRanges(this._pdfPages, this._selectionRanges, position);
			}
			else if (action.mode === 'words') {
				this._selectionRanges = getWordSelectionRanges(this._pdfPages, this.pointerDownPosition, position);
			}
			else if (action.mode === 'lines') {
				this._selectionRanges = getLineSelectionRanges(this._pdfPages, this.pointerDownPosition, position);
			}
			if (this._selectionRanges.length && !this._selectionRanges[0].collapsed) {
				action.triggered = true;
			}
		}
		// Only note and image annotations are supported
		else if (action.type === 'moveAndDrag' && dragging) {
			let rect = getPositionBoundingRect(action.annotation.position);
			let x = originalPagePosition.rects[0][0];
			let y = originalPagePosition.rects[0][1];

			let viewBox = page.originalPage.viewport.viewBox;
			const PADDING = 5;
			x = x > (viewBox[2] - PADDING) && (viewBox[2] - PADDING) || x < (viewBox[0] + PADDING) && (viewBox[0] + PADDING) || x;
			y = y > (viewBox[3] - PADDING) && (viewBox[3] - PADDING) || y < (viewBox[1] + PADDING) && (viewBox[1] + PADDING) || y;

			let dp = [x - rect[0] - action.x, y - rect[1] - action.y];

			if (action.annotation.type === 'ink') {
				let mm = [1, 0, 0, 1, dp[0], dp[1]];
				let position2 = applyTransformationMatrixToInkPosition(mm, action.annotation.position);
				action.position = position2;
			}
			else {
				rect = action.annotation.position.rects[0];
				action.position = {
					pageIndex: originalPagePosition.pageIndex,
					rects: [[
						rect[0] + dp[0],
						rect[1] + dp[1],
						rect[2] + dp[0],
						rect[3] + dp[1],
					]]
				};
			}
			action.triggered = true;
		}
		else if (action.type === 'drag' && dragging) {
			action.triggered = true;
		}
		else if (action.type === 'image') {
			let r1 = this.pointerDownPosition.rects[0];
			let r2 = originalPagePosition.rects[0];
			let [left, bottom, right, top] = page.originalPage.viewport.viewBox;
			action.annotation = {
				type: 'image',
				color: this._tool.color,
				pageLabel: this._getPageLabel(this.pointerDownPosition.pageIndex, true),
				position: {
					pageIndex: this.pointerDownPosition.pageIndex,
					rects: [[
						Math.max(Math.min(r1[0], r2[0]), left),
						Math.max(Math.min(r1[1], r2[1]), bottom),
						Math.min(Math.max(r1[0], r2[0]), right),
						Math.min(Math.max(r1[1], r2[1]), top)
					]]
				}
			};
			action.triggered = true;
		}
		else if (action.type === 'ink') {
			let point = originalPagePosition.rects[0].slice(0, 2);
			action.annotation.position.paths[0].push(...point);
			// Already triggered on pointerdown
		}
		else if (action.type === 'erase') {
			let annotations = [];
			for (let annotation of this._annotations) {
				if (annotation.type === 'ink'
					&& annotation.position.pageIndex === position.pageIndex
					&& !action.annotations.has(annotation.id)) {
					annotations.push(annotation);
				}
			}
			annotations.push(...action.annotations.values());
			let [x, y] = originalPagePosition.rects[0];
			let updatedAnnotations = eraseInk(x, y, this._tool.size, annotations);
			for (let annotation of updatedAnnotations) {
				action.annotations.set(annotation.id, annotation);
			}
			if (updatedAnnotations.length) {
				action.triggered = true;
			}
		}

		if (action.triggered) {
			this._onSetAnnotationPopup();
			// When dragging selection
			this._onSetSelectionPopup();
		}
		this._render();
	}, () => ['ink', 'eraser'].includes(this._tool.type) ? 0 : 50);

	_getAnnotationFromSelectionRanges(selectionRanges, type, color) {
		if (selectionRanges[0].collapsed) {
			return null;
		}
		selectionRanges = selectionRanges.slice();
		selectionRanges.sort((a, b) => a.pageIndex - b.pageIndex);
		selectionRanges = selectionRanges.slice(0, 2);
		let selectionRange = selectionRanges[0];
		let annotation = {
			type,
			color,
			sortIndex: selectionRange.sortIndex,
			pageLabel: this._getPageLabel(selectionRange.position.pageIndex, true),
			position: selectionRange.position,
			text: selectionRange.text
		};
		if (selectionRanges.length === 2) {
			let selectionRange = selectionRanges[1];
			annotation.position.nextPageRects = selectionRange.position.rects;
			annotation.text += ' ' + selectionRange.text;
		}
		return annotation;
	}

	_handlePointerUp(event) {
		this._pointerDownTriggered = false;
		if (!this.action && event.target.classList?.contains('textAnnotation')) {
			return;
		}

		this._overlayPopupDelayer.close(() => {
			this._selectedOverlay = null;
			this._onSetOverlayPopup(null);
		});

		let position = this.pointerEventToPosition(event);

		if (this.pointerDownPosition) {
			// let position = this.pointerEventToAltPosition(event, this.pointerDownPosition.pageIndex);

			if (!this.action.triggered && position) {
				let overlay = this._getSelectableOverlay(position);
				let pointerDownOverlay = this._getSelectableOverlay(this.pointerDownPosition);
				if (overlay && overlay === pointerDownOverlay) {
					if (overlay.type === 'internal-link') {
						this.navigate({ position: overlay.destinationPosition });
					}
					else if (overlay.type === 'external-link') {
						this._onOpenLink(overlay.url);
					}
					else if (overlay.type === 'citation') {
						this.navigate({ position: overlay.references[0].position });
					}
				}
			}

			let action = this.action;
			if (action) {
				if (action.triggered) {
					if (action.type === 'updateAnnotationRange') {
						action.annotation.sortIndex = getSortIndex(this._pdfPages, action.annotation.position);
						this._onUpdateAnnotations([action.annotation]);
					}
					else if (action.type === 'resize') {
						if (action.annotation.type === 'text' && action.dir.length !== 2) {
							action.position = this.adjustTextAnnotationPosition({ ...action.annotation, position: action.position }, { adjustSingleLineWidth: true });
						}

						let sortIndex = getSortIndex(this._pdfPages, action.position);
						this._onUpdateAnnotations([{ id: action.annotation.id, position: action.position, sortIndex }]);
					}
					else if (action.type === 'rotate') {
						let sortIndex = getSortIndex(this._pdfPages, action.position);
						this._onUpdateAnnotations([{ id: action.annotation.id, position: action.position, sortIndex }]);
					}
					else if (action.type === 'moveAndDrag') {
						let sortIndex = getSortIndex(this._pdfPages, action.position);
						this._onUpdateAnnotations([{ id: action.annotation.id, position: action.position, sortIndex }]);
					}
					else if (action.type === 'image' && action.annotation) {
						let rect = action.annotation.position.rects[0];
						let width = rect[2] - rect[0];
						let height = rect[3] - rect[1];
						if (width >= MIN_IMAGE_ANNOTATION_SIZE && height >= MIN_IMAGE_ANNOTATION_SIZE) {
							action.annotation.sortIndex = getSortIndex(this._pdfPages, action.annotation.position);
							this._onAddAnnotation(action.annotation);
						}
					}
					else if (action.type === 'ink' && action.annotation) {
						let lastInkAnnotation = this._annotations.find(x => x.id === this._lastAddedInkAnnotationID);
						let path = action.annotation.position.paths[0];
						path = smoothPath(path);
						path = path.map(value => parseFloat(value.toFixed(3)));
						action.annotation.position.paths[0] = path;
						let dist;
						if (lastInkAnnotation) {
							let r1 = getPositionBoundingRect(lastInkAnnotation.position);
							let r2 = getPositionBoundingRect(action.annotation.position);
							dist = distanceBetweenRects(r1, r2);
						}

						if (lastInkAnnotation
							&& lastInkAnnotation.position.pageIndex === action.annotation.position.pageIndex
							&& lastInkAnnotation.position.width === action.annotation.position.width
							&& lastInkAnnotation.color === action.annotation.color
							&& Date.now() - Date.parse(lastInkAnnotation.dateModified) < 10 * 1000 && dist < 50) {
							let { id, position } = lastInkAnnotation;
							let paths = lastInkAnnotation.position.paths.slice();
							paths.push(action.annotation.position.paths[0]);
							position = { ...position, paths };
							let sortIndex = getSortIndex(this._pdfPages, position);
							this._onUpdateAnnotations([{ id, position, sortIndex }]);
						}
						else {
							action.annotation.sortIndex = getSortIndex(this._pdfPages, action.annotation.position);
							let { id } = this._onAddAnnotation(action.annotation);
							this._lastAddedInkAnnotationID = id;
						}
					}
					else if (action.type === 'erase' && action.triggered) {
						let annotations = [...action.annotations.values()];
						let updated = annotations.filter( x => x.position.paths.length);
						let deleted = annotations.filter( x => !x.position.paths.length);
						if (updated.length) {
							this._onUpdateAnnotations(updated);
						}
						if (deleted.length) {
							this._onDeleteAnnotations(deleted.map(x => x.id));
						}
					}
				}
				else if (position && !this.action.alreadySelectedAnnotations && this._tool.type !== 'eraser') {
					let selectableAnnotations = this.getSelectableAnnotations(position);
					let lastSelectedAnnotationID = this._selectedAnnotationIDs.slice(-1)[0];
					let annotation = selectableAnnotations.find(annotation => annotation.id === lastSelectedAnnotationID);
					if (annotation?.type === 'text') {
						let node = this._iframeWindow.document.querySelector(`[data-id="${annotation.id}"]`);
						if (!node.classList.contains('focusable')) {
							node.classList.add('focusable');
							// node.contentEditable = true;
							// setCaretPosition(event);
							node.focus();
							event.preventDefault();
							event.stopPropagation();
						}
					}
					let nextID;

					let indexOfCurrentID = selectableAnnotations.indexOf(annotation);
					if (indexOfCurrentID !== -1) {
						if (indexOfCurrentID < selectableAnnotations.length - 1) {
							nextID = selectableAnnotations[indexOfCurrentID + 1].id;
						}
						else if (selectableAnnotations.length) {
							nextID = selectableAnnotations[0].id;
						}
					}
					else if (selectableAnnotations.length) {
						nextID = selectableAnnotations[0].id;
					}

					if (nextID) {
						this._onSelectAnnotations([nextID], event);
						this._openAnnotationPopup();
					}
				}
				// This is necessary to clear text selection if the drag action hasn't been triggered
				if (action.selection && action.type === 'drag' && !action.triggered) {
					this._onSelectAnnotations([], event);
				}
				if (action.type === 'selectText') {
					// TODO: Handle triple click as well. Likely there should be a delay when action.mode is 'word'
					if (['highlight', 'underline'].includes(this._tool.type)) {
						if (this._selectionRanges.length && !this._selectionRanges[0].collapsed) {
							let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, this._tool.type, this._tool.color);
							annotation.sortIndex = getSortIndex(this._pdfPages, annotation.position);
							this._onAddAnnotation(annotation);
							this._setSelectionRanges();
						}
					}
					else {
						let selectionRange = this._selectionRanges[0];
						if (selectionRange && !selectionRange.collapsed) {
							let rect = this.getClientRectForPopup(selectionRange.position);
							let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
							annotation.pageLabel = this._getPageLabel(annotation.position.pageIndex, true);
							this._onSetSelectionPopup({ rect, annotation });
							setTextLayerSelection(this._iframeWindow, this._selectionRanges);
						}
					}
				}
			}
			this.action = null;
			this.pointerDownPosition = null;
		}
		// Update cursor after finishing the current action
		if (position) {
			let { action } = this.getActionAtPosition(position, event);
			this.updateCursor(action);
		}
		else {
			this.updateCursor();
		}
		this._render();
		this._updateViewStats();
	}

	cancel() {
		this.setSelection();
		this._hover = null;
		this.action = null;
		this.updateCursor();
		this._render();
	}

	_handleViewAreaUpdate = (event) => {
		let { scale, top, left } = event.location;
		let pageIndex = event.location.pageNumber - 1;
		this._onChangeViewState({
			pageIndex,
			scale,
			top,
			left,
			scrollMode: this._iframeWindow.PDFViewerApplication.pdfViewer.scrollMode,
			spreadMode: this._iframeWindow.PDFViewerApplication.pdfViewer.spreadMode
		});
		if (!this._suspendHistorySaving) {
			this._history.save({ dest: [pageIndex, { name: 'XYZ' }, left, top, null] }, true);
		}
		this._updateViewStats();
	};

	_updateViewStats() {
		let {
			currentPageNumber,
			currentScaleValue,
			pagesCount,
			scrollMode,
			spreadMode
		} = this._iframeWindow.PDFViewerApplication.pdfViewer;

		let pageIndex = currentPageNumber - 1;

		let outlinePath = null;
		// Do not set the outline path if navigation has just been triggered,
		// because the actual location in the document can be different
		if (this._outline && Date.now() - this._lastNavigationTime > 1500) {
			outlinePath = getOutlinePath(this._outline, pageIndex);
		}

		this._onChangeViewStats({
			pageIndex,
			pageLabel: this._getPageLabel(pageIndex),
			pagesCount,
			outlinePath,
			canCopy: !this._isSelectionCollapsed() || this._selectedAnnotationIDs.length,
			canZoomOut: true,
			canZoomIn: true,
			canZoomReset: currentScaleValue !== 'page-width',
			canNavigateBack: this._history.canNavigateBack,
			canNavigateForward: this._history.canNavigateForward,
			canNavigateToFirstPage: currentPageNumber > 1,
			canNavigateToLastPage: currentPageNumber < pagesCount,
			canNavigateToPreviousPage: currentPageNumber > 1,
			canNavigateToNextPage: currentPageNumber < pagesCount,
			zoomAutoEnabled: currentScaleValue === 'auto',
			zoomPageWidthEnabled: currentScaleValue === 'page-width',
			zoomPageHeightEnabled: currentScaleValue === 'page-fit',
			scrollMode,
			spreadMode
		});
		this.a11yRecordCurrentPage();
	}

	_handleContextMenu(event) {
		if (this._options.platform === 'web') {
			return;
		}

		let position = this.pointerEventToPosition(event);
		if (this._options.platform !== 'web' && event.button === 2) {
			// Clear pointer down because the pointer up event won't be received in this iframe
			// when opening a native context menu
			this._pointerDownTriggered = false;
			let br = this._iframe.getBoundingClientRect();
			let selectableAnnotation;
			if (position) {
				selectableAnnotation = (this.getSelectableAnnotations(position) || [])[0];
			}
			let selectedAnnotations = this.getSelectedAnnotations();
			if (!selectableAnnotation) {
				if (this._selectedAnnotationIDs.length !== 0) {
					this._onSelectAnnotations([], event);
				}
				let overlay;
				if (position) {
					overlay = this._getSelectableOverlay(position);
				}
				// If this is a keyboard contextmenu event, its position won't take our
				// text selection into account since we don't use browser selection APIs.
				// Position the menu manually.
				if (event.mozInputSource === 6 && this._selectionRanges.length) {
					const EXTRA_VERTICAL_PADDING = 10;
					let selectionBoundingRect = this.getClientRectForPopup(this._selectionRanges[0].position);
					this._onOpenViewContextMenu({
						x: br.x + selectionBoundingRect[0],
						y: br.y + selectionBoundingRect[3] + EXTRA_VERTICAL_PADDING,
						overlay
					});
				}
				else {
					this._onOpenViewContextMenu({ x: br.x + event.clientX, y: br.y + event.clientY, overlay });
				}
			}
			else if (!selectedAnnotations.includes(selectableAnnotation) && !this._textAnnotationFocused()) {
				this._onSelectAnnotations([selectableAnnotation.id], event);
				this._onOpenAnnotationContextMenu({ ids: [selectableAnnotation.id], x: br.x + event.clientX, y: br.y + event.clientY, view: true });
			}
			else if (!this._textAnnotationFocused()) {
				this._onOpenAnnotationContextMenu({ ids: selectedAnnotations.map(x => x.id), x: br.x + event.clientX, y: br.y + event.clientY, view: true });
			}
			this._render();
		}

		if (!this._textAnnotationFocused()) {
			event.preventDefault();
		}
	}

	_handleKeyDown(event) {
		// TODO: Cursor should be updated on key down/up as well. I.e. for shift and text selection
		// TODO: Arrows keys should modify selection range when holding shift
		if (this._textAnnotationFocused()) {
			return;
		}
		let alt = event.altKey;

		let key = getKeyCombination(event);
		let code = getCodeCombination(event);

		if (event.target.classList.contains('textAnnotation')) {
			return;
		}
		// Set text layer selection again, because previous press of Option-Escape
		// clear the selection and focuses body (that happens in every text in inside
		// Zotero client, but not on actual Firefox)
		if (alt) {
			if (this._selectionRanges.length) {
				setTextLayerSelection(this._iframeWindow, this._selectionRanges);
			}
		}
		// Prevent "open file", "download file" PDF.js keyboard shortcuts
		// https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-shortcuts

		if (['Cmd-o', 'Ctrl-o', 'Cmd-s', 'Ctrl-s'].includes(key)) {
			event.stopPropagation();
			event.preventDefault();
		}
		// Prevent full screen
		else if (['Ctrl-Alt-p', 'Ctrl-Alt-p'].includes(key)) {
			event.stopPropagation();
		}
		// Prevent PDF.js page view rotation
		else if (key === 'r') {
			event.stopPropagation();
		}
		else if (['n', 'j', 'p', 'k'].includes(key)) {
			event.stopPropagation();
		}
		// This is necessary when a page is zoomed in and left/right arrow keys can't change page
		else if (['Alt-ArrowUp'].includes(key)) {
			this.navigateToPreviousPage();
			event.stopPropagation();
			event.preventDefault();
		}
		else if (['Alt-ArrowDown'].includes(key)) {
			this.navigateToNextPage();
			event.stopPropagation();
			event.preventDefault();
		}
		else if (key.startsWith('Shift') && this._selectionRanges.length) {
			// Prevent browser doing its own text selection
			event.stopPropagation();
			event.preventDefault();
			if (key === 'Shift-ArrowLeft') {
				this._setSelectionRanges(getModifiedSelectionRanges(this._pdfPages, this._selectionRanges, 'left'));
			}
			else if (key === 'Shift-ArrowRight') {
				this._setSelectionRanges(getModifiedSelectionRanges(this._pdfPages, this._selectionRanges, 'right'));
			}
			else if (key === 'Shift-ArrowUp') {
				this._setSelectionRanges(getModifiedSelectionRanges(this._pdfPages, this._selectionRanges, 'up'));
			}
			else if (key === 'Shift-ArrowDown') {
				this._setSelectionRanges(getModifiedSelectionRanges(this._pdfPages, this._selectionRanges, 'down'));
			}
			this._render();
		}
		else if (
			!this._readOnly
			&& this._selectedAnnotationIDs.length === 1
			&& !this._annotations.find(x => x.id === this._selectedAnnotationIDs[0])?.readOnly
		) {
			let annotation = this._annotations.find(x => x.id === this._selectedAnnotationIDs[0]);
			let modified = false;

			let { id, type, position } = annotation;
			const STEP = 5; // pt
			const PADDING = 5;
			let viewBox = this._pdfPages[position.pageIndex].viewBox;

			if (
				['note', 'text', 'image', 'ink'].includes(type)
				&& ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
			) {
				let rect;
				if (annotation.type === 'ink') {
					rect = getPositionBoundingRect(position);
				}
				else {
					rect = position.rects[0].slice();
				}
				let dx = 0;
				let dy = 0;
				if (key === 'ArrowLeft' && rect[0] >= STEP + PADDING) {
					dx = -STEP;
				}
				else if (key === 'ArrowRight' && rect[2] <= viewBox[2] - STEP - PADDING) {
					dx = STEP;
				}
				else if (key === 'ArrowDown' && rect[1] >= STEP + PADDING) {
					dy = -STEP;
				}
				else if (key === 'ArrowUp' && rect[3] <= viewBox[3] - STEP - PADDING) {
					dy = STEP;
				}
				if (dx || dy) {
					position = JSON.parse(JSON.stringify(position));
					if (annotation.type === 'ink') {
						let m = [1, 0, 0, 1, dx, dy];
						position = applyTransformationMatrixToInkPosition(m, position);
					}
					else {
						rect[0] += dx;
						rect[1] += dy;
						rect[2] += dx;
						rect[3] += dy;
						position = { ...position, rects: [rect] };
					}
					let sortIndex = getSortIndex(this._pdfPages, position);
					this._onUpdateAnnotations([{ id, position, sortIndex }]);
					this._render();
					this._onSetAnnotationPopup();
				}
				event.stopPropagation();
				event.preventDefault();
			}
			else if (['highlight', 'underline'].includes(type)
				&& ['Shift-ArrowLeft', 'Shift-ArrowRight', 'Shift-ArrowUp', 'Shift-ArrowDown'].includes(key)) {
				let selectionRanges = getSelectionRangesByPosition(this._pdfPages, annotation.position);
				if (key === 'Shift-ArrowLeft') {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'left');
				}
				else if (key === 'Shift-ArrowRight') {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'right');
				}
				else if (key === 'Shift-ArrowUp') {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'up');
				}
				else if (key === 'Shift-ArrowDown') {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'down');
				}

				if (!(selectionRanges.length === 1
					&& selectionRanges[0].anchorOffset >= selectionRanges[0].headOffset)) {
					let annotation2 = this._getAnnotationFromSelectionRanges(selectionRanges, 'highlight');
					let { text, sortIndex, position } = annotation2;
					this._onUpdateAnnotations([{ id, text, sortIndex, position }]);
					this._onSetAnnotationPopup();
				}
				event.stopPropagation();
				event.preventDefault();
			}
			else if (['highlight', 'underline'].includes(type)
				&& (
					isMac() && ['Cmd-Shift-ArrowLeft', 'Cmd-Shift-ArrowRight', 'Cmd-Shift-ArrowUp', 'Cmd-Shift-ArrowDown'].includes(key)
					|| (isWin() || isLinux()) && ['Alt-Shift-ArrowLeft', 'Alt-Shift-ArrowRight', 'Alt-Shift-ArrowUp', 'Alt-Shift-ArrowDown'].includes(key)
				)) {
				let selectionRanges = getSelectionRangesByPosition(this._pdfPages, annotation.position);
				selectionRanges = getReversedSelectionRanges(selectionRanges);
				if (
					isMac() && key === 'Cmd-Shift-ArrowLeft'
					|| (isWin() || isLinux()) && key === 'Alt-Shift-ArrowLeft'
				) {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'left');
				}
				else if (
					isMac() && key === 'Cmd-Shift-ArrowRight'
					|| (isWin() || isLinux()) && key === 'Alt-Shift-ArrowRight'
				) {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'right');
				}
				else if (
					isMac() && key === 'Cmd-Shift-ArrowUp'
					|| (isWin() || isLinux()) && key === 'Alt-Shift-ArrowUp'
				) {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'up');
				}
				else if (
					isMac() && key === 'Cmd-Shift-ArrowDown'
					|| (isWin() || isLinux()) && key === 'Cmd-Shift-ArrowDown'
				) {
					selectionRanges = getModifiedSelectionRanges(this._pdfPages, selectionRanges, 'down');
				}
				if (!(selectionRanges.length === 1
					&& selectionRanges[0].anchorOffset <= selectionRanges[0].headOffset)) {
					let annotation2 = this._getAnnotationFromSelectionRanges(selectionRanges, 'highlight');
					let { text, sortIndex, position } = annotation2;
					this._onUpdateAnnotations([{ id, text, sortIndex, position }]);
					this._onSetAnnotationPopup();
				}
				event.stopPropagation();
				event.preventDefault();
			}
			else if (
				['text', 'image', 'ink'].includes(type)
				&& (
					isMac() && ['Shift-ArrowLeft', 'Shift-ArrowRight', 'Shift-ArrowUp', 'Shift-ArrowDown'].includes(key)
					|| (isWin() || isLinux()) && ['Shift-ArrowLeft', 'Shift-ArrowRight', 'Shift-ArrowUp', 'Shift-ArrowDown'].includes(key)
				)
			) {
				if (type === 'ink') {
					let rect = getPositionBoundingRect(position);
					let r1 = rect.slice();
					let ratio = (rect[2] - rect[0]) / (rect[3] - rect[1]);
					let [, y] = rect;

					if (key === 'Shift-ArrowLeft') {
						rect[2] -= STEP;
						rect[1] += STEP / ratio;
						modified = true;
					}
					else if (key === 'Shift-ArrowRight') {
						rect[2] += STEP;
						rect[1] -= STEP / ratio;
						modified = true;
					}
					else if (key === 'Shift-ArrowDown') {
						modified = true;
						y -= STEP;
						rect[2] += STEP * ratio;
						rect[1] = y;
					}
					else if (key === 'Shift-ArrowUp') {
						y += STEP;
						rect[2] -= STEP * ratio;
						rect[1] = y;
						modified = true;
					}
					if (modified) {
						let r2 = rect;
						let mm = getTransformFromRects(r1, r2);
						position = applyTransformationMatrixToInkPosition(mm, annotation.position);
					}
				}
				else if (type === 'image') {
					let rect = position.rects[0].slice();

					let [, y, x] = rect;
					if (key === 'Shift-ArrowLeft') {
						x -= STEP;
						rect[2] = x < rect[0] + MIN_IMAGE_ANNOTATION_SIZE && rect[0] + MIN_IMAGE_ANNOTATION_SIZE || x;
						modified = true;
					}
					else if (key === 'Shift-ArrowRight') {
						x += STEP;
						rect[2] = x < viewBox[2] && x || viewBox[2];
						modified = true;
					}
					else if (key === 'Shift-ArrowDown') {
						y -= STEP;
						rect[1] = y > viewBox[1] && y || viewBox[1];
						modified = true;
					}
					else if (key === 'Shift-ArrowUp') {
						y += STEP;
						rect[1] = y > rect[3] - MIN_IMAGE_ANNOTATION_SIZE && rect[3] - MIN_IMAGE_ANNOTATION_SIZE || y;
						modified = true;
					}

					if (modified) {
						position = { ...position, rects: [rect] };
					}
				}
				else if (type === 'text') {
					let rect = position.rects[0].slice();
					const MIN_TEXT_ANNOTATION_WIDTH = 10;
					let dir;
					if (key === 'Shift-ArrowLeft') {
						let x = rect[2] - STEP;
						rect[2] = x < rect[0] + MIN_TEXT_ANNOTATION_WIDTH && rect[0] + MIN_TEXT_ANNOTATION_WIDTH || x;
						modified = true;
						dir = 'r';
					}
					else if (key === 'Shift-ArrowRight') {
						rect[2] += STEP;
						modified = true;
						dir = 'r';
					}
					else if (key === 'Shift-ArrowUp') {
						rect[2] -= STEP;
						rect[1] -= STEP;
						modified = true;
						dir = 'br';
					}
					else if (key === 'Shift-ArrowDown') {
						rect[2] += STEP;
						rect[1] += STEP;
						modified = true;
						dir = 'br';
					}

					if (modified) {
						let fontSize = 0;
						let r1 = annotation.position.rects[0];
						let m1 = getRotationTransform(r1, annotation.position.rotation);
						let ratio = (r1[2] - r1[0]) / (r1[3] - r1[1]);
						if (dir.length === 2) {
							rect = adjustRectHeightByRatio(rect, ratio, dir);
						}
						let r2 = rect;
						let m2 = getRotationTransform(r2, annotation.position.rotation);
						let mm = getScaleTransform(r1, r2, m1, m2, dir);
						let mmm = transform(m2, mm);
						mmm = inverseTransform(mmm);
						r2 = [
							...applyTransform(r2, m2),
							...applyTransform(r2.slice(2), m2)
						];
						rect = [
							...applyTransform(r2, mmm),
							...applyTransform(r2.slice(2), mmm)
						];
						let scale = calculateScale(annotation.position.rects[0], rect);
						if (dir.length !== 2) {
							scale = 1;
						}
						fontSize = annotation.position.fontSize * scale;
						fontSize = Math.round(fontSize * 2) / 2;

						position = { ...position, fontSize, rects: [rect] };
						position.rects = [rect];
						if (fontSize) {
							position.fontSize = fontSize;
						}

						if (dir.length !== 2) {
							position = this.adjustTextAnnotationPosition({
								...annotation,
								position
							});
						}
					}
				}
				if (modified) {
					let sortIndex = getSortIndex(this._pdfPages, position);
					this._onUpdateAnnotations([{ id, position, sortIndex }]);
					this._render();
					this._onSetAnnotationPopup();
				}
				event.stopPropagation();
				event.preventDefault();
			}
		}
		else if (
			code === 'Ctrl-Alt-Digit1'
			&& this._selectionRanges.length
			&& !this._selectionRanges[0].collapsed
			&& !this._readOnly
		) {
			let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
			annotation.sortIndex = getSortIndex(this._pdfPages, annotation.position);
			annotation.color = this._tools['highlight'].color;
			this._onAddAnnotation(annotation, true);
			this.navigateToPosition(annotation.position);
			this._setSelectionRanges();
		}
		else if (
			code === 'Ctrl-Alt-Digit2'
			&& this._selectionRanges.length
			&& !this._selectionRanges[0].collapsed
			&& !this._readOnly
		) {
			let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'underline');
			annotation.sortIndex = getSortIndex(this._pdfPages, annotation.position);
			annotation.color = this._tools['underline'].color;
			this._onAddAnnotation(annotation, true);
			this.navigateToPosition(annotation.position);
			this._setSelectionRanges();
		}
		else if (code === 'Ctrl-Alt-Digit3' && !this._readOnly) {

			// 1. Add to this annotation to last selected object, to have it after escape
			// 2. Errors when writing

			let pageIndex = this._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber - 1;
			let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
			let viewBox = page.viewport.viewBox;
			let cx = (viewBox[0] + viewBox[2]) / 2;
			let cy = (viewBox[1] + viewBox[3]) / 2;
			let position = {
				pageIndex,
				rects: [[
					cx - PDF_NOTE_DIMENSIONS / 2,
					cy - PDF_NOTE_DIMENSIONS / 2,
					cx + PDF_NOTE_DIMENSIONS / 2,
					cy + PDF_NOTE_DIMENSIONS / 2
				]]
			};
			let annotation = this._onAddAnnotation({
				type: 'note',
				pageLabel: this._getPageLabel(pageIndex, true),
				sortIndex: getSortIndex(this._pdfPages, position),
				color: this._tools['note'].color,
				position
			});
			if (annotation) {
				this.navigateToPosition(position);
				this._onSelectAnnotations([annotation.id], event);
				this._openAnnotationPopup();
				this._focusedObject = {
					type: 'annotation',
					object: annotation,
					rect: annotation.position.rects[0],
					pageIndex: annotation.position.pageIndex
				};
				this._render();
			}
		}
		else if (code === 'Ctrl-Alt-Digit4' && !this._readOnly) {
			let pageIndex = this._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber - 1;
			let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
			let viewBox = page.viewport.viewBox;
			let cx = (viewBox[0] + viewBox[2]) / 2;
			let cy = (viewBox[1] + viewBox[3]) / 2;
			let fontSize = this._tools['text'].size;
			let position = {
				pageIndex,
				fontSize,
				rotation: 0,
				rects: [[
					cx - fontSize / 2,
					cy - fontSize / 2,
					cx + fontSize / 2,
					cy + fontSize / 2
				]]
			};
			let annotation = this._onAddAnnotation({
				type: 'text',
				pageLabel: this._getPageLabel(pageIndex, true),
				sortIndex: getSortIndex(this._pdfPages, position),
				color: this._tools['text'].color,
				position
			});
			if (annotation) {
				this.navigateToPosition(position);
				this.setSelectedAnnotationIDs([annotation.id]);
				setTimeout(() => {
					this._iframeWindow.document.querySelector(`[data-id="${annotation.id}"]`)?.focus();
				}, 100);
			}
		}
		else if (code === 'Ctrl-Alt-Digit5' && !this._readOnly) {
			let pageIndex = this._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber - 1;
			let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
			let viewBox = page.viewport.viewBox;
			let cx = (viewBox[0] + viewBox[2]) / 2;
			let cy = (viewBox[1] + viewBox[3]) / 2;
			let size = MIN_IMAGE_ANNOTATION_SIZE * 4;
			let position = {
				pageIndex,
				rects: [[
					cx - size / 2,
					cy - size / 2,
					cx + size / 2,
					cy + size / 2
				]]
			};
			let annotation = this._onAddAnnotation({
				type: 'image',
				pageLabel: this._getPageLabel(pageIndex, true),
				sortIndex: getSortIndex(this._pdfPages, position),
				color: this._tools['image'].color,
				position
			}, true);
			if (annotation) {
				this.navigateToPosition(position);
			}
		}

		if (key === 'Escape') {
			if (this.action || this.pointerDownPosition || this._selectionRanges.length) {
				event.preventDefault();
				this.action = null;
				this.pointerDownPosition = null;
				this._setSelectionRanges();
				this._render();
				return;
			}
			else if (this._selectedAnnotationIDs.length) {
				event.preventDefault();
				this._onSelectAnnotations([], event);
				if (this._lastFocusedObject) {
					this._focusedObject = this._lastFocusedObject;
					this._render();
				}
				return;
			}
			else if (this._selectedOverlay) {
				this._selectedOverlay = null;
				this._onSetOverlayPopup(null);
				event.preventDefault();
				return;
			}
			else if (this._focusedObject) {
				event.preventDefault();
				this._clearFocus();
				return;
			}
		}

		if (key === 'Shift-Tab') {
			if (this._focusedObject) {
				this._clearFocus();
			}
			else {
				this._onTabOut(true);
			}
			event.preventDefault();
		}
		else if (key === 'Tab') {
			if (!this._focusedObject && this._isSelectionCollapsed() && !this._selectedAnnotationIDs.length) {
				if (!this._focusNext()) {
					this._onTabOut();
				}
			}
			else {
				// this._clearFocus();
				this._onTabOut();
			}
			event.preventDefault();
		}

		if (this._focusedObject && !this._selectedAnnotationIDs.length) {
			if (key === 'ArrowLeft') {
				this._focusNext('left');
				event.preventDefault();
				event.stopPropagation();
			}
			else if (key === 'ArrowRight') {
				this._focusNext('right');
				event.preventDefault();
				event.stopPropagation();
			}
			if (key === 'ArrowUp') {
				this._focusNext('top');
				event.preventDefault();
				event.stopPropagation();
			}
			if (key === 'ArrowDown') {
				this._focusNext('bottom');
				event.preventDefault();
				event.stopPropagation();
			}
			else if (['Enter', 'Space'].includes(key)) {
				if (this._focusedObject) {
					if (this._focusedObject.type === 'annotation') {
						this._onSelectAnnotations([this._focusedObject.object.id], event);
						this._openAnnotationPopup();
					}
					else if (this._focusedObject.type === 'overlay') {
						let overlay = this._focusedObject.object;
						this._selectedOverlay = overlay;
						let rect = this.getClientRect(overlay.position.rects[0], overlay.position.pageIndex);
						let overlayPopup = { ...overlay, rect };
						if (overlayPopup.type === 'internal-link') {
							(async () => {
								let {
									image,
									width,
									height,
									x,
									y
								} = await this._pdfRenderer?.renderPreviewPage(overlay.destinationPosition);
								overlayPopup.image = image;
								overlayPopup.width = width;
								overlayPopup.height = height;
								overlayPopup.x = x;
								overlayPopup.y = y;
								this._onSetOverlayPopup(overlayPopup);
							})();
						}
						else if (['citation', 'reference'].includes(overlay.type)) {
							this._onSetOverlayPopup(overlayPopup);
						}
						else if (overlay.type === 'external-link') {
							this._onOpenLink(overlay.url);
						}
					}

					event.preventDefault();
					event.stopPropagation();
				}
			}
		}
		else if (this._selectedAnnotationIDs.length === 1) {
			let annotation = this._annotations.find(x => x.id === this._selectedAnnotationIDs[0]);
			if (['Enter'].includes(key)) {
				if (!this._annotationPopup) {
					this._openAnnotationPopup();
					event.preventDefault();
					event.stopPropagation();
				}
				if (annotation.type === 'text') {
					setTimeout(() => {
						this._iframeWindow.document.querySelector(`[data-id="${annotation.id}"]`)?.focus();
					}, 100);
				}
			}
		}
		// These keypresses scroll the content and should change focus for screen readers
		if (!event.shiftKey && ['PageUp', 'PageDown', 'Home', 'End'].includes(key)) {
			this._a11yShouldFocusVirtualCursorTarget = true;
		}

		this._onKeyDown(event);
	}

	_handleDragStart(event) {
		if (this._textAnnotationFocused()) {
			return;
		}
		if (!this.action || !['moveAndDrag', 'drag'].includes(this.action.type)) {
			event.preventDefault();
			return;
		}
		if (!this.action.multiple) {
			let annotation = this.action.annotation;
			let canvas = this._dragCanvas;
			if (annotation.type === 'text') {
				let ctx = canvas.getContext('2d');
				let pixelRatio = window.devicePixelRatio;
				canvas.width = 12 * pixelRatio;
				canvas.height = 12 * pixelRatio;
				canvas.style.width = 12 + 'px';
				canvas.style.height = 12 + 'px';
				// ctx.fillStyle = annotation.color;
				// ctx.transform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
				// ctx.beginPath();
				// let p = new Path2D('M1.4375 0.4375C1.15866 0.4375 0.9375 0.658658 0.9375 0.9375L0.9375 2.46875C0.9375 2.74759 1.15866 2.96875 1.4375 2.96875L1.9375 2.96875C2.21634 2.96875 2.4375 2.74759 2.4375 2.46875L2.4375 1.9375L4.96875 1.9375L4.96875 10.0312L4.46875 10.0312C4.18991 10.0313 3.9375 10.2524 3.9375 10.5312L3.9375 11.0312C3.9375 11.3101 4.18991 11.5625 4.46875 11.5625L5.96875 11.5625L7.5 11.5625C7.77884 11.5625 8 11.3101 8 11.0312L8 10.5312C8 10.2524 7.77884 10.0312 7.5 10.0312L7 10.0312L7 1.9375L9.5 1.9375L9.5 2.46875C9.5 2.74759 9.72116 2.96875 10 2.96875L10.5312 2.96875C10.8101 2.96875 11.0312 2.74759 11.0312 2.46875L11.0312 0.9375C11.0312 0.658658 10.8101 0.4375 10.5312 0.4375L10.0312 0.4375L5.96875 0.4375L1.9375 0.4375L1.4375 0.4375Z');
				// ctx.fill(p);
				event.dataTransfer.setDragImage(canvas, 12, 6);
			}
			else {
				let page = this.getPageByIndex(annotation.position.pageIndex);
				page.renderAnnotationOnCanvas(annotation, canvas);
				// When window.devicePixelRatio > 1, Chrome uses CSS pixels when positioning
				// image with setDragImage, while Safari/Firefox uses physical pixels. Weird.
				let pixelRatio = (isSafari || isFirefox || 1) ? window.devicePixelRatio : 1;
				let rect = getPositionBoundingRect(annotation.position);
				let width = rect[2] - rect[0];
				let scale = (canvas.width / pixelRatio) / width;
				event.dataTransfer.setDragImage(canvas, this.action.x * scale, (canvas.height / pixelRatio) - this.action.y * scale);
			}
		}

		if (this._selectionRanges.length <= 2) {
			this._onSetDataTransferAnnotations(event.dataTransfer, this.action.annotation);
		}
		else {
			// Only drag text when selection spans over more than 2 pages
			let fullText = getTextFromSelectionRanges(this._selectionRanges);
			event.dataTransfer.clearData();
			event.dataTransfer.setData('text/plain', fullText);
		}
	}

	_handleDragOver(event) {
		if (this._textAnnotationFocused()) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
	}

	_handleDragEnd(event) {
		if (event.dataTransfer.dropEffect === 'none') {
			this.action = null;
		}
		this._handlePointerUp(event);
	}

	_handleDrop(event) {

	}

	_handleCopy(event) {
		if (this._textAnnotationFocused()) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (!event.clipboardData) {
			return;
		}
		// Copying annotation
		if (this._selectedAnnotationIDs.length) {
			let annotation = this._annotations.find(x => x.id === this._selectedAnnotationIDs[0]);
			if (!annotation) {
				return;
			}
			this._onSetDataTransferAnnotations(event.clipboardData, annotation);
		}
		// Copying text
		else {
			if (this._selectionRanges.length <= 2) {
				let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
				if (!annotation) {
					return;
				}
				this._onSetDataTransferAnnotations(event.clipboardData, annotation, true);
			}
			else {
				// Only copy text when selection spans over more than 2 pages
				let fullText = getTextFromSelectionRanges(this._selectionRanges);
				event.clipboardData.setData('text/plain', fullText);
			}
		}
	}

	_handleInput(event) {
		let target = event.target;
		if (target.classList.contains('textAnnotation')) {
			let id = target.getAttribute('data-id');
			let comment = target.value;
			target.setAttribute('data-comment', comment);
			this._onUpdateAnnotations([{ id, comment }]);

		}
	}

	getDragMultiIcon() {
		let canvas = this._dragCanvas;

		let context = canvas.getContext('2d');

		canvas.width = 100;
		canvas.height = 20;

		context.fillStyle = '#333333';
		context.fillRect(0, 0, canvas.width, canvas.height);

		context.fillStyle = '#999999';
		context.font = 'bold 13px Arial';
		context.fillText('DRAGGING...', 5, 15);

		return canvas;
	}

	pointerEventToPosition(event) {
		let target = this._iframeWindow.document.elementFromPoint(event.clientX, event.clientY);
		if (!target) {
			return null;
		}

		let div = target.closest('.page');
		if (!div) {
			return null;
		}

		let pageIndex = this._iframeWindow.PDFViewerApplication.pdfViewer._pages.findIndex(x => x.div === div);
		if (pageIndex < 0) {
			return null;
		}

		let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let rect = page.div.getBoundingClientRect();
		// TODO: Use getBoundingClientRect to get position without constants
		let x = event.clientX + page.div.scrollLeft - rect.left;
		let y = event.clientY + page.div.scrollTop - rect.top;
		let pp = { pageIndex, rects: [[x, y, x, y]] };
		return v2p(pp, page.viewport);
	}

	// Get position outside the current page
	pointerEventToAltPosition(event, pageIndex, action) {
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let rect = page.div.getBoundingClientRect();
		let x = event.clientX + page.div.scrollLeft - rect.left;
		let y = event.clientY + page.div.scrollTop - rect.top;
		let pageRect = page.pdfPage.view;

		if (action) {
			let tm = getRotationTransform(action.annotation.position.rects[0], action.annotation.position.rotation);
			[x, y] = this.getPdfPoint([x, y], pageIndex, tm);
		}
		else {
			[x, y] = page.viewport.convertToPdfPoint(x, y);
		}

		// Keep the position inside the page
		// x = x > pageRect[2] && pageRect[2] || x > pageRect[0] && x || pageRect[0];
		// y = y > pageRect[3] && pageRect[3] || y > pageRect[1] && y || pageRect[1];
		return { pageIndex, rects: [[x, y, x, y]] };
	}

	_textAnnotationFocused() {
		return this._iframeWindow.document.activeElement.classList.contains('textAnnotation');
	}

	setScrollMode(mode) {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('switchscrollmode', { mode });
	}

	setSpreadMode(mode) {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('switchspreadmode', { mode });
	}

	async setSidebarView(sidebarView) {
		// Don't process outline in the secondary view. It will get outline using state over setOutline
		if (!this._primary) {
			return;
		}
		if (sidebarView === 'outline' && !this._outline) {
			await this._iframeWindow.PDFViewerApplication.initializedPromise;
			// TODO: Properly wait for pdfDocument initialization
			if (!this._iframeWindow.PDFViewerApplication.pdfDocument) {
				setTimeout(() => this.setSidebarView('outline'), 1000);
				return;
			}
			let outline = await this._iframeWindow.PDFViewerApplication.pdfDocument.getOutline2();
			this._onSetOutline(outline);
		}
	}

	setOutline(outline) {
		this._outline = outline;
	}

	async _getPositionFromDestination(dest) {
		const pdfDocument = this._iframeWindow.PDFViewerApplication.pdfDocument;
		if (!pdfDocument || !dest) {
			throw new Error("No PDF document available or invalid destination provided.");
		}

		let destArray;

		// If the destination is a string, it's a named destination.
		// We'll need to resolve it to get the actual destination array.
		if (typeof dest === 'string') {
			destArray = await pdfDocument.getDestination(dest);
			if (!destArray) {
				throw new Error(`Unable to resolve named destination: "${dest}"`);
			}
		} else {
			destArray = dest;
		}

		const ref = destArray[0];
		const pageNumber = await pdfDocument.getPageIndex(ref) + 1;

		const pageView = this._iframeWindow.PDFViewerApplication.pdfViewer.getPageView(pageNumber - 1);
		if (!pageView) {
			throw new Error(`"${pageNumber}" is not a valid pageNumber.`);
		}

		let x = 0, y = 0;
		const changeOrientation = pageView.rotation % 180 !== 0;
		const PixelsPerInch = { PDF_TO_CSS_UNITS: 96 / 72 }; // Assuming default values here
		const pageHeight = (changeOrientation ? pageView.width : pageView.height) / pageView.scale / PixelsPerInch.PDF_TO_CSS_UNITS;

		switch (destArray[1].name) {
			case "XYZ":
				x = destArray[2] !== null ? destArray[2] : 0;
				y = destArray[3] !== null ? destArray[3] : pageHeight;
				break;
			case "Fit":
			case "FitB":
				break;
			case "FitH":
			case "FitBH":
				y = destArray[2] !== null ? destArray[2] : pageHeight;
				break;
			case "FitV":
			case "FitBV":
				x = destArray[2] !== null ? destArray[2] : 0;
				break;
			case "FitR":
				x = destArray[2];
				y = destArray[5];
				break;
			default:
				console.error(`"${destArray[1].name}" is not a valid destination type.`);
				return;
		}

		return {
			pageIndex: pageNumber - 1,
			x,
			y,
		};
	}

	adjustTextAnnotationPosition(annotation, options) {
		let { pageIndex } = annotation.position;
		let originalPage = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let { viewBox } = originalPage.viewport;
		return adjustTextAnnotationPosition(annotation, viewBox, options);
	}
}

export default PDFView;
