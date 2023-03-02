import Page from './page';
import { Extractor } from './lib/extract';
import { v2p } from './lib/coordinates';
import {
	getLineSelectionRanges,
	getModifiedSelectionRanges,
	getReversedSelectionRanges,
	getSelectionRangeHandles,
	getSelectionRanges,
	getSelectionRangesByPosition,
	getWordSelectionRanges,
	setTextLayerSelection
} from './selection';
import {
	getPageIndexesFromAnnotations,
	getPositionBoundingRect,
	intersectAnnotationWithPoint,
	quickIntersectRect
} from './lib/utilities';
import {
	getAffectedAnnotations,
	isFirefox,
	isMac,
	isSafari,
	pressedNextKey,
	pressedPreviousKey,
	throttle
} from '../common/lib/utilities';
import { AutoScroll } from './lib/auto-scroll';
import { PDFThumbnails } from './pdf-thumbnails';
import { PDF_NOTE_DIMENSIONS } from '../common/defines';
import PDFRenderer from './pdf-renderer';
import { drawAnnotationsOnCanvas } from './lib/render';
import PopupDelayer from '../common/lib/popup-delayer';

class PDFView {
	constructor(options) {
		this._options = options;
		this._primary = options.primary;
		this._portal = options.portal;
		this._container = options.container;
		this._password = options.password;
		this._onRequestPassword = options.onRequestPassword;
		this._onSetThumbnails = options.onSetThumbnails;
		this._onSetOutline = options.onSetOutline;
		this._onChangeViewState = options.onChangeViewState;
		this._onChangeViewStats = options.onChangeViewStats;
		this._onSetDataTransferAnnotations = options.onSetDataTransferAnnotations;
		this._onAddAnnotation = options.onAddAnnotation;
		this._onUpdateAnnotations = options.onUpdateAnnotations;
		this._onOpenLink = options.onOpenLink;
		this._onSelectAnnotations = options.onSelectAnnotations;
		this._onSetSelectionPopup = options.onSetSelectionPopup;
		this._onSetAnnotationPopup = options.onSetAnnotationPopup;
		this._onSetOverlayPopup = options.onSetOverlayPopup;
		this._onSetFindState = options.onSetFindState;
		this._onOpenViewContextMenu = options.onOpenViewContextMenu;
		this._onKeyUp = options.onKeyUp;
		this._onKeyDown = options.onKeyDown;

		this._onTabOut = options.onTabOut;

		this._viewState = options.viewState || { pageIndex: 3, scale: "page-width", scrollMode: 0, spreadMode: 0 };
		this._location = options.location;

		this._tool = options.tool;

		this._pageLabels = options.pageLabels;

		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		this._annotations = options.annotations;

		this._pages = [];

		this._focusedObject = null;
		this._lastFocusedObject = null;

		this._findState = options.findState;

		if (this._primary) {
			this._pdfRenderer = new PDFRenderer({ pdfView: this });
		}

		this._overlayPopupDelayer = new PopupDelayer({ open: !!this._overlayPopup });

		// this._annotations = [];

		this._activeOverlay = null;

		this._selectionRanges = [];

		this._iframe = document.createElement('iframe');
		this._iframe.src = 'pdf/web/viewer.html';
		//
		// if (!this._portal) {
		// 	this._iframe.setAttribute('data-tabstop', true);
		// 	this._iframe.tabIndex = -1;
		// }
		this._iframeWindow = null;

		let setOptions = () => {
			this._iframeWindow.PDFViewerApplicationOptions.set('isEvalSupported', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('defaultUrl', '');
			this._iframeWindow.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
			this._iframeWindow.PDFViewerApplicationOptions.set('cMapPacked', true);
			// this._iframeWindow.PDFViewerApplicationOptions.set('workerSrc', './pdf.worker.js');
			this._iframeWindow.PDFViewerApplicationOptions.set('historyUpdateUrl', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('textLayerMode', 1);
			this._iframeWindow.PDFViewerApplicationOptions.set('sidebarViewOnLoad', 0);
			this._iframeWindow.PDFViewerApplicationOptions.set('ignoreDestinationZoom', true);
			this._iframeWindow.PDFViewerApplicationOptions.set('renderInteractiveForms', false);
			this._iframeWindow.PDFViewerApplicationOptions.set('printResolution', 300);
		};

		window.addEventListener('webviewerloaded', () => {
			this._iframeWindow = this._iframe.contentWindow;
			setOptions();
		});

		this._iframe.addEventListener('load', () => {
			this._iframeWindow.onAttachPage = this._attachPage.bind(this);
			this._iframeWindow.onDetachPage = this._detachPage.bind(this);
			this._init();
			this._iframeWindow.PDFViewerApplication.open(options.buf, { password: this._password });
			window.PDFViewerApplication = this._iframeWindow.PDFViewerApplication;
			window.if = this._iframeWindow;

			if (this._portal) {
				this._iframeWindow.document.body.classList.add('portal');
			}

			this._iframeWindow.document.getElementById('viewerContainer').addEventListener('scroll', (event) => {
				let x = event.target.scrollLeft;
				let y = event.target.scrollTop;

				if (this._overlayPopup) {
					this._onSetOverlayPopup();
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
						this._onSetSelectionPopup({ rect });
					}
				}
			});

			this._iframeWindow.addEventListener('focus', (event) => {
				options.onFocus();
			});
		});

		this._options.container.append(this._iframe);
	}

	async _init() {
		this._iframeWindow.document.body.draggable = true;


		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keyup', this._onKeyUp);
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('mousedown', this._handlePointerDown.bind(this), true);
		this._iframeWindow.addEventListener('pointermove', this._handlePointerMove.bind(this), { passive: true });
		this._iframeWindow.addEventListener('pointerup', this._handlePointerUp.bind(this));
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		this._iframeWindow.addEventListener('dragend', this._handlePointerUp.bind(this));
		this._iframeWindow.addEventListener('dragover', this._handlePointerMove.bind(this), { passive: true });
		this._iframeWindow.addEventListener('drop', this._handleDrop.bind(this), { capture: true });
		this._iframeWindow.addEventListener('copy', this._handleCopy.bind(this));

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
		this._iframeWindow.PDFViewerApplication.eventBus.on('updatefindmatchescount', this._updateFindMatchesCount.bind(this));
		this._iframeWindow.PDFViewerApplication.eventBus.on('updatefindcontrolstate', this._updateFindControlState.bind(this));
	}

	async _init2() {
		let items = await this._iframeWindow.PDFViewerApplication.pdfDocument.getOutline();

		function transformItems(items) {
			let newItems = [];
			for (let item of items) {
				let newItem = {
					title: item.title,
					location: {
						dest: item.dest
					},
					items: transformItems(item.items),
					expanded: false
				};
				newItems.push(newItem);
			}
			return newItems;
		}

		if (items) {
			let outline = transformItems(items);

			if (outline.length === 1) {
				for (let item of outline) {
					item.expanded = true;
				}
			}

			this._onSetOutline(outline);
		}

		this._init2 = null;


		this._iframeWindow.PDFViewerApplication.eventBus.on('updateviewarea', this._handleViewAreaUpdate.bind(this));
		this._updateViewStats();
	}

	async _handleDocumentInit() {
		if (this._viewState) {
			this._setState(this._viewState, !!this._location);
		}
		// Default state
		else {
			this._iframeWindow.PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width';
		}

		if (this._location) {
			this.navigate(this._location);
		}
	}

	_updateFindMatchesCount({ matchesCount }) {
		let result = { total: matchesCount.total, index: matchesCount.current - 1 };
		if (this._pdfjsFindState === 3) {
			result = null;
		}
		this._onSetFindState({ ...this._findState, result });
	}

	_updateFindControlState({ matchesCount, state, rawQuery }) {
		this._pdfjsFindState = state;
		let result = { total: matchesCount.total, index: matchesCount.current - 1 };
		if (this._pdfjsFindState === 3 || !rawQuery.length) {
			result = null;
		}
		this._onSetFindState({ ...this._findState, result });
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
				this._onSetThumbnails(thumbnails);
			}
		});
	}

	async _attachPage(originalPage) {
		this._init2 && this._init2();
		if (this._primary && !this._portal && !this._pdfThumbnails) {
			this._initThumbnails();
		}
		if (!this._extractor) {
			this._extractor = new Extractor(this._iframeWindow.PDFViewerApplication.pdfViewer, []);
		}
		this._detachPage(originalPage);
		let page = new Page(this, originalPage);
		await page.updateData();
		this._pages.push(page);
		this._updateAnnotationTextSelectionData();
		this._render();
	}

	_detachPage(originalPage) {
		this._pages = this._pages.filter(x => x.originalPage !== originalPage);
	}

	_clearFocus() {
		this._focusedObject = null;
		this._render();
	}

	_focusNext(reverse) {
		let objects = [...this._annotations];
		if (this._focusedObject) {
			if (reverse) {
				objects.reverse();
			}

			let index = objects.findIndex(x => x === this._focusedObject);
			if (index === -1) {

			}
			if (index < objects.length - 1) {
				this._focusedObject = objects[index + 1];
				this.navigateToPosition(this._focusedObject.position);
			}
		}
		else {
			let pageIndex = this._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber - 1;
			let pageObjects = objects.filter(x => x.position.pageIndex === pageIndex);
			if (pageObjects.length) {
				this._focusedObject = pageObjects[0];
				this.navigateToPosition(this._focusedObject.position);
			}
		}

		this._lastFocusedObject = this._focusedObject;

		this._render();

		return !!this._focusedObject;
	}

	setSelection(selection) {
		this.selection = selection;
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

	_updateAnnotationTextSelectionData() {
		let annotations = this.getSelectedAnnotations();
		if (annotations.length === 1) {
			let annotation = annotations[0];
			if (annotation.type === 'highlight') {
				let selectionRanges = getSelectionRangesByPosition(this._extractor, annotation.position);
				if (selectionRanges.length) {
					let handles = getSelectionRangeHandles(this._extractor, selectionRanges);
					this._annotationTextSelectionData = { selectionRanges, handles };
					return;
				}
			}
		}
		this._annotationTextSelectionData = null;
	}

	focus() {
		this._iframe.focus();
		// this._iframeWindow.focus();
	}

	renderPageAnnotationsOnCanvas(canvas, viewport, pageIndex) {
		let annotations = this._annotations.filter(x => x.position.pageIndex === pageIndex);
		drawAnnotationsOnCanvas(canvas, viewport, annotations);
	}

	navigateToPosition(position) {
		let pageIndex = this._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber - 1;
		let element = this._iframeWindow.document.getElementById('viewerContainer');

		let rect = this.getPositionBoundingViewRect(position);


		let { scrollTop, scrollLeft } = element;

		let viewRect = [scrollLeft, scrollTop, element.clientWidth + scrollLeft, element.clientHeight + scrollTop];

		let padding = 10;

		let left = scrollLeft;
		let top = scrollTop;

		if (rect[1] < viewRect[1]) {
			top = scrollTop - (viewRect[1] - rect[1]) - padding;
		}
		else if (rect[3] > viewRect[3]) {
			top = scrollTop + (rect[3] - viewRect[3]) + padding;
		}

		if (rect[0] < viewRect[0]) {
			left = scrollLeft - (viewRect[0] - rect[0]) + padding;
		}
		else if (rect[2] > viewRect[2]) {
			left = scrollLeft + (rect[2] - viewRect[2]) - padding;
		}

		// // Scroll the element smoothly
		element.scrollTo({
			left,
			top,
			behavior: Math.abs(pageIndex - position.pageIndex) <= 1 ? 'smooth' : 'auto'
		});
	}

	setPageLabels(pageLabels) {
		this._pageLabels = pageLabels;
	}

	setTool(tool) {
		if (tool.type === 'hand') {
			this._iframeWindow.PDFViewerApplication.pdfCursorTools.switchTool(1);
		}
		else {
			this._iframeWindow.PDFViewerApplication.pdfCursorTools.switchTool(0);
		}
		this._tool = tool;
	}

	setAnnotations(annotations) {
		let affected = getAffectedAnnotations(this._annotations, annotations, true);
		this._annotations = annotations;
		this._updateAnnotationTextSelectionData();
		let { created, updated, deleted } = affected;
		let all = [...created, ...updated, ...deleted];
		let pageIndexes = getPageIndexesFromAnnotations(all);
		this._render(pageIndexes);
		if (this._primary) {
			this._pdfThumbnails.render(pageIndexes, true);
			this._pdfRenderer.start();
		}
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
			this._iframeWindow.PDFViewerApplication.eventBus.dispatch('findbarclose', { source: this._iframeWindow });
		}

		if (state.active) {
			if (this._findState.query !== state.query
				|| this._findState.highlightAll !== state.highlightAll
				|| this._findState.caseSensitive !== state.caseSensitive
				|| this._findState.entireWord !== state.entireWord
				|| this._findState.active !== state.active) {
				this._iframeWindow.PDFViewerApplication.eventBus.dispatch('find', {
					source: this._iframeWindow,
					type: 'find',
					query: state.query,
					phraseSearch: true,
					caseSensitive: state.caseSensitive,
					entireWord: state.entireWord,
					highlightAll: state.highlightAll,
					findPrevious: false
				});
			}
		}

		this._findState = state;
	}

	findNext() {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('find', {
			source: this._iframeWindow,
			type: 'again',
			query: this._findState.query,
			phraseSearch: true,
			caseSensitive: this._findState.caseSensitive,
			entireWord: this._findState.entireWord,
			highlightAll: this._findState.highlightAll,
			findPrevious: false
		});
	}

	findPrevious() {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('find', {
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

	setSelectedAnnotationIDs(ids) {
		this._selectedAnnotationIDs = ids;
		this._updateAnnotationTextSelectionData();
		this._setSelectionRanges();
		this._clearFocus();

		this._render();

		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._onSetAnnotationPopup();
	}

	_openAnnotationPopup(annotation) {
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
		this._onSetSelectionPopup();
	}

	_isSelectionCollpased() {
		return !this._selectionRanges.length || this._selectionRanges[0].collapsed;
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

	navigate(location) {
		if (location.annotationID) {
			let annotation = this._annotations.find(x => x.id === location.annotationID);
			if (annotation) {
				this.navigateToPosition(annotation.position);
			}
		}
		else if (location.dest) {
			this._iframeWindow.PDFViewerApplication.pdfLinkService.goToDestination(location.dest);
		}
		else if (location.position) {
			this.navigateToPosition(location.position);
			this._highlightedPosition = location.position;
			this._render();
			setTimeout(() => {
				this._highlightedPosition = null;
				this._render();
			}, 2000);
		}
		else if (Number.isInteger(location.pageIndex)) {
			this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({
				pageNumber: location.pageIndex + 1
			});
		}
		else if (location.pageLabel) {

		}
		else if (location.pageNumber) {
			let pageIndex = this._pageLabels.findIndex(x => x === location.pageNumber);
			if (pageIndex === -1) {
				if (parseInt(location.pageNumber) == location.pageNumber) {
					pageIndex = parseInt(location.pageNumber) - 1;
				}
			}
			if (pageIndex !== -1) {
				this._iframeWindow.PDFViewerApplication.pdfViewer.scrollPageIntoView({
					pageNumber: pageIndex + 1
				});
			}
		}
	}

	navigateBack() {
		this._iframeWindow.history.back();
	}

	navigateForward() {
		this._iframeWindow.history.forward();
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

	getViewPoint(point, pageIndex) {
		let viewport = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex].viewport;
		return viewport.convertToViewportPoint(...point);
	}

	getViewRect(rect, pageIndex) {
		let viewport = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex].viewport;
		let [x1, y2] = viewport.convertToViewportPoint(...rect);
		let [x2, y1] = viewport.convertToViewportPoint(...rect.slice(2, 4));
		return [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];
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
		let pr = page.div.firstChild.getBoundingClientRect();


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
			let pr = page.div.firstChild.getBoundingClientRect();
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
			pr = page.div.firstChild.getBoundingClientRect();
		}
		return [
			pr.x + r[0],
			pr.y + r[1],
			pr.x + r[2],
			pr.y + r[3],
		];
	}

	getSelectedAnnotationAction(annotation, position) {
		let dd = 10;

		let p = this.getViewPoint(position.rects[0], position.pageIndex);


		p = [p[0], p[1], p[0], p[1]];

		if (annotation.type === 'highlight' && this._annotationTextSelectionData) {
			let { selectionRanges, handles } = this._annotationTextSelectionData;
			let padding = 3;
			for (let handle of handles) {
				let rect = this.getViewRect(handle.rect, handle.pageIndex);
				let vertical = rect[1] === rect[3];
				if (vertical) {
					rect[1] -= padding;
					rect[3] += padding;
				}
				else {
					rect[0] -= padding;
					rect[2] += padding;
				}
				if (quickIntersectRect(rect, p)) {
					if (handle === handles[0]) {
						selectionRanges = getReversedSelectionRanges(selectionRanges);
					}
					return { type: 'updateAnnotationRange', selectionRanges, annotation, vertical };
				}
			}
		}
		else if (annotation.type === 'image') {
			let r = annotation.position.rects[0];
			let bottomLeft = this.getViewPoint([r[0], r[1]], position.pageIndex);
			let bottomRight = this.getViewPoint([r[2], r[1]], position.pageIndex);
			let topLeft = this.getViewPoint([r[0], r[3]], position.pageIndex);
			let topRight = this.getViewPoint([r[2], r[3]], position.pageIndex);
			let middleLeft = this.getViewPoint([r[0], r[1] + (r[3] - r[1]) / 2], position.pageIndex);
			let middleRight = this.getViewPoint([r[2], r[1] + (r[3] - r[1]) / 2], position.pageIndex);
			let middleTop = this.getViewPoint([r[0] + (r[2] - r[0]) / 2, r[3]], position.pageIndex);

			let bottomLeftRect = [bottomLeft[0] - dd, bottomLeft[1] - dd, bottomLeft[0] + dd, bottomLeft[1] + dd];
			let bottomRightRect = [bottomRight[0] - dd, bottomRight[1] - dd, bottomRight[0] + dd, bottomRight[1] + dd];
			let topLeftRect = [topLeft[0] - dd, topLeft[1] - dd, topLeft[0] + dd, topLeft[1] + dd];
			let topRightRect = [topRight[0] - dd, topRight[1] - dd, topRight[0] + dd, topRight[1] + dd];

			let leftRect = [bottomLeft[0] - dd, topLeft[1], topLeft[0] + dd, bottomLeft[1]];
			let rightRect = [bottomRight[0] - dd, topRight[1] - dd, topRight[0] + dd, bottomRight[1] + dd];
			let topRect = [topLeft[0], topLeft[1] - dd, topRight[0], topRight[1] + dd];
			let bottomRect = [bottomLeft[0], bottomLeft[1] - dd, bottomRight[0], bottomRight[1] + dd];

			let dir;
			if (quickIntersectRect(topRightRect, p)) {
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
			else if (quickIntersectRect(leftRect, p)) {
				dir = 'l';
			}
			else if (quickIntersectRect(rightRect, p)) {
				dir = 'r';
			}
			else if (quickIntersectRect(topRect, p)) {
				dir = 't';
			}
			else if (quickIntersectRect(bottomRect, p)) {
				dir = 'b';
			}

			if (dir) {
				return { type: 'resize', annotation, dir };
			}
		}

		if (intersectAnnotationWithPoint(annotation.position, position)) {
			let r = position.rects[0];
			let br = getPositionBoundingRect(annotation.position);
			return { type: 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1] };
		}

		return null;
	}

	getMoveAction(annotation, position) {
		let r = position.rects[0];
		let br = getPositionBoundingRect(annotation.position);
		return { type: 'move', annotation, x: r[0] - br[0], y: r[1] - br[1] };
	}

	_getSelectableOverlay(position) {
		let page = this.getPageByIndex(position.pageIndex);
		if (!page) {
			return;
		}
		for (let overlay of page.overlays) {
			if (intersectAnnotationWithPoint(overlay.position, position)) {
				return overlay;
			}
		}
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
			if (intersectAnnotationWithPoint(annotation.position, position)) {
				selectableAnnotations.push(annotation);
			}
		}

		function getAnnotationAreaSize(annotation) {
			let areaSize = 0;
			for (let rect of annotation.position.rects) {
				areaSize += (rect[2] - rect[0]) * (rect[3] - rect[1]);
			}
			return areaSize;
		}

		selectableAnnotations.sort((a, b) => {
			let aSize, bSize;

			if (a.position.rects) {
				aSize = getAnnotationAreaSize(a);
			}
			else if (a.position.paths) {
				aSize = 0;
			}

			if (b.position.rects) {
				bSize = getAnnotationAreaSize(b);
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
		if (this._portal) {
			let action = { type: 'none' };
			return { action, selectAnnotations: [] };
		}
		if (this._selectionRanges.length) {
			let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
			if (annotation && intersectAnnotationWithPoint(annotation.position, position)) {
				let r = position.rects[0];
				let br = getPositionBoundingRect(annotation.position);
				let action = { type: 'drag', annotation, x: r[0] - br[0], y: r[1] - br[1], selection: true };
				return { action, selectAnnotations: [] };
			}
		}

		let overlay = this._getSelectableOverlay(position);
		if (overlay) {
			let action = { type: 'overlay', overlay };
			return { action, selectAnnotations: [] };
		}

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

		let selectableAnnotation = this.getSelectableAnnotations(position)[0];

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
				if (['note'].includes(annotation.type)) {
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

			if (this._tool.type === 'highlight') {
				action = { type: 'highlight' };
			}
			else if (this._tool.type === 'note') {
				action = { type: 'note' };
			}
			else if (this._tool.type === 'image') {
				action = { type: 'image' };
			}
			else {
				action = { type: 'selectText' };
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
			else if (action.type === 'move') {
				cursor = 'grab';
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
		this._highlightedPosition = null;

		// Clear textLayer selection
		this._iframeWindow.getSelection().removeAllRanges();

		// Prevents showing focus box after pressing Enter and de-selecting annotation which was select with mouse
		this._lastFocusedObject = null;

		if (!event.target.closest('#viewerContainer')) {
			return;
		}

		if (event.button === 2) {
			let br = this._iframe.getBoundingClientRect();
			// Trigger view context menu after focus even fires and focuses the current view
			setTimeout(() => this._onOpenViewContextMenu({ x: br.x + event.clientX, y: br.y + event.clientY }));
			return;
		}

		let shift = event.shiftKey;
		let position = this.pointerEventToPosition(event);
		if (!position) {
			this.setSelection();
			this._render();
			return;
		}
		// If right click, just select single object under the click
		if (event.button === 2) {
			let selectableObject = this.getSelectableAnnotations(position)[0];
			let selectedObjects = this.getSelectedObjects(position.pageIndex);
			if (!selectableObject) {
				this.setSelection();
			}
			else if (selectableObject && !selectedObjects.includes(selectableObject)) {
				this.setSelection({ pageIndex: position.pageIndex, ids: [selectableObject.id] });
			}
			this._render();
			return;
		}
		let page = this.getPageByIndex(position.pageIndex);
		let { action, selectAnnotations } = this.getActionAtPosition(position, event);

		if (action.type === 'overlay') {
			if (action.overlay.type === 'internal-link') {
				this.navigate({ dest: action.overlay.dest });
			}
			else if (action.overlay.type === 'external-link') {
				this._onOpenLink(action.overlay.url);
			}
			return;
		}

		this.action = action;
		this.pointerDownPosition = position;
		// Select text, and/or object, otherwise unselect

		if (selectAnnotations) {
			this._onSelectAnnotations(selectAnnotations.map(x => x.id));
			action.alreadySelectedAnnotations = true;
			this._openAnnotationPopup();
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
				pageLabel: this._pageLabels[this.pointerDownPosition.pageIndex] || '-',
				sortIndex: this._extractor.getSortIndex(newPosition),
				position: newPosition
			}, true);
		}

		if (action.type === 'selectText') {
			if (event.detail === 1) {
				if (shift && this._selectionRanges.length) {
					this._selectionRanges = getModifiedSelectionRanges(this._extractor, this._selectionRanges, position);
				}
				else {
					this._selectionRanges = getSelectionRanges(this._extractor, position, position);
				}
				this.action.mode = 'chars';
			}
			else if (event.detail === 2) {
				this._selectionRanges = getWordSelectionRanges(this._extractor, position, position);
				this.action.mode = 'words';
			}
			else {
				this._selectionRanges = getLineSelectionRanges(this._extractor, position, position);
				this.action.mode = 'lines';
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

	_handlePointerMove = throttle((event) => {
		let dragging = !!event.dataTransfer;
		// Set action cursor on hover
		if (!this.pointerDownPosition) {
			this.hover = null;
			let position = this.pointerEventToPosition(event);
			if (position) {
				let { action, selectAnnotations } = this.getActionAtPosition(position, event);
				this.updateCursor(action);
				if (action.type === 'overlay') {
					if (this._selectedOverlay !== action.overlay) {
						this._overlayPopupDelayer.open(action.overlay, () => {
							this._selectedOverlay = action.overlay;
							let rect = this.getClientRect(action.overlay.position.rects[0], action.overlay.position.pageIndex);
							let overlayPopup = { ...action.overlay, rect, width: 400, height: 200, scale: 1 };
							this._onSetOverlayPopup(overlayPopup);
						});
					}
				}
				else /*if (this._selectedOverlay)*/ {
					this._overlayPopupDelayer.close(() => {
						this._selectedOverlay = null;
						this._onSetOverlayPopup(null);
					});
				}
				if (selectAnnotations?.length) {
					this.hover = { pageIndex: position.pageIndex, id: selectAnnotations[0].id };
				}
			}
			else {
				this.updateCursor();
			}
			this._render();
			return;
		}
		let originalPagePosition = this.pointerEventToAltPosition(event, this.pointerDownPosition.pageIndex);
		let position = this.pointerEventToPosition(event);
		let page = this.getPageByIndex(position.pageIndex);
		let action = this.action;
		if (action.type === 'updateAnnotationRange') {
			action.selectionRanges = getModifiedSelectionRanges(this._extractor, action.selectionRanges, position);
			let { sortIndex, position: _position, text } = this._getAnnotationFromSelectionRanges(action.selectionRanges);
			action.annotation = { ...action.annotation, sortIndex, position: _position, text };
			// Use text cursor once action is triggered
			this.updateCursor(action);
			action.triggered = true;
		}
		else if (action.type === 'resize') {
			let MIN_SIZE = 20;
			let rect = action.annotation.position.rects[0].slice();

			let [x, y] = originalPagePosition.rects[0];

			let viewBox = page.originalPage.viewport.viewBox;

			if (action.dir.includes('l')) {
				rect[0] = x > rect[2] - MIN_SIZE && rect[2] - MIN_SIZE || x > viewBox[0] && x || viewBox[0];
			}
			else if (action.dir.includes('r')) {
				rect[2] = x < rect[0] + MIN_SIZE && rect[0] + MIN_SIZE || x < viewBox[2] && x || viewBox[2];
			}

			if (action.dir.includes('b')) {
				rect[1] = y > rect[3] - MIN_SIZE && rect[3] - MIN_SIZE || y > viewBox[1] && y || viewBox[1];
			}
			else if (action.dir.includes('t')) {
				rect[3] = y < rect[1] + MIN_SIZE && rect[1] + MIN_SIZE || y < viewBox[3] && y || viewBox[3];
			}

			action.position = {
				pageIndex: action.annotation.position.pageIndex,
				rects: [rect]
			};

			action.triggered = true;
		}
		else if (action.type === 'selectText') {
			if (action.mode === 'chars') {
				this._selectionRanges = getModifiedSelectionRanges(this._extractor, this._selectionRanges, position);
			}
			else if (action.mode === 'words') {
				this._selectionRanges = getWordSelectionRanges(this._extractor, this.pointerDownPosition, position);
			}
			else if (action.mode === 'lines') {
				this._selectionRanges = getLineSelectionRanges(this._extractor, this.pointerDownPosition, position);
			}
			action.triggered = true;
		}
		// Only note and image annotations are supported
		else if (action.type === 'moveAndDrag' && dragging) {
			let rect = getPositionBoundingRect(action.annotation.position);
			let width = rect[2] - rect[0];
			let height = rect[3] - rect[1];
			let [x, y] = originalPagePosition.rects[0];
			x -= action.x;
			y -= action.y;
			let page = this.getPageByIndex(originalPagePosition.pageIndex);
			let viewBox = page.originalPage.viewport.viewBox;
			if (x < viewBox[0]) {
				x = viewBox[0];
			}
			if (y < viewBox[1]) {
				y = viewBox[1];
			}
			if (x + width > viewBox[2]) {
				x = viewBox[2] - width;
			}
			if (y + height > viewBox[3]) {
				y = viewBox[3] - height;
			}
			action.position = {
				pageIndex: originalPagePosition.pageIndex,
				rects: [[x, y, x + width, y + height]]
			};
			action.triggered = true;
		}
		else if (action.type === 'drag' && dragging) {
			action.triggered = true;
		}
		else if (action.type === 'image') {
			let r1 = this.pointerDownPosition.rects[0];
			let r2 = originalPagePosition.rects[0];
			action.annotation = {
				type: 'image',
				color: this._tool.color,
				pageLabel: this._pageLabels[this.pointerDownPosition.pageIndex] || '-',
				position: {
					pageIndex: this.pointerDownPosition.pageIndex,
					rects: [[
						Math.min(r1[0], r2[0]),
						Math.min(r1[1], r2[1]),
						Math.max(r1[0], r2[0]),
						Math.max(r1[1], r2[1])
					]]
				}
			};
			action.triggered = true;
		}
		else if (action.type === 'highlight') {
			let selectionRanges = getSelectionRanges(this._extractor, this.pointerDownPosition, position);
			action.annotation = this._getAnnotationFromSelectionRanges(selectionRanges, 'highlight', this._tool.color);
			action.triggered = true;
		}

		if (action.triggered) {
			this._onSetAnnotationPopup();
			// When dragging selection
			this._onSetSelectionPopup();
		}
		this._render();
	}, 50);

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
			pageLabel: this._pageLabels[selectionRange.position.pageIndex] || '-',
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
		let position = this.pointerEventToPosition(event);

		if (this.pointerDownPosition) {
			// let position = this.pointerEventToAltPosition(event, this.pointerDownPosition.pageIndex);
			let action = this.action;
			if (action.triggered) {
				if (action.type === 'updateAnnotationRange') {
					action.annotation.sortIndex = this._extractor.getSortIndex(action.annotation.position);
					this._onUpdateAnnotations([action.annotation]);
				}
				else if (action.type === 'resize') {
					let sortIndex = this._extractor.getSortIndex(action.position);
					this._onUpdateAnnotations([{ id: action.annotation.id, position: action.position, sortIndex }]);
				}
				else if (action.type === 'moveAndDrag') {
					let sortIndex = this._extractor.getSortIndex(action.position);
					this._onUpdateAnnotations([{ id: action.annotation.id, position: action.position, sortIndex }]);
				}
				else if (action.type === 'highlight' && action.annotation) {
					action.annotation.sortIndex = this._extractor.getSortIndex(action.annotation.position);
					this._onAddAnnotation(action.annotation);
				}
				else if (action.type === 'image') {
					action.annotation.sortIndex = this._extractor.getSortIndex(action.annotation.position);
					this._onAddAnnotation(action.annotation);
				}
			}
			else if (!this.action.alreadySelectedAnnotations) {
				let selectableAnnotations = this.getSelectableAnnotations(position);

				let lastSelectedAnnotationID = this._selectedAnnotationIDs.slice(-1)[0];
				let annotation = selectableAnnotations.find(annotation => annotation.id === lastSelectedAnnotationID);
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
					this._onSelectAnnotations([nextID]);
					this._openAnnotationPopup();
				}
			}
			if (action.type === 'selectText') {
				let selectionRange = this._selectionRanges[0];
				if (selectionRange && !selectionRange.collapsed) {
					let rect = this.getClientRectForPopup(selectionRange.position);
					let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
					annotation.pageLabel = this._pageLabels[annotation.position.pageIndex] || '-';
					this._onSetSelectionPopup({ rect, annotation });
					setTextLayerSelection(this._iframeWindow, this._selectionRanges);
				}
			}
			this.pointerDownPosition = null;
			this.action = null;
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
	}

	cancel() {
		this.setSelection();
		this.hover = null;
		this.action = null;
		this.updateCursor();
		this._render();
	}

	_handleViewAreaUpdate = (event) => {
		this._onChangeViewState({
			pageIndex: event.location.pageNumber - 1,
			scale: event.location.scale,
			top: event.location.top,
			left: event.location.left,
			scrollMode: this._iframeWindow.PDFViewerApplication.pdfViewer.scrollMode,
			spreadMode: this._iframeWindow.PDFViewerApplication.pdfViewer.spreadMode
		});
		this._updateViewStats();
	};

	_updateViewStats() {
		let canNavigateBack = true;
		let canNavigateForward = true;
		try {
			let { uid } = this._iframeWindow.history.state;
			if (uid == 0) {
				canNavigateBack = false;
			}
		}
		catch (e) {
		}

		try {
			let { uid } = this._iframeWindow.history.state;
			let length = this._iframeWindow.history.length;
			if (uid == length - 1) {
				canNavigateForward = false;
			}
		}
		catch (e) {
		}

		let {
			currentPageNumber,
			currentScaleValue,
			pagesCount,
			scrollMode,
			spreadMode
		} = this._iframeWindow.PDFViewerApplication.pdfViewer;

		this._onChangeViewStats({
			pageIndex: currentPageNumber - 1,
			pageLabel: '123',
			pagesCount,
			canCopy: true,
			canZoomOut: true,
			canZoomIn: true,
			canZoomReset: currentScaleValue !== 'page-width',
			canNavigateBack,
			canNavigateForward,
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
	}

	_handleContextMenu(event) {
		event.preventDefault();
	}

	_handleKeyDown(event) {
		let { key } = event;
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		let mod = ctrl || cmd;
		let alt = event.altKey;
		let shift = event.shiftKey;

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

		if (mod && ['o', 's'].includes(key)) {
			event.stopPropagation();
			event.preventDefault();
		}
		// Prevent full screen
		else if (mod && alt && key === 'p') {
			event.stopPropagation();
		}


		if (key === 'Escape') {
			if (this._selectedAnnotationIDs.length) {
				this._onSelectAnnotations([]);
				if (this._lastFocusedObject) {
					this._focusedObject = this._lastFocusedObject;
					this._render();
				}
			}
			else if (this._focusedObject) {
				this._clearFocus();
			}
		}


		if (shift && key === 'Tab') {
			if (this._focusedObject) {
				this._clearFocus();
			}
			else {
				this._onTabOut(true);
			}
			event.preventDefault();
		}
		else if (key === 'Tab') {
			if (!this._focusedObject && this._isSelectionCollpased() && !this._selectedAnnotationIDs.length) {
				if (!this._focusNext()) {
					this._onTabOut();
				}
			}
			else {
				this._clearFocus();
				this._onTabOut();
			}
			event.preventDefault();
		}

		if (this._focusedObject) {
			if (pressedNextKey(event)) {
				this._focusNext();
				event.preventDefault();
			}
			else if (pressedPreviousKey(event)) {
				this._focusNext(true);
				event.preventDefault();
			}
			else if (['Enter', 'Space'].includes(key)) {
				if (this._focusedObject.type) {
					this._onSelectAnnotations([this._focusedObject.id]);
					this._openAnnotationPopup();
				}
				else {

				}
			}
		}

		this._onKeyDown(event);
	}

	_handleDragStart(event) {
		if (!this.action || !['moveAndDrag', 'drag'].includes(this.action.type)) {
			event.preventDefault();
			return;
		}
		if (!this.action.multiple) {
			let annotation = this.action.annotation;
			let page = this.getPageByIndex(annotation.position.pageIndex);

			let canvas = this._dragCanvas;
			page.renderAnnotationOnCanvas(annotation, canvas);

			// When window.devicePixelRatio > 1, Chrome uses CSS pixels when positioning
			// image with setDragImage, while Safari/Firefox uses physical pixels. Weird.
			let pixelRatio = (isSafari || isFirefox || 1) ? window.devicePixelRatio : 1;

			let rect = getPositionBoundingRect(annotation.position);
			let width = rect[2] - rect[0];
			let scale = (canvas.width / pixelRatio) / width;
			event.dataTransfer.setDragImage(canvas, this.action.x * scale, (canvas.height / pixelRatio) - this.action.y * scale);
		}
		this._onSetDataTransferAnnotations(event.dataTransfer, this.action.annotation);
	}

	_handleDragEnd(event) {

	}

	_handleDrop(event) {

	}

	_handleCopy(event) {

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
		let x = event.clientX + page.div.scrollLeft - rect.left - 9;
		let y = event.clientY + page.div.scrollTop - rect.top - (pageIndex === 0 ? 20 : 10);
		let pp = { pageIndex, rects: [[x, y, x, y]] };
		return v2p(pp, page.viewport);
	}

	// Get position outside of the current page
	pointerEventToAltPosition(event, pageIndex) {
		let page = this._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		let rect = page.div.getBoundingClientRect();
		let x = event.clientX + page.div.scrollLeft - rect.left - 9;
		let y = event.clientY + page.div.scrollTop - rect.top - (pageIndex === 0 ? 20 : 10);
		let pageRect = page.pdfPage.view;
		[x, y] = page.viewport.convertToPdfPoint(x, y);

		// Keep the position inside the page
		// x = x > pageRect[2] && pageRect[2] || x > pageRect[0] && x || pageRect[0];
		// y = y > pageRect[3] && pageRect[3] || y > pageRect[1] && y || pageRect[1];
		return { pageIndex, rects: [[x, y, x, y]] };
	}

	setScrollMode(mode) {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('switchscrollmode', { mode });
	}

	setSpreadMode(mode) {
		this._iframeWindow.PDFViewerApplication.eventBus.dispatch('switchspreadmode', { mode });
	}
}


function getDragCanvas() {
	let node = document.getElementById('drag-canvas');
	if (!node) {
		node = document.createElement('canvas');
		node.id = 'drag-canvas';
		document.body.appendChild(node);
	}
	return { canvas: node, context: node.getContext('2d') };
}

export default PDFView;
