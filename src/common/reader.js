import ReactDOM from 'react-dom';
import React, { createContext } from 'react';
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
import { ANNOTATION_COLORS, DEBOUNCE_STATE_CHANGE, DEBOUNCE_STATS_CHANGE } from './defines';
import { FocusManager } from './focus-manager';
import { KeyboardManager } from './keyboard-manager';
import {
	getImageDataURL, isMac,
	setMultiDragPreview,
} from './lib/utilities';
import { debounce } from './lib/debounce';

// Compute style values for usage in views (CSS variables aren't sufficient for that)
// Font family is necessary for text annotations
window.computedFontFamily = window.getComputedStyle(document.body).getPropertyValue('font-family');

export const ReaderContext = createContext({});

class Reader {
	constructor(options) {
		window.rtl = options.rtl;
		document.getElementsByTagName("html")[0].dir = options.rtl ? 'rtl' : 'ltr';

		this._type = options.type;
		this._platform = options.platform;
		this._data = options.data;
		this._password = options.password;
		this._preview = options.preview;

		this._readerContext = { type: this._type, platform: this._platform };

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
		this._onToggleContextPane = options.onToggleContextPane;
		this._onToolbarShiftTab = options.onToolbarShiftTab;
		this._onIframeTab = options.onIframeTab;
		// Only used on Zotero client, sets text/plain and text/html values from Note Markdown and Note HTML translators
		this._onSetDataTransferAnnotations = options.onSetDataTransferAnnotations;
		this._onSetZoom = options.onSetZoom;

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

		this._enableAnnotationDeletionFromComment = false;
		this._annotationSelectionTriggeredFromView = false;

		this._tools = {
			pointer: {
				type: 'pointer'
			},
			hand: {
				type: 'hand'
			},
			highlight: {
				type: 'highlight',
				color: ANNOTATION_COLORS[0][1],
			},
			underline: {
				type: 'underline',
				color: ANNOTATION_COLORS[0][1],
			},
			note: {
				type: 'note',
				color: ANNOTATION_COLORS[0][1],
			},
			image: {
				type: 'image',
				color: ANNOTATION_COLORS[0][1],
			},
			text: {
				type: 'text',
				color: ANNOTATION_COLORS[0][1],
			},
			ink: {
				type: 'ink',
				color: ANNOTATION_COLORS[3][1],
				size: 2
			},
			eraser: {
				type: 'eraser',
				size: 16
			}
		};

		this._state = {
			splitType: null,
			splitSize: '50%',
			primary: true,
			freeze: false,
			errorMessage: '',
			annotations: [],
			selectedAnnotationIDs: [],
			filter: {
				query: '',
				colors: [],
				tags: [],
				authors: []
			},
			readOnly: options.readOnly !== undefined ? options.readOnly : false,
			authorName: typeof options.authorName === 'string' ? options.authorName : '',
			fontSize: options.fontSize || 1,
			fontFamily: options.fontFamily,
			showAnnotations: options.showAnnotations !== undefined ? options.showAnnotations : true, // show/hide annotations in views
			useDarkModeForContent: options.useDarkModeForContent !== undefined ? options.useDarkModeForContent : true,
			colorScheme: options.colorScheme,
			tool: this._tools['pointer'], // Must always be a reference to one of this._tools objects
			thumbnails: [],
			outline: null, // null — loading, [] — empty
			pageLabels: [],
			sidebarOpen: options.sidebarOpen !== undefined ? options.sidebarOpen : true,
			sidebarWidth: options.sidebarWidth !== undefined ? options.sidebarWidth : 240,
			sidebarView: 'annotations',
			bottomPlaceholderHeight: options.bottomPlaceholderHeight || null,
			toolbarPlaceholderWidth: options.toolbarPlaceholderWidth || 0,
			showContextPaneToggle: options.showContextPaneToggle,
			enableAddToNote: false,
			labelPopup: null,
			passwordPopup: null,
			printPopup: null,
			contextMenu: null,
			primaryViewState: options.primaryViewState,
			primaryViewStats: {},
			primaryViewAnnotationPopup: null,
			primaryViewSelectionPopup: null,
			primaryViewOverlayPopup: null,
			primaryViewFindState: {
				popupOpen: false,
				active: false,
				query: '',
				highlightAll: true,
				caseSensitive: false,
				entireWord: false,
				result: null,
			},
			secondaryViewState: null,
			secondaryViewStats: {},
			secondaryViewAnnotationPopup: null,
			secondaryViewSelectionPopup: null,
			secondaryViewOverlayPopup: null,
			secondaryViewFindState: {
				popupOpen: false,
				active: false,
				query: '',
				highlightAll: true,
				caseSensitive: false,
				entireWord: false,
				result: null
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

		this._focusManager = new FocusManager({
			reader: this,
			onDeselectAnnotations: () => {
				this.setSelectedAnnotations([]);
			},
			onToolbarShiftTab: () => {
				this._onToolbarShiftTab();
			},
			onIframeTab: () => {
				this._onIframeTab();
			}
		});

		this._keyboardManager = new KeyboardManager({
			reader: this
		});

		this._annotationManager = new AnnotationManager({
			readOnly: this._state.readOnly,
			authorName: options.authorName,
			annotations: options.annotations,
			onSave: this._onSaveAnnotations,
			onDelete: this._handleDeleteAnnotations,
			onRender: (annotations) => {
				this._updateState({ annotations });
			},
			onChangeFilter: (filter) => {
				this._updateState({ filter });
			}
		});

		this._primaryView = this._createView(true, options.location);

		if (!this._preview) {
			ReactDOM.render(
				<IntlProvider
					locale={window.navigator.language}
					messages={this._localizedStrings}
					onError={window.development && (() => {
					})}
				>
					<ReaderContext.Provider value={this._readerContext}>
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
							onToggleSidebar={(open) => {
								this.toggleSidebar(open);
								this._onToggleSidebar(open);
							}}
							onResizeSidebar={(width) => {
								this.setSidebarWidth(width);
								this._onChangeSidebarWidth(width);
							}}
							onResizeSplitView={this.setSplitViewSize.bind(this)}
							onAddAnnotation={(annotation) => {
								this._annotationManager.addAnnotation(annotation);
								this.setSelectedAnnotations([]);
							}}
							onUpdateAnnotations={(annotations) => {
								this._annotationManager.updateAnnotations(annotations);
								this._enableAnnotationDeletionFromComment = false;
							}}
							onDeleteAnnotations={this._annotationManager.deleteAnnotations.bind(this._annotationManager)}
							onOpenTagsPopup={this._onOpenTagsPopup}
							onOpenPageLabelPopup={this._handleOpenPageLabelPopup.bind(this)}
							onOpenColorContextMenu={params => this._onOpenContextMenu(createColorContextMenu(this, params))}
							onOpenAnnotationContextMenu={params => this._onOpenContextMenu(createAnnotationContextMenu(this, params))}
							onOpenSelectorContextMenu={params => this._onOpenContextMenu(createSelectorContextMenu(this, params))}
							onOpenThumbnailContextMenu={params => this._onOpenContextMenu(createThumbnailContextMenu(this, params))}
							onCloseContextMenu={this.closeContextMenu.bind(this)}
							onCloseLabelPopup={this._handleLabelPopupClose.bind(this)}
							onEnterPassword={this.enterPassword.bind(this)}
							onAddToNote={(annotations) => {
								this._onAddToNote(annotations);
								this.setSelectedAnnotations([]);
							}}
							onNavigate={this.navigate.bind(this)}
							onUpdateOutline={outline => this._updateState({ outline })}
							onRenderThumbnails={(pageIndexes) => this._primaryView._pdfThumbnails.render(pageIndexes)}
							onSetDataTransferAnnotations={this._handleSetDataTransferAnnotations.bind(this)}
							onOpenLink={this._onOpenLink}
							onChangeFindState={this._handleFindStateChange.bind(this)}
							onFindNext={this.findNext.bind(this)}
							onFindPrevious={this.findPrevious.bind(this)}
							onToggleFindPopup={this.toggleFindPopup.bind(this)}
							onToggleContextPane={this._onToggleContextPane}
							ref={this._readerRef}
						/>
					</ReaderContext.Provider>
				</IntlProvider>,
				document.getElementById('reader-ui'),
				() => {
					this._resolveUIInitializedPromise();
				}
			);
		}

		this._updateState(this._state, true);

		// window.addEventListener("wheel", event => {
		// 	const delta = Math.sign(event.deltaY);
		// 	console.info(event.target, delta);
		// 	event.preventDefault();
		// }, { passive: false });

		if (this._platform !== 'web') {
			window.addEventListener('contextmenu', (event) => {
				if (event.target.nodeName !== 'INPUT' && !event.target.hasAttribute('contenteditable')) {
					event.preventDefault();
				}
			});
		}
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

		if (init || this._state.useDarkModeForContent !== previousState.useDarkModeForContent) {
			document.body.classList.toggle(
				'use-dark-mode-for-content',
				this._state.useDarkModeForContent
			);

			if (!init) {
				this._primaryView?.setUseDarkMode(this._state.useDarkModeForContent);
				this._secondaryView?.setUseDarkMode(this._state.useDarkModeForContent);
			}
		}

		if (init || this._state.colorScheme !== previousState.colorScheme) {
			if (this._state.colorScheme) {
				document.documentElement.dataset.colorScheme = this._state.colorScheme;
			}
			else {
				delete document.documentElement.dataset.colorScheme;
			}
			if (!init) {
				this._primaryView?.setColorScheme(this._state.colorScheme);
				this._secondaryView?.setColorScheme(this._state.colorScheme);
				// also update useDarkModeForContent as it depends on colorScheme
				this._primaryView?.setUseDarkMode(this._state.useDarkModeForContent);
				this._secondaryView?.setUseDarkMode(this._state.useDarkModeForContent);
			}
		}

		if (this._state.readOnly !== previousState.readOnly) {
			this._annotationManager.setReadOnly(this._state.readOnly);
			this._primaryView?.setReadOnly?.(this._state.readOnly);
			this._secondaryView?.setReadOnly?.(this._state.readOnly);
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

		if (this._state.primaryViewFindState !== previousState.primaryViewFindState) {
			this._primaryView?.setFindState(this._state.primaryViewFindState);
		}
		if (this._state.secondaryViewFindState !== previousState.secondaryViewFindState) {
			this._secondaryView?.setFindState(this._state.secondaryViewFindState);
		}

		if (this._type === 'epub' && this._state.fontFamily !== previousState.fontFamily) {
			this._primaryView?.setFontFamily(this._state.fontFamily);
			this._secondaryView?.setFontFamily(this._state.fontFamily);
		}

		if (init || this._state.sidebarView !== previousState.sidebarView) {
			this._primaryView?.setSidebarView?.(this._state.sidebarView);
			this._secondaryView?.setSidebarView?.(this._state.sidebarView);
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
				this._updateState({ secondaryViewState: { ...this._state.primaryViewState } });
				this._secondaryView = this._createView(false);
			}
			// Unsplit
			else if ((previousState.splitType || init) && !this._state.splitType) {
				this._secondaryView?.destroy();
				this._secondaryView = null;
				this._secondaryViewContainer.replaceChildren();
				this._lastViewPrimary = true;
				this._onChangeViewState(null, false);
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
			root.style.setProperty('--bottom-placeholder-height', (this._state.bottomPlaceholderHeight || 0) + 'px');
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

	setTool(params) {
		if (this._state.readOnly && !['pointer', 'hand'].includes(params.type)) {
			return;
		}
		let tool = this._state.tool;
		if (params.type && tool.type !== params.type) {
			tool = this._tools[params.type];
		}
		for (let key in params) {
			tool[key] = params[key];
		}
		this._updateState({ tool });
		if (!['pointer', 'hand'].includes(tool.type)) {
			this.setSelectedAnnotations([]);
		}
	}

	toggleTool(type) {
		let tool = this._state.tool;
		if (tool.type === type) {
			this._updateState({ tool: this._tools.pointer });
		}
		else {
			this._updateState({ tool: this._tools[type] });
		}
		this.setSelectedAnnotations([]);
	}

	setFilter(filter) {
		this._annotationManager.setFilter(filter);
	}

	showAnnotations(enable) {
		this._updateState({ showAnnotations: enable });
	}

	useDarkModeForContent(use) {
		this._updateState({ useDarkModeForContent: use });
	}

	setColorScheme(colorScheme) {
		this._updateState({ colorScheme });
	}

	setReadOnly(readOnly) {
		// Also unset any active tool
		this._updateState({ readOnly, tool: this._tools['pointer'] });
	}

	toggleHandTool(enable) {
		if (enable === undefined) {
			enable = this._state.tool.type !== 'hand';
		}
		if (enable) {
			this.setTool({ type: 'hand' });
		} else {
			this.setTool({ type: 'pointer' });
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

	_handleFindStateChange(primary, params) {
		this._updateState({ [primary ? 'primaryViewFindState' : 'secondaryViewFindState']: params });
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
		let key = primary ? 'primaryViewFindState' : 'secondaryViewFindState';
		let findState = this._state[key];
		if (open === undefined) {
			open = !findState.popupOpen;
		}
		findState = { ...findState, popupOpen: open, active: false, result: null };
		this._updateState({ [key]: findState });
		if (open) {
			setTimeout(() => {
				let selector = (primary ? '.primary' : '.secondary') + ' .find-popup input';
				document.querySelector(selector)?.select();
				document.querySelector(selector)?.focus();
			}, 100);
		}
	}

	_sidebarScrollAnnotationIntoViev(id) {
		this._readerRef.current.sidebarScrollAnnotationIntoView(id);
	}

	_sidebarEditAnnotationText(id) {
		this._readerRef.current.sidebarEditAnnotationText(id);
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
			this._updateState({ outline });
		};

		let onSetPageLabels = (pageLabels) => {
			this._updateState({ pageLabels });
		};

		let onChangeViewState = debounce((state) => {
			this._updateState({ [primary ? 'primaryViewState' : 'secondaryViewState']: state });
			if (!primary) {
				let { splitType, splitSize } = this._state;
				state = { ...state, splitType, splitSize };
			}
			this._onChangeViewState(state, primary);
		}, DEBOUNCE_STATE_CHANGE);

		let onChangeViewStats = debounce((state) => {
			this._updateState({ [primary ? 'primaryViewStats' : 'secondaryViewStats']: state });
		}, DEBOUNCE_STATS_CHANGE);

		let onAddAnnotation = (annotation, select) => {
			annotation = this._annotationManager.addAnnotation(annotation);
			if (select) {
				this.setSelectedAnnotations([annotation.id], true);
			}
			if (['note', 'text'].includes(annotation.type)) {
				this.setTool({ type: 'pointer' });
			}
			return annotation;
		};

		let onUpdateAnnotations = (annotations) => {
			this._annotationManager.updateAnnotations(annotations);
		};

		let onDeleteAnnotations = (ids) => {
			this._annotationManager.deleteAnnotations(ids);
		};

		let onOpenLink = (url) => {
			this._onOpenLink(url);
		};

		let onFocus = () => {
			this.focusView(primary);
			// A workaround for Firefox/Zotero because iframe focusing doesn't trigger 'focusin' event
			this._focusManager._closeFindPopupIfEmpty();
		};

		let onRequestPassword = () => {
			if (primary) {
				this._updateState({ passwordPopup: {} });
			}
		};

		let onOpenAnnotationContextMenu = (params) => {
			this._onOpenContextMenu(createAnnotationContextMenu(this, params));
		};

		let onOpenViewContextMenu = (params) => {
			// Trigger view context menu after focus even fires and focuses the current view
			setTimeout(() => this._onOpenContextMenu(createViewContextMenu(this, params)));
		};

		let onSetSelectionPopup = (selectionPopup) => {
			this._updateState({ [primary ? 'primaryViewSelectionPopup' : 'secondaryViewSelectionPopup']: selectionPopup });
		};

		let onSetAnnotationPopup = (annotationPopup) => {
			this._updateState({ [primary ? 'primaryViewAnnotationPopup' : 'secondaryViewAnnotationPopup']: annotationPopup });
		};

		let onSetOverlayPopup = (overlayPopup) => {
			this._updateState({ [primary ? 'primaryViewOverlayPopup' : 'secondaryViewOverlayPopup']: overlayPopup });
		};

		let onSetFindState = (params) => {
			this._updateState({ [primary ? 'primaryViewFindState' : 'secondaryViewFindState']: params });
		};

		let onSelectAnnotations = (ids, triggeringEvent) => {
			this.setSelectedAnnotations(ids, true, triggeringEvent);
		};

		let onTabOut = (reverse) => {
			this._focusManager.tabToGroup(reverse);
		};

		let onKeyDown = (event) => {
			this._keyboardManager.handleViewKeyDown(event);
		};

		let onKeyUp = (event) => {
			this._keyboardManager.handleViewKeyUp(event);
		};

		let onSetZoom = this._onSetZoom && ((iframe, zoom) => {
			this._onSetZoom(iframe, zoom);
		});

		let onEPUBEncrypted = () => {
			this.setErrorMessage(this._getString('pdfReader.epubEncrypted'));
		};

		let data;
		if (this._type === 'pdf') {
			data = this._data;
		}
		else if (this._primaryView) {
			data = this._primaryView.getData();
		}
		else {
			data = this._data;
			delete this._data;
		}

		let common = {
			primary,
			container,
			data,
			platform: this._platform,
			readOnly: this._state.readOnly,
			preview: this._preview,
			tool: this._state.tool,
			selectedAnnotationIDs: this._state.selectedAnnotationIDs,
			annotations: this._state.annotations.filter(x => !x._hidden),
			showAnnotations: this._state.showAnnotations,
			useDarkMode: this._state.useDarkModeForContent,
			colorScheme: this._state.colorScheme,
			findState: this._state[primary ? 'primaryViewFindState' : 'secondaryViewFindState'],
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
			onSetFindState,
			onSetOutline,
			onSelectAnnotations,
			onTabOut,
			onKeyDown,
			onKeyUp
		};

		if (this._type === 'pdf') {
			view = new PDFView({
				...common,
				password: this._password,
				pageLabels: this._state.pageLabels,
				onRequestPassword,
				onSetThumbnails,
				onSetPageLabels,
				onDeleteAnnotations // For complete ink erase
			});

			if (primary) {
				initPDFPrintService({
					onProgress: (percent) => {
						this._updateState({ printPopup: { percent } });
					},
					onFinish: () => {
						this._updateState({ printPopup: null });
					},
					pdfView: view
				});
			}
		} else if (this._type === 'epub') {
			view = new EPUBView({
				...common,
				fontFamily: this._state.fontFamily,
				onEPUBEncrypted,
			});
		} else if (this._type === 'snapshot') {
			view = new SnapshotView({
				...common,
				onSetZoom
			});
		}

		if (primary) {
			view.initializedPromise.then(() => view.focus());
		}

		return view;
	}

	setErrorMessage(errorMessage) {
		this._updateState({ errorMessage });
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

	async navigate(location) {
		await this._lastView.initializedPromise;
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

	navigateToPreviousSection() {
		this._ensureType('epub');
		this._lastView.navigateToPreviousSection();
	}

	navigateToNextSection() {
		this._ensureType('epub');
		this._lastView.navigateToNextSection();
	}

	// Note: It's a bit weird, but this function is also used to deselect text in views, if an empty ids array is provided
	setSelectedAnnotations(ids, triggeredFromView, triggeringEvent) {
		// Switch to annotations view
		if (triggeredFromView && ids.length === 1 && this._state.sidebarOpen && this._state.sidebarView !== 'annotations') {
			this.setSidebarView('annotations');
		}
		let deleteIDs = [];
		for (let annotation of this._state.annotations) {
			if (annotation.type === 'text' && !annotation.comment && !ids.includes(annotation.id)) {
				deleteIDs.push(annotation.id);
			}
		}
		this._annotationManager.deleteAnnotations(deleteIDs)

		// Prevent accidental annotation deselection if modifier is pressed
		let shift = triggeringEvent ? triggeringEvent.shiftKey : this._keyboardManager.shift;
		let mod = triggeringEvent ? (triggeringEvent.ctrlKey || triggeringEvent.metaKey && isMac()) : this._keyboardManager.mod;
		// Note: Using this._state.selectedAnnotationIDs.length here and below to avoid
		// https://github.com/zotero/zotero/issues/3381 (annotation selection, even passing an empty array,
		// also triggers text deselection)
		// TODO: This prevents annotation deselection when holding shift and trying to select text under the annotation
		if (this._state.selectedAnnotationIDs.length && !ids.length && triggeredFromView && (shift || mod)) {
			return;
		}

		// TODO: This is temporary, until annotation selection and focus management is reworked
		if (this._state.selectedAnnotationIDs.length && !triggeringEvent && !shift && mod && !this._keyboardManager.pointerDown) {
			return;
		}

		this._enableAnnotationDeletionFromComment = false;
		this._annotationSelectionTriggeredFromView = triggeredFromView;
		if (ids.length === 1) {
			let id = ids[0];
			let annotation = this._annotationManager._annotations.find(x => x.id === id);
			if (annotation) {
				if (shift && this._state.selectedAnnotationIDs.length) {
					let selectedIDs = this._state.selectedAnnotationIDs.slice();
					let annotations = this._state.annotations.filter(x => !x._hidden);

					let annotationIndex = annotations.findIndex(x => x.id === id);
					let lastSelectedIndex = annotations.findIndex(x => x.id === selectedIDs.slice(-1)[0]);
					let selectedIndices = selectedIDs.map(id => annotations.findIndex(annotation => annotation.id === id));
					let minSelectedIndex = Math.min(...selectedIndices);
					let maxSelectedIndex = Math.max(...selectedIndices);
					if (annotationIndex < minSelectedIndex) {
						for (let i = annotationIndex; i < minSelectedIndex; i++) {
							selectedIDs.push(annotations[i].id);
						}
					}
					else if (annotationIndex > maxSelectedIndex) {
						for (let i = maxSelectedIndex + 1; i <= annotationIndex; i++) {
							selectedIDs.push(annotations[i].id);
						}
					}
					else {
						for (let i = Math.min(annotationIndex, lastSelectedIndex); i <= Math.max(annotationIndex, lastSelectedIndex); i++) {
							if (i === lastSelectedIndex) {
								continue;
							}
							let id = annotations[i].id;
							if (!selectedIDs.includes(id)) {
								selectedIDs.push(id);
							}
						}
					}
					this._updateState({ selectedAnnotationIDs: selectedIDs });
				}
				else if (mod && this._state.selectedAnnotationIDs.length) {
					let selectedIDs = this._state.selectedAnnotationIDs.slice();
					let existingIndex = selectedIDs.indexOf(id);
					if (existingIndex >= 0) {
						selectedIDs.splice(existingIndex, 1);
					}
					else {
						selectedIDs.push(id);
					}
					this._updateState({ selectedAnnotationIDs: selectedIDs });
				}
				else {
					this._updateState({ selectedAnnotationIDs: ids });

					if (triggeredFromView) {
						if (annotation.type !== 'text') {
							this._enableAnnotationDeletionFromComment = true;
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
					}
					else {
						this._lastView.navigate({ annotationID: annotation.id });
					}
				}
			}
			// Smoothly scroll to the annotation, if only one was selected
			if (this._state.selectedAnnotationIDs.length === 1) {
				// Wait a bit to make sure the annotation view is rendered
				setTimeout(() => {
					let sidebarItem = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
					if (sidebarItem) {
						sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
					}
				}, 50);
			}
		}
		else {
			this._updateState({ selectedAnnotationIDs: ids });
		}
	}

	setFontSize(fontSize) {
		this._updateState({ fontSize });
	}

	setFontFamily(fontFamily) {
		this._updateState({ fontFamily });
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

	focus() {
		this._focusManager.restoreFocus();
	}

	focusToolbar() {
		this._focusManager.focusToolbar();
	}

	freeze() {
		this._updateState({ freeze: true });
	}

	unfreeze() {
		this._updateState({ freeze: false });
	}

	print() {
		if (this._type === 'pdf') {
			if (this._state.annotations.length) {
				this._updateState({ printPopup: {} });
			}
			else {
				window.print();
			}
		}
		else {
			// Show print popup with indeterminate progress bar
			this._updateState({ printPopup: { percent: null } });
			this._primaryView.print().then(() => {
				this._updateState({ printPopup: null });
			});
		}
	}

	abortPrint() {
		if (this._type === 'pdf') {
			window.abortPrint();
		}
	}

	reload(data) {
		this._data = data;
		this._primaryViewContainer.replaceChildren();
		this._primaryView = this._createView(true);
		if (this._state.splitType) {
			this._secondaryViewContainer.replaceChildren();
			this._secondaryView = this._createView(false);
		}
	}

	enterPassword(password) {
		this._updateState({ passwordPopup: null });
		this._password = password;
		this.reload(this._data);
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
		// annotations = annotations.filter(x => x.type !== 'ink');
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
		window._draggingAnnotationIDs = annotations.map(x => x.id);
		// Clear image data set on some untested type (when drag is initiated on img),
		// which also prevents word processors from using `text/plain`, and
		// results to dumped base64 content (LibreOffice) or image (Google Docs)
		dataTransfer.clearData();
		dataTransfer.setData('text/plain', plainText || ' ');
		this._onSetDataTransferAnnotations(dataTransfer, annotations, fromText);
	}

	_handleOpenPageLabelPopup(id) {
		this._ensureType('pdf');
		let pageLabels = this._state.pageLabels;
		let selectedIDs = this._state.selectedAnnotationIDs;
		let currentAnnotation = this._annotationManager._getAnnotationByID(id);
		let selectedAnnotations = this._annotationManager._annotations.filter(x => selectedIDs.includes(x.id));
		let allAnnotations = this._annotationManager._annotations;
		// Get target rect from preview component in the sidebar or a view popup
		let labelNode = document.querySelector(`[data-sidebar-annotation-id="${id}"] header .label, .view-popup header .label`);
		let { left, top, right, bottom } = labelNode.getBoundingClientRect();
		let rect = [left, top, right, bottom];
		this._updateState({ labelPopup: { currentAnnotation, selectedAnnotations, allAnnotations, rect, selectedIDs, pageLabels } });
	}

	_handleLabelPopupClose() {
		this._updateState({ labelPopup: null });
	}

	_handleDeleteAnnotations = (ids) => {
		let primaryViewAnnotationPopup = this._state.primaryViewAnnotationPopup;
		if (primaryViewAnnotationPopup && ids.includes(primaryViewAnnotationPopup.annotation.id)) {
			primaryViewAnnotationPopup = null;
		}
		let secondaryViewAnnotationPopup = this._state.secondaryViewAnnotationPopup;
		if (secondaryViewAnnotationPopup && ids.includes(secondaryViewAnnotationPopup.annotation.id)) {
			secondaryViewAnnotationPopup = null;
		}
		this._updateState({
			primaryViewAnnotationPopup,
			secondaryViewAnnotationPopup
		});
		this._onDeleteAnnotations(ids);
	};

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
		this._ensureType('pdf', 'epub');
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).spreadMode;
	}

	set spreadMode(value) {
		this._ensureType('pdf', 'epub');
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

	get canNavigateToPreviousSection() {
		if (this._type !== 'epub') {
			return false;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateToPreviousSection;
	}

	get canNavigateToNextSection() {
		if (this._type !== 'epub') {
			return false;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).canNavigateToNextSection;
	}

	get flowMode() {
		if (this._type !== 'epub') {
			return undefined;
		}
		return (this._state.primary ? this._state.primaryViewStats : this._state.secondaryViewStats).flowMode;
	}

	set flowMode(value) {
		this._ensureType('epub');
		this._lastView.setFlowMode(value);
	}
}

export default Reader;
