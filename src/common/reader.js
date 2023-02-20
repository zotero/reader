import ReactDOM from 'react-dom';
import React from 'react';
import { IntlProvider } from 'react-intl';
import ReaderUI from './components/reader-ui';
import PDFView from '../pdf/pdf-view';
import EPUBView from '../dom/epub/epub-view';
import SnapshotView from '../dom/snapshot/snapshot-view';
import AnnotationManager from './annotation-manager';
import {
	createAnnotationContextMenu,
	createColorContextMenu,
	createSelectorContextMenu, createThumbnailContextMenu,
	createViewContextMenu
} from './context-menu';
import { initPDFPrintService } from '../pdf/pdf-print-service';
import { ANNOTATION_COLORS } from './defines';
import { FocusManager } from './focus-manager';
import { KeyboardManager } from './keyboard-manager';
import { PDFManager } from '../pdf/pdf-manager';
import {
	getImageDataURL,
	setMultiDragPreview,
} from './lib/utilities';
import { debounce } from './lib/debounce';

class Reader {
	constructor(options) {
		this._type = options.type;
		this._platform = options.platform;
		this._buf = options.buf;
		this._password = options.password;

		this._onSaveAnnotations = options.onSaveAnnotations;
		this._onDeleteAnnotations = options.onDeleteAnnotations;
		this._onOpenTagsPopup = options.onOpenTagsPopup;
		this._onAddToNote = options.onAddToNote;
		this._onOpenContextMenu = options.onOpenContextMenu;
		this._onToggleSidebar = options.onToggleSidebar;
		this._onChangeSidebarWidth = options.onChangeSidebarWidth;
		this._onChangeViewState = options.onChangeViewState;
		this._onOpenLink = options.onOpenLink;
		this._onCopyImage = options.onCopyImage;
		this._onSaveImageAs = options.onSaveImageAs;
		this._onConfirm = options.onConfirm;
		this._onRotatePages = options.onRotatePages;
		this._onDeletePages = options.onDeletePages;
		// Only used on Zotero client, sets text/plain and text/html values from Note Markdown and Note HTML translators
		this._onSetDataTransferAnnotations = options.onSetDataTransferAnnotations;

		this._localizedStrings = options.localizedStrings;

		this._readerRef = React.createRef();
		this._primaryView = null;
		this._secondaryView = null;
		this._lastViewPrimary = true;


		this.uiInitializedPromise = new Promise(resolve => this._resolveUIInitializedPromise = resolve);
		this.initializedPromise = new Promise(resolve => this._resolveInitializedPromise = resolve);

		this._splitViewContainer = document.getElementById('split-view');
		this._primaryViewContainer = document.getElementById('primary-view');
		this._secondaryViewContainer = document.getElementById('secondary-view');
		this._portalViewContainer = document.getElementById('portal-view');

		this._lastPortalRect = [0, 0, 0, 0];

		this._state = {
			splitType: null,
			splitSize: '50%',
			primary: true,
			freeze: false,
			annotations: [],
			selectedAnnotationIDs: [],
			filter: {
				query: '',
				colors: [],
				tags: [],
				authors: []
			},
			rtl: !!options.rtl,
			readOnly: options.readOnly !== undefined ? options.readOnly : false,
			authorName: typeof options.authorName === 'string' ? options.authorName : '',
			fontSize: options.fontSize || 1,
			showAnnotations: options.showAnnotations !== undefined ? options.showAnnotations : true, // show/hide annotations in views
			tool: {
				type: 'pointer',
				color: ANNOTATION_COLORS[0][1],
			},
			thumbnails: [],
			outline: [],
			pageLabels: [],
			sidebarOpen: options.sidebarOpen !== undefined ? options.sidebarOpen : true,
			sidebarWidth: options.sidebarWidth !== undefined ? options.sidebarWidth : 240,
			sidebarView: 'annotations',
			bottomPlaceholderHeight: options.bottomPlaceholderHeight || 0,
			toolbarPlaceholderWidth: options.toolbarPlaceholderWidth || 0,
			enableAddToNote: false,
			labelOverlay: null,
			passwordOverlay: null,
			printOverlay: null,
			contextMenu: null,
			primaryViewState: options.primaryViewState,
			primaryViewStats: {},
			primaryViewAnnotationPopup: null,
			primaryViewSelectionPopup: null,
			primaryViewOverlayPopup: null,
			primaryViewFindPopup: {
				open: false,
				query: '',
				highlightAll: true,
				caseSensitive: false,
				entireWord: false,
				resultsCount: null,
				resultIndex: 0
			},
			secondaryViewState: null,
			secondaryViewStats: {},
			secondaryViewAnnotationPopup: null,
			secondaryViewSelectionPopup: null,
			secondaryViewOverlayPopup: null,
			secondaryViewFindPopup: {
				open: false,
				query: '',
				highlightAll: true,
				caseSensitive: false,
				entireWord: false,
				resultsCount: null,
				resultIndex: 0
			}
		};

		if (options.secondaryViewState) {
			let state = { ...options.secondaryViewState };
			this._state.splitType = state.splitType;
			this._state.splitSize = state.splitSize;
			delete state.splitType;
			delete state.splitSize;
			this._state.secondaryViewState = state;
		}

		if (this._type === 'pdf') {
			this._pdfManager = new PDFManager({
				buf: this._buf,
				onUpdatePageLabels: (pageLabels) => {
					this._updateState({ pageLabels });
				}
			});
		}

		this._focusManager = new FocusManager({
			onDeselectAnnotations: () => {
				this.setSelectedAnnotations([]);
			}
		});

		this._keyboardManager = new KeyboardManager({
			reader: this
		});

		this._annotationManager = new AnnotationManager({
			readOnly: this._state.readOnly,
			authorName: options.authorName,
			annotations: options.annotations,
			localizedStrings: this._localizedStrings,
			onSave: this._onSaveAnnotations,
			onDelete: this._onDeleteAnnotations,
			onRender: (annotations) => {
				this._updateState({ annotations });
			},
			onChangeFilter: (filter) => {
				this._updateState({ filter });
			}
		});

		this._primaryView = this._createView(true, options.location);

		ReactDOM.render(
			<IntlProvider
				locale={window.navigator.language}
				messages={this._localizedStrings}
				onError={window.development && (() => {
				})}
			>
				<ReaderUI
					type={this._type}
					state={this._state}
					onSelectAnnotations={this.setSelectedAnnotations.bind(this)}
					onZoomIn={this.zoomIn.bind(this)}
					onZoomOut={this.zoomOut.bind(this)}
					onZoomReset={this.zoomReset.bind(this)}
					onNavigateBack={this.navigateBack.bind(this)}
					onNavigateToPreviousPage={this.navigateToPreviousPage.bind(this)}
					onNavigateToNextPage={this.navigateToNextPage.bind(this)}
					onChangePageNumber={pageNumber => this.navigate({ pageNumber })}
					onChangeTool={this.setTool.bind(this)}
					onToggleFind={this.toggleFindPopup.bind(this)}
					onChangeFilter={this.setFilter.bind(this)}
					onChangeSidebarView={this.setSidebarView.bind(this)}
					onToggleSidebar={(open) => { this.toggleSidebar(open); this._onToggleSidebar(open); }}
					onResizeSidebar={(width) => { this.setSidebarWidth(width); this._onChangeSidebarWidth(width); }}
					onResizeSplitView={this.setSplitViewSize.bind(this)}
					onAddAnnotation={(annotation) => { this._annotationManager.addAnnotation(annotation); this.setSelectedAnnotations([]); } }
					onUpdateAnnotations={this._annotationManager.updateAnnotations.bind(this._annotationManager)}
					onDeleteAnnotations={this._annotationManager.deleteAnnotations.bind(this._annotationManager)}
					onOpenTagsPopup={this._onOpenTagsPopup}
					onOpenPageLabelPopup={this._handleOpenPageLabelPopup.bind(this)}
					onOpenColorContextMenu={params => this._onOpenContextMenu(createColorContextMenu(this, params))}
					onOpenAnnotationContextMenu={params => this._onOpenContextMenu(createAnnotationContextMenu(this, params))}
					onOpenSelectorContextMenu={params => this._onOpenContextMenu(createSelectorContextMenu(this, params))}
					onOpenThumbnailContextMenu={params => this._onOpenContextMenu(createThumbnailContextMenu(this, params))}
					onCloseContextMenu={this.closeContextMenu.bind(this)}
					onCloseLabelOverlay={this._handleLabelOverlayClose.bind(this)}
					onEnterPassword={this.enterPassword.bind(this)}
					onAddToNote={this._onAddToNote}
					onNavigate={this.navigate.bind(this)}
					onUpdateOutline={outline => this._updateState({ outline })}
					onRenderThumbnails={(pageIndexes) => this._primaryView._pdfThumbnails.render(pageIndexes)}
					onSetDataTransferAnnotations={this._handleSetDataTransferAnnotations.bind(this)}

					onChangeFindPopup={this._handleFindPopupChange.bind(this)}
					onFindNext={this.findNext.bind(this)}
					onFindPrevious={this.findPrevious.bind(this)}
					onToggleFindPopup={this.toggleFindPopup.bind(this)}

					onSetPortal={this._setPortal.bind(this)}

					onDoubleClickPageLabel={options.onDoubleClickPageLabel}
					onFocusSplitButton={options.onFocusSplitButton}
					onFocusContextPane={options.onFocusContextPane}
					ref={this._readerRef}
				/>
			</IntlProvider>,
			document.getElementById('reader-ui'),
			() => {
				this._resolveUIInitializedPromise();
			}
		);

		if (this._type === 'pdf') {
			setTimeout(() => {
				this._portalView = this._createPortalView();
			}, 2000);
		}

		this._updateState(this._state, true);

		// window.addEventListener("wheel", event => {
		// 	const delta = Math.sign(event.deltaY);
		// 	console.info(event.target, delta);
		// 	event.preventDefault();
		// }, { passive: false });

		window.addEventListener('contextmenu', (event) => {
			if (event.target.nodeName !== 'INPUT' && !event.target.hasAttribute('contenteditable')) {
				event.preventDefault();
			}
		});
	}

	_ensureType() {
		if (!Array.from(arguments).includes(this._type)) {
			throw new Error(`The operation is not supported for '${this._type}'`);
		}
	}

	get _lastView() {
		return this._lastViewPrimary ? this._primaryView : this._secondaryView;
	}

	_updateState(state, init) {
		let previousState = this._state;

		this._state = { ...this._state, ...state };
		this._readerRef.current?.setState(this._state);

		if (this._state.annotations !== previousState.annotations) {
			let annotations = this._state.annotations.filter(x => !x._hidden);
			this._primaryView?.setAnnotations(annotations);
			this._secondaryView?.setAnnotations(annotations);
		}

		if (this._state.selectedAnnotationIDs !== previousState.selectedAnnotationIDs) {
			this._primaryView?.setSelectedAnnotationIDs(this._state.selectedAnnotationIDs);
			this._secondaryView?.setSelectedAnnotationIDs(this._state.selectedAnnotationIDs);
		}

		if (this._state.tool !== previousState.tool) {
			this._primaryView?.setTool(this._state.tool);
			this._secondaryView?.setTool(this._state.tool);
		}

		if (this._state.showAnnotations !== previousState.showAnnotations) {
			this._primaryView?.setShowAnnotations(this._state.showAnnotations);
			this._secondaryView?.setShowAnnotations(this._state.showAnnotations);
		}

		if (this._state.pageLabels !== previousState.pageLabels) {
			this._primaryView?.setPageLabels(this._state.pageLabels);
			this._secondaryView?.setPageLabels(this._state.pageLabels);
		}

		if (this._state.primaryViewAnnotationPopup !== previousState.primaryViewAnnotationPopup) {
			this._primaryView?.setAnnotationPopup(this._state.primaryViewAnnotationPopup);
		}
		if (this._state.secondaryViewAnnotationPopup !== previousState.secondaryViewAnnotationPopup) {
			this._secondaryView?.setAnnotationPopup(this._state.secondaryViewAnnotationPopup);
		}

		if (this._state.primaryViewSelectionPopup !== previousState.primaryViewSelectionPopup) {
			this._primaryView?.setSelectionPopup(this._state.primaryViewSelectionPopup);
		}
		if (this._state.secondaryViewSelectionPopup !== previousState.secondaryViewSelectionPopup) {
			this._secondaryView?.setSelectionPopup(this._state.secondaryViewSelectionPopup);
		}

		if (this._state.primaryViewOverlayPopup !== previousState.primaryViewOverlayPopup) {
			this._primaryView?.setOverlayPopup(this._state.primaryViewOverlayPopup);
		}
		if (this._state.secondaryViewOverlayPopup !== previousState.secondaryViewOverlayPopup) {
			this._secondaryView?.setOverlayPopup(this._state.secondaryViewOverlayPopup);
		}

		if (this._state.primaryViewFindPopup !== previousState.primaryViewFindPopup) {
			this._primaryView?.setFindPopup(this._state.primaryViewFindPopup);
		}
		if (this._state.secondaryViewFindPopup !== previousState.secondaryViewFindPopup) {
			this._secondaryView?.setFindPopup(this._state.secondaryViewFindPopup);
		}

		if (init || this._state.sidebarOpen !== previousState.sidebarOpen) {
			if (this._state.sidebarOpen) {
				document.body.classList.add('sidebar-open');
			}
			else {
				document.body.classList.remove('sidebar-open');
			}
			this._primaryView?.setSidebarOpen(this._state.sidebarOpen);
			this._secondaryView?.setSidebarOpen(this._state.sidebarOpen);
		}


		if (init || this._state.splitType !== previousState.splitType) {
			document.body.classList.remove('enable-horizontal-split-view');
			document.body.classList.remove('enable-vertical-split-view');
			// Split
			if ((!previousState.splitType || init) && this._state.splitType) {
				document.body.classList.add(
					this._state.splitType === 'vertical'
						? 'enable-vertical-split-view'
						: 'enable-horizontal-split-view'
				);
				if (!this._state.secondaryViewState) {
					this._updateState({ secondaryViewState: { ...this._state.primaryViewState } });
				}
				this._secondaryView = this._createView(false);
			}
			// Unsplit
			else if ((previousState.splitType || init) && !this._state.splitType) {
				this._secondaryView = null;
				this._secondaryViewContainer.replaceChildren();
				this._lastViewPrimary = true;
			}
			// Change existing split type
			else {
				document.body.classList.add(
					this._state.splitType === 'vertical'
						? 'enable-vertical-split-view'
						: 'enable-horizontal-split-view'
				);
			}
		}

		if (init || this._state.splitSize !== previousState.splitSize) {
			document.documentElement.style.setProperty('--split-view-size', this._state.splitSize);
		}

		if (init || this._state.sidebarWidth !== previousState.sidebarWidth) {
			document.documentElement.style.setProperty('--sidebar-width', this._state.sidebarWidth + 'px');
		}

		if (init || this._state.bottomPlaceholderHeight !== previousState.bottomPlaceholderHeight) {
			let root = document.documentElement;
			root.style.setProperty('--bottom-placeholder-height', this._state.bottomPlaceholderHeight + 'px');
		}

		if (init || this._state.toolbarPlaceholderWidth !== previousState.toolbarPlaceholderWidth) {
			let root = document.documentElement;
			root.style.setProperty('--toolbar-placeholder-width', this._state.toolbarPlaceholderWidth + 'px');
		}

		if (init || this._state.fontSize !== previousState.fontSize) {
			let root = document.documentElement;
			root.style.fontSize = this._state.fontSize + 'em';
		}

		if (init || this._state.freeze !== previousState.freeze) {
			if (this._state.freeze) {
				document.body.classList.add('freeze');
			}
			else {
				document.body.classList.remove('freeze');
			}
		}
	}

	disableSplitView() {
		this._updateState({ splitType: null });
	}

	toggleHorizontalSplit(enable) {
		if (enable === undefined) {
			enable = !this._state.splitType || this._state.splitType !== 'horizontal';
		}
		if (enable) {
			this._updateState({ splitType: 'horizontal' });
		}
		else {
			this.disableSplitView();
		}
	}

	toggleVerticalSplit(enable) {
		if (enable === undefined) {
			enable = !this._state.splitType || this._state.splitType !== 'vertical';
		}
		if (enable) {
			this._updateState({ splitType: 'vertical' });
		}
		else {
			this.disableSplitView();
		}
	}

	get splitType() {
		return this._state.splitType;
	}

	setTool(tool) {
		this._updateState({ tool });
	}

	setFilter(filter) {
		this._annotationManager.setFilter(filter);
	}

	showAnnotations(enable) {
		this._updateState({ showAnnotations: enable });
		this._primaryView?.showAnnotations(enable);
		this._secondaryView?.showAnnotations(enable);
	}

	setReadOnly(readOnly) {
		this._updateState({ readOnly });
		this._primaryView?.setReadOnly(readOnly);
		this._secondaryView?.setReadOnly(readOnly);
	}

	toggleHandTool(enable) {
		if (enable === undefined) {
			enable = this._state.tool.type !== 'hand';
		}
		if (enable) {
			this._updateState({ tool: { ...this._state.tool, type: 'hand' } });
		} else {
			this._updateState({ tool: { ...this._state.tool, type: 'pointer' } });
		}
	}

	enableAddToNote(enable) {
		this._updateState({ enableAddToNote: enable });
	}

	setAnnotations(annotations) {
		this._annotationManager.setAnnotations(annotations);
	}

	unsetAnnotations(ids) {
		this._annotationManager.unsetAnnotations(ids);
	}

	openContextMenu(params) {
		this._updateState({ contextMenu: params });
		setTimeout(() => {
			window.focus();
			document.activeElement.blur();
		});
	}

	closeContextMenu() {
		this._updateState({ contextMenu: null });
		this._focusManager.restoreFocus();
	}

	_handleFindPopupChange(primary, params) {
		this._updateState({ [primary ? 'primaryViewFindPopup' : 'secondaryViewFindPopup']: params });
	}

	findNext(primary) {
		if (primary === undefined) {
			primary = this._lastViewPrimary;
		}
		(primary ? this._primaryView : this._secondaryView).findNext();
	}

	findPrevious(primary) {
		if (primary === undefined) {
			primary = this._lastViewPrimary;
		}
		(primary ? this._primaryView : this._secondaryView).findPrevious();
	}

	toggleFindPopup({ primary, open } = {}) {
		if (primary === undefined) {
			primary = this._lastViewPrimary;
		}
		let key = primary ? 'primaryViewFindPopup' : 'secondaryViewFindPopup';
		let findPopup = this._state[key];
		if (open === undefined) {
			open = !findPopup.open;
		}
		findPopup = { ...findPopup, open };
		this._updateState({ [key]: findPopup });
	}

	_sidebarScrollAnnotationIntoViev(id) {
		this._readerRef.current.sidebarScrollAnnotationIntoView(id);
	}

	_sidebarEditHighlightText(id) {
		this._readerRef.current.sidebarEditHighlightText(id);
	}

	_sidebarOpenPageLabelPopup(id) {
		this._readerRef.current.sidebarOpenPageLabelPopup(id);
	}

	_getString(name) {
		return this._localizedStrings[name] || name;
	}

	_createView(primary, location) {
		let view;

		let container = primary ? this._primaryViewContainer : this._secondaryViewContainer;

		let onSetThumbnails = (thumbnails) => {
			this._updateState({ thumbnails });
		};

		let onSetOutline = (outline) => {
			this._state.outline = outline;
		};

		let onChangeViewState = debounce((state) => {
			this._updateState({ [primary ? 'primaryViewState' : 'secondaryViewState']: state });
			if (!primary) {
				let { splitType, splitSize } = this._state;
				state = { ...state, splitType, splitSize };
			}
			this._onChangeViewState(state, primary);
		}, 300);

		let onChangeViewStats = debounce((state) => {
			this._updateState({ [primary ? 'primaryViewStats' : 'secondaryViewStats']: state });
		}, 100);

		let onAddAnnotation = async (annotation, select) => {
			annotation = await this._annotationManager.addAnnotation(annotation);
			if (select) {
				this.setSelectedAnnotations([annotation.id]);
			}
			if (annotation.type === 'note') {
				this._updateState({ tool: { ...this._state.tool, type: 'pointer' } });
			}
		};

		let onUpdateAnnotations = (annotations) => {
			this._annotationManager.updateAnnotations(annotations);
		};

		let onOpenLink = (url) => {
			this._onOpenLink(url);
		};

		let onFocus = () => {
			this.focusView(primary);
		};

		let onRequestPassword = () => {
			if (primary) {
				this._updateState({ passwordOverlay: {} });
			}
		};

		let onOpenAnnotationContextMenu = (params) => {
			this._onOpenContextMenu(createAnnotationContextMenu(this, params));
		};

		let onOpenViewContextMenu = (params) => {
			this._onOpenContextMenu(createViewContextMenu(this, params));
		};

		let onSetSelectionPopup = (selectionPopup) => {
			this._updateState({ [primary ? 'primaryViewSelectionPopup' : 'secondaryViewSelectionPopup']: selectionPopup });
		};

		let onSetAnnotationPopup = (annotationPopup) => {
			this._updateState({ [primary ? 'primaryViewAnnotationPopup' : 'secondaryViewAnnotationPopup']: annotationPopup });
		};

		let onSetOverlayPopup = (overlayPopup) => {
			this._updateState({ [primary ? 'primaryViewOverlayPopup' : 'secondaryViewOverlayPopup']: overlayPopup });
			if (!overlayPopup) {
				this._setPortal(null);
			}
		};

		let onSetFindPopup = (params) => {
			this._updateState({ [primary ? 'primaryViewFindPopup' : 'secondaryViewFindPopup']: params });
		};

		let onSelectAnnotations = (ids) => {
			this.setSelectedAnnotations(ids, true);
		};

		let onTabOut = (reverse) => {
			this._focusManager.tabToGroup(reverse);
		};

		let onKeyDown = (event) => {
			this._keyboardManager.handleViewKeyDown(event);
		};

		let common = {
			primary,
			container,
			buf: this._buf,
			tool: this._state.tool,
			selectedAnnotationIDs: this._state.selectedAnnotationIDs,
			annotations: this._state.annotations.filter(x => !x._hidden),
			showAnnotations: this._state.showAnnotations,
			findPopup: this._state[primary ? 'primaryViewFindPopup' : 'secondaryViewFindPopup'],
			viewState: this._state[primary ? 'primaryViewState' : 'secondaryViewState'],
			location,
			onChangeViewState,
			onChangeViewStats,
			onSetDataTransferAnnotations: this._handleSetDataTransferAnnotations.bind(this),
			onAddAnnotation,
			onUpdateAnnotations,
			onOpenLink,
			onFocus,
			onOpenAnnotationContextMenu,
			onOpenViewContextMenu,
			onSetSelectionPopup,
			onSetAnnotationPopup,
			onSetOverlayPopup,
			onSetFindPopup,
			onSelectAnnotations,
			onTabOut,
			onKeyDown
		};

		if (this._type === 'pdf') {
			view = new PDFView({
				...common,
				password: this._password,
				pageLabels: this._state.pageLabels,
				pdfManager: this._pdfManager,
				onRequestPassword,
				onSetThumbnails,
				onSetOutline,
			});

			if (primary) {
				initPDFPrintService({
					onProgress: (percent) => {
						this._updateState({ printOverlay: { percent } });
					},
					onFinish: () => {
						this._updateState({ printOverlay: null });
					},
					pdfView: view
				});
			}
		} else if (this._type === 'epub') {
			view = new EPUBView({
				...common,
				onSetOutline,
			});
		} else if (this._type === 'snapshot') {
			view = new SnapshotView({
				...common
			});
		}
		return view;
	}

	_createPortalView() {
		// Portal view is just a floating PDF view that is positioned on top of another popup

		let view;

		let container = this._portalViewContainer;

		let onSetDataTransferAnnotations = (dataTransfer, annotations) => {
		};

		let onOpenLink = (url) => {
			this._onOpenLink(url);
		};

		let onFocus = () => {
		};

		let onTabOut = (reverse) => {
			this._focusManager.tabToGroup(reverse);
		};

		let onKeyDown = (event) => {
			this._keyboardManager.handleViewKeyDown(event);
		};

		let nop = () => undefined;

		view = new PDFView({
			portal: true,
			container,
			buf: this._buf,
			password: this._password,
			tool: { type: 'pointer' },
			selectedAnnotationIDs: [],
			annotations: this._state.annotations,
			showAnnotations: this._state.showAnnotations,
			findPopup: {},
			viewState: {},
			location: null,
			onChangeViewState: nop,
			onChangeViewStats: nop,
			onSetDataTransferAnnotations,
			onAddAnnotation: nop,
			onUpdateAnnotations: nop,
			onOpenLink,
			onFocus,
			onRequestPassword: nop,
			onOpenAnnotationContextMenu: nop,
			onOpenViewContextMenu: nop,
			onSetSelectionPopup: nop,
			onSetAnnotationPopup: nop,
			onSetOverlayPopup: nop,
			onSetFindPopup: nop,
			onSelectAnnotations: nop,
			onSetThumbnails: nop,
			onSetOutline: nop,
			onTabOut,
			onKeyDown,
		});
		return view;
	}

	_setPortal(params) {
		if (!params) {
			this._portalViewContainer.classList.add('disabled');
			// TODO: Destroy portal when switching to another tab or a delay
		}
		else {
			this._portalViewContainer.classList.remove('disabled');
			let { rect, dest } = params;
			let w1 = this._lastPortalRect[2] - this._lastPortalRect[0];
			let h1 = this._lastPortalRect[3] - this._lastPortalRect[1];
			let w2 = rect[2] - rect[0];
			let h2 = rect[3] - rect[1];
			// Update width/height if needed, which also causes reflow
			if (w1 !== w2 || h1 !== h2) {
				this._portalViewContainer.style.width = w2 + 'px';
				this._portalViewContainer.style.height = h2 + 'px';
			}
			let x1 = this._lastPortalRect[0];
			let y1 = this._lastPortalRect[1];
			let x2 = rect[0];
			let y2 = rect[1];
			// Update only x, y position, which is fast
			if (x1 !== x2 || y1 !== y2) {
				this._portalViewContainer.style.transform = `translate(${x2}px, ${y2}px)`;
			}
			this._lastPortalRect = rect.slice();

			this._portalView._iframeWindow.PDFViewerApplication.pdfViewer.currentScale = 1;

			// TODO: Detect and zoom to paragraph width while ignoring margins, but preserve zoom
			//  level lower than in the current view, and reduce overlay popup dimensions
			this._portalView._iframeWindow.PDFViewerApplication.pdfLinkService.goToDestination(dest);
		}
	}

	getUnsavedAnnotations() {

	}

	deleteAnnotations(ids) {
		if (ids.length > 1) {
			if (!this._onConfirm(
				'',
				this._getString('pdfReader.deleteAnnotation.plural'),
				this._getString('general.delete')
			)) {
				return;
			}
		}
		let selectedAnnotationIDs = this._state.selectedAnnotationIDs.filter(id => !ids.includes(id));
		this._updateState({
			selectedAnnotationIDs,
			primaryViewAnnotationPopup: null,
			secondaryViewAnnotationPopup: null,
		});
		this._annotationManager.deleteAnnotations(ids);
	}

	/**
	 * Trigger copying inside the currently focused iframe or the main window
	 */
	copy() {
		let { activeElement } = document;
		if (activeElement.nodeName === 'IFRAME' && activeElement.contentWindow) {
			activeElement.contentWindow.document.execCommand("copy");
		}
		else {
			document.execCommand("copy");
		}
	}

	zoomIn() {
		this._lastView.zoomIn();
	}

	zoomOut() {
		this._lastView.zoomOut();
	}

	zoomReset() {
		this._lastView.zoomReset();
	}

	zoomAuto() {
		this._ensureType('pdf');
		this._lastView.zoomAuto();
	}

	zoomPageWidth() {
		this._ensureType('pdf');
		this._lastView.zoomPageWidth();
	}

	zoomPageHeight() {
		this._ensureType('pdf');
		this._lastView.zoomPageHeight();
	}

	navigate(location) {
		this._lastView.navigate(location);
	}

	navigateBack() {
		this._lastView.navigateBack();
	}

	navigateForward() {
		this._lastView.navigateForward();
	}

	navigateToFirstPage() {
		this._ensureType('pdf', 'epub');
		this._lastView.navigateToFirstPage();
	}

	navigateToLastPage() {
		this._ensureType('pdf', 'epub');
		this._lastView.navigateToLastPage();
	}

	navigateToPreviousPage() {
		this._ensureType('pdf', 'epub');
		this._lastView.navigateToPreviousPage();
	}

	navigateToNextPage() {
		this._ensureType('pdf', 'epub');
		this._lastView.navigateToNextPage();
	}

	setSelectedAnnotations(ids, triggeredFromView) {
		this._updateState({ selectedAnnotationIDs: ids });
		if (ids.length === 1) {
			let id = ids[0];
			let annotation = this._annotationManager._annotations.find(x => x.id === id);
			if (annotation) {
				if (triggeredFromView) {
					if (annotation.comment) {
						let sidebarItem = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
						if (sidebarItem) {
							// Make sure to call this after all events, because mousedown will re-focus the View
							setTimeout(() => sidebarItem.focus());
						}
					}
					else {
						setTimeout(() => {
							let content;
							if (this._state.sidebarOpen) {
								content = document.querySelector(`[data-sidebar-annotation-id="${id}"] .comment .content`);
							}
							else {
								content = document.querySelector(`.annotation-popup .comment .content`);
							}
							content?.focus();
						}, 50);
					}
				}
				else {
					this._lastView.navigate({ annotationID: annotation.id });
				}
			}
			let sidebarItem = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
			if (sidebarItem) {
				this.setSidebarView('annotations');
				setTimeout(() => {
					sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
				}, 50);
			}
		}
	}

	setFontSize(fontSize) {
		this._updateState({ fontSize });
	}

	setSidebarView(view) {
		this._updateState({ sidebarView: view });
	}

	toggleSidebar(open) {
		if (open === undefined) {
			open = !this._state.sidebarOpen;
		}
		this._updateState({ sidebarOpen: open });
	}

	setSidebarWidth(width) {
		this._updateState({ sidebarWidth: width });
	}

	setSplitViewSize(size) {
		this._updateState({ splitSize: size });
	}

	setBottomPlaceholderHeight(height) {
		this._updateState({ bottomPlaceholderHeight: height });
	}

	setToolbarPlaceholderWidth(width) {
		this._updateState({ toolbarPlaceholderWidth: width });
	}

	focusView(primary = true) {
		primary = primary || !this._secondaryView;
		this._lastViewPrimary = primary;
		let view = primary ? this._primaryView : this._secondaryView;
		view.focus();
		this._updateState({ primary });
		if (primary) {
			this._updateState({ secondaryViewAnnotationPopup: null });
			this._updateState({ secondaryViewSelectionPopup: null });
			this._updateState({ secondaryViewOverlyPopup: null });
		}
		else {
			this._updateState({ primaryViewAnnotationPopup: null });
			this._updateState({ primaryViewSelectionPopup: null });
			this._updateState({ primaryViewOverlayPopup: null });
		}
	}

	freeze() {
		this._updateState({ freeze: true });
	}

	unfreeze() {
		this._updateState({ freeze: false });
	}

	print() {
		if (this._state.annotations.length) {
			this._updateState({ printOverlay: {} });
		}
		else {
			window.print();
		}
	}

	abortPrint() {
		window.abortPrint();
	}

	reload(buf) {
		this._buf = buf;
		this._primaryViewContainer.replaceChildren();
		this._primaryView = this._createView(true);
		if (this._state.splitType) {
			this._secondaryViewContainer.replaceChildren();
			this._secondaryView = this._createView(false);
		}
		// TODO: Reload portal view as well
	}

	enterPassword(password) {
		this._updateState({ passwordOverlay: null });
		this._password = password;
		this.reload(this._buf);
	}

	_handleSetDataTransferAnnotations(dataTransfer, annotation, fromText) {
		let annotations;
		let selectedIDs = this._state.selectedAnnotationIDs;
		annotations = [annotation];
		if (selectedIDs.includes(annotation.id) && selectedIDs.length > 1) {
			annotations = this._state.annotations.filter(x => selectedIDs.includes(x.id));
		}
		if (annotations.length > 1) {
			setMultiDragPreview(dataTransfer);
		}
		annotations = annotations.filter(x => x.type !== 'ink');
		let plainText = annotations.map((annotation) => {
			let formatted = '';
			if (annotation.text) {
				let text = annotation.text.trim();
				formatted = fromText ? text : '“' + text + '”';
			}
			let comment = annotation.comment?.trim();
			if (comment) {
				if (formatted) {
					formatted += comment.includes('\n') ? '\n' : ' ';
				}
				formatted += comment;
			}
			return formatted;
		}).filter(x => x).join('\n\n');
		annotations = annotations.map(
			({ id, type, text, color, comment, image, position, pageLabel, tags }) => {
				if (image) {
					let img = document.querySelector(`[data-sidebar-annotation-id="${id}"] img`);
					if (img) {
						image = getImageDataURL(img);
					}
				}
				return {
					id,
					type,
					text: text ? text.trim() : text,
					color,
					comment: comment ? comment.trim() : comment,
					image,
					position,
					pageLabel,
					tags
				};
			}
		);
		// Clear image data set on some untested type (when drag is initiated on img),
		// which also prevents word processors from using `text/plain`, and
		// results to dumped base64 content (LibreOffice) or image (Google Docs)
		dataTransfer.clearData();
		dataTransfer.setData('text/plain', plainText);
		this._onSetDataTransferAnnotations(dataTransfer, annotations, fromText);
	}

	_handleOpenPageLabelPopup(id, rect) {
		this._ensureType('pdf');
		let pageLabels = this._state.pageLabels;
		let selectedIDs = this._state.selectedAnnotationIDs;
		let currentAnnotation = this._annotationManager._getAnnotationByID(id);
		let selectedAnnotations = this._annotationManager._annotations.filter(x => selectedIDs.includes(x.id));
		let allAnnotations = this._annotationManager._annotations;
		this._updateState({ labelOverlay: { currentAnnotation, selectedAnnotations, allAnnotations, rect, selectedIDs, pageLabels } });
	}

	_handleLabelOverlayClose() {
		this._updateState({ labelOverlay: null });
	}

	rotatePageLeft() {
		this._ensureType('pdf');
		let { pageIndex } = (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats);
		this.rotatePages([pageIndex], 270);
	}

	rotatePageRight() {
		this._ensureType('pdf');
		let { pageIndex } = (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats);
		this.rotatePages([pageIndex], 90);
	}

	rotatePages(pageIndexes, degrees) {
		this._ensureType('pdf');
		// TODO: Automatically recalculate view state top and left values to prevent unexpected PDF view scroll
		this._onRotatePages(pageIndexes, degrees);
	}

	deletePages(pageIndexes, degrees) {
		this._ensureType('pdf');
		this._onDeletePages(pageIndexes, degrees);
	}

	get toolType() {
		return this._state.tool.type;
	}

	get zoomAutoEnabled() {
		this._ensureType('pdf');
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).zoomAutoEnabled;
	}

	get zoomPageWidthEnabled() {
		this._ensureType('pdf');
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).zoomPageWidthEnabled;
	}

	get zoomPageHeightEnabled() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).zoomPageHeightEnabled;
	}

	get scrollMode() {
		this._ensureType('pdf');
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).scrollMode;
	}

	set scrollMode(value) {
		this._ensureType('pdf');
		this._lastView.setScrollMode(value);
	}

	get spreadMode() {
		this._ensureType('pdf');
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).spreadMode;
	}

	set spreadMode(value) {
		this._ensureType('pdf');
		this._lastView.setSpreadMode(value);
	}

	get canCopy() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canCopy;
	}

	get canZoomIn() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canZoomIn;
	}

	get canZoomOut() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canZoomOut;
	}

	get canZoomReset() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canZoomReset;
	}

	get canNavigateBack() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateBack;
	}

	get canNavigateForward() {
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateForward;
	}

	get canNavigateToFirstPage() {
		if (!['pdf', 'epub'].includes(this._type)) {
			return false;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateToFirstPage;
	}

	get canNavigateToLastPage() {
		if (!['pdf', 'epub'].includes(this._type)) {
			return false;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateToLastPage;
	}

	get canNavigateToPreviousPage() {
		if (!['pdf', 'epub'].includes(this._type)) {
			return false;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateToPreviousPage;
	}

	get canNavigateToNextPage() {
		if (!['pdf', 'epub'].includes(this._type)) {
			return false;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateToNextPage;
	}

	get flowMode() {
		this._ensureType('epub');
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).flowMode;
	}

	set flowMode(value) {
		this._ensureType('epub');
		this._lastView.setFlowMode(value);
	}
}

export default Reader;
