import { createRoot } from 'react-dom/client';
import React, { createContext } from 'react';
import ReaderUI from './components/reader-ui';
import PDFView from '../pdf/pdf-view';
import EPUBView from '../dom/epub/epub-view';
import SnapshotView from '../dom/snapshot/snapshot-view';
import AnnotationManager from './annotation-manager';
import {
	createAnnotationContextMenu,
	createColorContextMenu,
	createSelectorContextMenu,
	createThemeContextMenu,
	createThumbnailContextMenu,
	createViewContextMenu
} from './context-menu';
import { initPDFPrintService } from '../pdf/pdf-print-service';
import { ANNOTATION_COLORS, DEBOUNCE_STATE_CHANGE, DEBOUNCE_STATS_CHANGE, DEFAULT_THEMES } from './defines';
import { FocusManager } from './focus-manager';
import { KeyboardManager } from './keyboard-manager';
import {
	getCurrentColorScheme,
	getImageDataURL, isMac,
	setMultiDragPreview,
} from './lib/utilities';
import { debounce } from './lib/debounce';
import { flushSync } from 'react-dom';
import { addFTL, getLocalizedString } from '../fluent';

// Compute style values for usage in views (CSS variables aren't sufficient for that)
// Font family is necessary for text annotations
window.computedFontFamily = window.getComputedStyle(document.body).getPropertyValue('font-family');
window.computedColorFocusBorder = window.getComputedStyle(document.body).getPropertyValue('--color-focus-border');
window.computedWidthFocusBorder = window.getComputedStyle(document.body).getPropertyValue('--width-focus-border');

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
		this._onBringReaderToFront = options.onBringReaderToFront;
		this._onTextSelectionAnnotationModeChange = options.onTextSelectionAnnotationModeChange;
		this._onSaveCustomThemes = options.onSaveCustomThemes;
		this._onSetLightTheme = options.onSetLightTheme;
		this._onSetDarkTheme = options.onSetDarkTheme;
		// Only used on Zotero client, sets text/plain and text/html values from Note Markdown and Note HTML translators
		this._onSetDataTransferAnnotations = options.onSetDataTransferAnnotations;
		this._onSetZoom = options.onSetZoom;

		if (Array.isArray(options.ftl)) {
			for (let ftl of options.ftl) {
				addFTL(ftl);
			}
		}

		this._readerRef = React.createRef();
		this._primaryView = null;
		this._secondaryView = null;
		this._lastViewPrimary = true;

		this.initializedPromise = new Promise(resolve => this._resolveInitializedPromise = resolve);

		this._splitViewContainer = document.getElementById('split-view');
		this._primaryViewContainer = document.getElementById('primary-view');
		this._secondaryViewContainer = document.getElementById('secondary-view');

		this._enableAnnotationDeletionFromComment = false;
		this._annotationSelectionTriggeredFromView = false;

		// Stores the default or current values for each annotation type
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
				size: 14
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

		let themes = [...DEFAULT_THEMES, ...(options.customThemes || [])];
		themes = new Map(themes.map(theme => [theme.id, theme]));
		let lightTheme = options.lightTheme && themes.get(options.lightTheme) || null;
		let darkTheme = options.darkTheme === undefined
			? DEFAULT_THEMES.find(x => x.id === 'dark')
			: themes.get(options.darkTheme) || null;

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
			hyphenate: options.hyphenate,
			showAnnotations: options.showAnnotations !== undefined ? options.showAnnotations : true, // show/hide annotations in views
			customThemes: options.customThemes || [],
			lightTheme,
			darkTheme,
			autoDisableNoteTool: options.autoDisableNoteTool !== undefined ? options.autoDisableNoteTool : true,
			autoDisableTextTool: options.autoDisableTextTool !== undefined ? options.autoDisableTextTool : true,
			autoDisableImageTool: options.autoDisableImageTool !== undefined ? options.autoDisableImageTool : true,
			textSelectionAnnotationMode: options.textSelectionAnnotationMode || 'highlight',
			colorScheme: options.colorScheme,
			tool: this._tools['pointer'], // Must always be a reference to one of this._tools objects
			thumbnails: [],
			outline: null, // null — loading, [] — empty
			outlineQuery: '',
			pageLabels: [],
			sidebarOpen: options.sidebarOpen !== undefined ? options.sidebarOpen : true,
			sidebarWidth: options.sidebarWidth !== undefined ? options.sidebarWidth : 240,
			sidebarView: 'annotations',
			contextPaneOpen: options.contextPaneOpen !== undefined ? options.contextPaneOpen : false,
			bottomPlaceholderHeight: options.bottomPlaceholderHeight || null,
			toolbarPlaceholderWidth: options.toolbarPlaceholderWidth || 0,
			showContextPaneToggle: options.showContextPaneToggle,
			enableAddToNote: false,
			labelPopup: null,
			passwordPopup: null,
			printPopup: null,
			appearancePopup: null,
			themePopup: null,
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
				index: null,
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
				index: null,
				result: null
			},
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
				this._onToolbarShiftTab?.();
			},
			onIframeTab: () => {
				this._onIframeTab?.();
			}
		});

		this._keyboardManager = new KeyboardManager({
			reader: this
		});

		this._annotationManager = new AnnotationManager({
			readOnly: this._state.readOnly,
			authorName: options.authorName,
			annotations: options.annotations,
			tools: this._tools,
			onSave: this._onSaveAnnotations,
			onDelete: this._handleDeleteAnnotations,
			onRender: (annotations) => {
				this._updateState({ annotations });
			},
			onChangeFilter: (filter) => {
				this._updateState({ filter });
			},
			adjustTextAnnotationPosition: (annotation, option) => {
				return this._primaryView.adjustTextAnnotationPosition(annotation, option);
			}
		});

		// Select the annotation instead of just navigating when to it when the location is provided externally
		let selectAnnotationID;
		if (
			options.location?.annotationID
			&& options.annotations.find(x => x.id === options.location.annotationID)
		) {
			selectAnnotationID = options.location.annotationID;
			delete options.location;
		}

		this._primaryView = this._createView(true, options.location);

		// Resolve the Reader's initializedPromise after the primary view is initialized
		this._primaryView.initializedPromise.then(() => {
			this._resolveInitializedPromise();
		});

		if (selectAnnotationID) {
			(async () => {
				await this._primaryView.initializedPromise;
				this.setSelectedAnnotations([selectAnnotationID]);
			})();
		}

		if (!this._preview) {
			createRoot(document.getElementById('reader-ui')).render(
				<ReaderContext.Provider value={this._readerContext}>
					<ReaderUI
						type={this._type}
						state={this._state}
						ref={this._readerRef}
						tools={this._tools}
						onSelectAnnotations={this.setSelectedAnnotations.bind(this)}
						onZoomIn={this.zoomIn.bind(this)}
						onZoomOut={this.zoomOut.bind(this)}
						onZoomReset={this.zoomReset.bind(this)}
						onNavigateBack={this.navigateBack.bind(this)}
						onNavigateToPreviousPage={this.navigateToPreviousPage.bind(this)}
						onNavigateToNextPage={this.navigateToNextPage.bind(this)}
						onChangePageNumber={pageNumber => this._lastView.navigate({ pageNumber })}
						onChangeTool={this.setTool.bind(this)}
						onToggleAppearancePopup={this.toggleAppearancePopup.bind(this)}
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
						onChangeTheme={(theme) => {
							if (getCurrentColorScheme(this._state.colorScheme) === 'dark') {
								// For Zotero client use prefs to change theme
								if (this._onSetDarkTheme) {
									this._onSetDarkTheme(theme);
								}
								else {
									this.setDarkTheme(theme);
								}
							}
							else {
								if (this._onSetLightTheme) {
									this._onSetLightTheme(theme);
								}
								else {
									this.setLightTheme(theme);
								}
							}
						}}
						onResizeSplitView={this.setSplitViewSize.bind(this)}
						onAddAnnotation={(annotation, select) => {
							annotation = this._annotationManager.addAnnotation(annotation);
							// Tell screen readers the annotation was added after focus is settled
							setTimeout(() => {
								let annotationType = getLocalizedString(`reader-${annotation.type}-annotation`);
								let msg = getLocalizedString('reader-a11y-annotation-created', { type: annotationType });
								this.setA11yMessage(msg);
							}, 100);
							if (select) {
								this.setSelectedAnnotations([annotation.id]);
							} else {
								this.setSelectedAnnotations([]);
							}
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
						onUpdateOutlineQuery={outlineQuery => this._updateState({ outlineQuery })}
						onRenderThumbnails={(pageIndexes) => this._primaryView._pdfThumbnails.render(pageIndexes)}
						onSetDataTransferAnnotations={this._handleSetDataTransferAnnotations.bind(this)}
						onOpenLink={this._onOpenLink}
						onChangeAppearance={this._handleAppearanceChange.bind(this)}
						onChangeFocusModeEnabled={this._handleFocusModeEnabledChange.bind(this)}
						onChangeFindState={this._handleFindStateChange.bind(this)}
						onFindNext={this.findNext.bind(this)}
						onFindPrevious={this.findPrevious.bind(this)}
						onToggleContextPane={this._onToggleContextPane}
						onChangeTextSelectionAnnotationMode={this.setTextSelectionAnnotationMode.bind(this)}
						onCloseOverlayPopup={this._handleOverlayPopupClose.bind(this)}
						onChangeSplitType={(type) => {
							if (type === 'horizontal') {
								this.toggleHorizontalSplit(true);
							}
							else if (type === 'vertical') {
								this.toggleVerticalSplit(true);
							}
							else {
								this.disableSplitView();
							}
						}}
						onChangeScrollMode={(mode) => this.scrollMode = mode}
						onChangeSpreadMode={(mode) => this.spreadMode = mode}
						onChangeFlowMode={(mode) => this.flowMode = mode}
						onAddTheme={() => this._updateState({ themePopup: {} })}
						onOpenThemeContextMenu={params => this._onOpenContextMenu(createThemeContextMenu(this, params))}
						onCloseThemePopup={() => this._updateState({ themePopup: null })}
						onSaveCustomThemes={(customThemes) => {
							this._onSaveCustomThemes(customThemes);
							let themes = [...DEFAULT_THEMES, ...(customThemes || [])];
							let map = new Map(themes.map(theme => [theme.id, theme]));
							let { lightTheme, darkTheme } = this._state;
							if (lightTheme && !map.has(lightTheme.id)) {
								lightTheme = null;
							}
							if (darkTheme && !map.has(darkTheme.id)) {
								darkTheme = null;
							}
							this._updateState({ themePopup: null, customThemes, lightTheme, darkTheme });
						}}
					/>
				</ReaderContext.Provider>
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

		if (this._state.outline !== previousState.outline) {
			this._primaryView?.setOutline(this._state.outline);
			this._secondaryView?.setOutline(this._state.outline);
		}

		if (init || this._state.lightTheme !== previousState.lightTheme) {
			if (!init) {
				this._primaryView?.setLightTheme(this._state.lightTheme);
				this._secondaryView?.setLightTheme(this._state.lightTheme);
			}
		}

		if (init || this._state.darkTheme !== previousState.darkTheme) {
			if (!init) {
				this._primaryView?.setDarkTheme(this._state.darkTheme);
				this._secondaryView?.setDarkTheme(this._state.darkTheme);
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

		if (this._type === 'epub' || this._type === 'snapshot') {
			if (this._state.fontFamily !== previousState.fontFamily) {
				this._primaryView?.setFontFamily(this._state.fontFamily);
				this._secondaryView?.setFontFamily(this._state.fontFamily);
			}

			if (this._state.hyphenate !== previousState.hyphenate) {
				this._primaryView?.setHyphenate(this._state.hyphenate);
				this._secondaryView?.setHyphenate(this._state.hyphenate);
			}
		}

		if (init || this._state.sidebarView !== previousState.sidebarView) {
			this._primaryView?.setSidebarView?.(this._state.sidebarView);
			this._secondaryView?.setSidebarView?.(this._state.sidebarView);
		}

		if (init || this._state.sidebarOpen !== previousState.sidebarOpen) {
			document.body.classList.toggle('sidebar-open', this._state.sidebarOpen);
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

	setAutoDisableNoteTool(autoDisable) {
		this._updateState({ autoDisableNoteTool: autoDisable });
	}

	setAutoDisableTextTool(autoDisable) {
		this._updateState({ autoDisableTextTool: autoDisable });
	}

	setAutoDisableImageTool(autoDisable) {
		this._updateState({ autoDisableImageTool: autoDisable });
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
		this._onBringReaderToFront?.(true);
		this._updateState({ contextMenu: params });
		setTimeout(() => {
			window.focus();
			document.activeElement.blur();
		});
	}

	closeContextMenu() {
		this._updateState({ contextMenu: null });
		this._focusManager.restoreFocus();
		this._onBringReaderToFront?.(false);
		document.querySelectorAll('.context-menu-open').forEach(x => x.classList.remove('context-menu-open'));
	}

	_handleAppearanceChange(params) {
		this._ensureType('epub', 'snapshot');
		this._primaryView?.setAppearance(params);
		this._secondaryView?.setAppearance(params);
	}

	_handleFocusModeEnabledChange(enabled) {
		this._ensureType('snapshot');
		try {
			this._primaryView?.setFocusModeEnabled(enabled);
			this._secondaryView?.setFocusModeEnabled(enabled);
		}
		catch (e) {
			console.error(e);
			this.setErrorMessage(this._getString('reader-focus-mode-not-supported'));
			setTimeout(() => {
				this.setErrorMessage(null);
			}, 5000);
		}
	}

	_handleFindStateChange(primary, params) {
		this._updateState({ [primary ? 'primaryViewFindState' : 'secondaryViewFindState']: params });
	}

	_handleOverlayPopupClose(primary) {
		this._updateState({ [primary ? 'primaryViewOverlayPopup' : 'secondaryViewOverlayPopup']: null });
	}

	setTextSelectionAnnotationMode(mode) {
		if (!['highlight', 'underline'].includes(mode)) {
			throw new Error(`Invalid 'textSelectionAnnotationMode' value '${mode}'`);
		}
		this._updateState({ textSelectionAnnotationMode: mode });
		this._onTextSelectionAnnotationModeChange(mode);
	}

	// Announce info about current search result to screen readers.
	// FindState is updated multiple times while navigating between results
	// so debounce is used to fire only after the last update.
	a11yAnnounceSearchMessage = debounce((findStateResult) => {
		if (!findStateResult) return;
		let { index, total, currentPageLabel, currentSnippet } = findStateResult;
		if (total == 0) {
			this.setA11yMessage(this._getString('reader-phrase-not-found'));
			return;
		}
		let searchIndex = `${this._getString('reader-search-result-index')}: ${index + 1}.`;
		let totalResults = `${this._getString('reader-search-result-total')}: ${total}.`;
		let page = currentPageLabel ? `${this._getString('reader-page')}: ${currentPageLabel}.` : '';
		this.setA11yMessage(`${searchIndex} ${totalResults} ${page} ${currentSnippet || ''}`);
	}, 100);

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

	toggleAppearancePopup(open) {
		let key = 'appearancePopup';
		if (open === undefined) {
			open = !this._state[key];
		}
		this._updateState({ [key]: open });
		if (!open) {
			this._lastView.focus();
		}
	}

	toggleFindPopup({ primary, open } = {}) {
		if (primary === undefined) {
			primary = this._lastViewPrimary;
		}
		let key = primary ? 'primaryViewFindState' : 'secondaryViewFindState';
		let prevFindState = this._state[key];
		if (open === undefined) {
			open = !prevFindState.popupOpen;
		}
		let findState = { ...prevFindState, popupOpen: open };
		if (!prevFindState.popupOpen) {
			findState.active = false;
			findState.result = null;
		}
		this._updateState({ [key]: findState });
		if (open) {
			setTimeout(() => {
				let selector = (primary ? '.primary-view' : '.secondary-view') + ' .find-popup input';
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

	_getString(name, args) {
		return getLocalizedString(name, args);
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
			// Tell screen readers the annotation was added after focus is settled
			setTimeout(() => {
				let annotationType = getLocalizedString(`reader-${annotation.type}-annotation`);
				let msg = getLocalizedString('reader-a11y-annotation-created', { type: annotationType });
				this.setA11yMessage(msg);
			}, 100);
			if (select) {
				this.setSelectedAnnotations([annotation.id], true);
			}
			if (
				annotation.type === 'note' && this._state.autoDisableNoteTool
				|| annotation.type === 'text' && this._state.autoDisableTextTool
				|| annotation.type === 'image' && this._state.autoDisableImageTool
			) {
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
			this.a11yAnnounceSearchMessage(params.result);
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
			this.setErrorMessage(this._getString('reader-epub-encrypted'));
		};

		let onFocusAnnotation = (annotation) => {
			if (!annotation) return;
			// Announce the link url
			if (annotation.type == 'external-link') {
				this.setA11yMessage(annotation.url);
				return;
			}
			// Announce the content of a focused citation
			if (annotation.type == 'citation') {
				this.setA11yMessage(`${annotation.references.map(r => r.text).join('')}`);
				return;
			}
			// Announce the type and content of annotations added by the user
			let annotationType = this._getString(`reader-${annotation.type}-annotation`);
			let annotationContent = `${annotationType}. ${annotation.text || annotation.comment}`;
			this.setA11yMessage(annotationContent);
		};

		let onSetHiddenAnnotations = (ids) => {
			this._annotationManager.setFilter({ hiddenIDs: ids });
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
			tools: this._tools, // Read-only. Useful for retrieving properties (e.g., size, color) from an inactive tool
			tool: this._state.tool,
			selectedAnnotationIDs: this._state.selectedAnnotationIDs,
			annotations: this._state.annotations.filter(x => !x._hidden),
			outline: this._state.outline,
			showAnnotations: this._state.showAnnotations,
			lightTheme: this._state.lightTheme,
			darkTheme: this._state.darkTheme,
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
			onKeyUp,
			onFocusAnnotation,
			onSetHiddenAnnotations,
			getLocalizedString
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
						this._handleSetPrintPopup({ percent });
					},
					onFinish: () => {
						this._handleSetPrintPopup(null);
					},
					pdfView: view
				});
			}
		} else if (this._type === 'epub') {
			view = new EPUBView({
				...common,
				fontFamily: this._state.fontFamily,
				hyphenate: this._state.hyphenate,
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

	// Set content of aria-live container that screen readers will announce
	setA11yMessage(a11yMessage) {
		// Voiceover won't announce messages inserted via <div id="a11yAnnouncement" aria-live="polite">{state.a11yMessage}</div>
		// but setting .innerText does work. Likely due to either voiceover bug or not full aria-live support by firefox.
		document.getElementById("a11yAnnouncement").innerText = a11yMessage;
	}

	getUnsavedAnnotations() {

	}

	deleteAnnotations(ids) {
		if (ids.length > 1) {
			if (!this._onConfirm(
				this._getString('reader-prompt-delete-annotations-title'),
				this._getString('reader-prompt-delete-annotations-text', { count: ids.length }),
				this._getString('general-delete')
			)) {
				return 0;
			}
		}
		let selectedAnnotationIDs = this._state.selectedAnnotationIDs.filter(id => !ids.includes(id));
		this._updateState({
			selectedAnnotationIDs,
			primaryViewAnnotationPopup: null,
			secondaryViewAnnotationPopup: null,
		});
		return this._annotationManager.deleteAnnotations(ids);
	}

	convertAnnotations(ids, type) {
		this._annotationManager.convertAnnotations(ids, type);
	}

	mergeAnnotations(ids) {
		return this._annotationManager.mergeAnnotations(ids);
	}

	/**
	 * @param {BufferSource} metadata
	 * @returns {{ count: number, lastModified?: Date }}
	 */
	getKOReaderAnnotationStats(metadata) {
		this._ensureType('epub');
		return this._primaryView.getKOReaderAnnotationStats(metadata);
	}

	/**
	 * @param {BufferSource} metadata
	 */
	importAnnotationsFromKOReaderMetadata(metadata) {
		this._ensureType('epub');
		this._primaryView.importAnnotationsFromKOReaderMetadata(metadata);
	}

	/**
	 * @param {string} metadata
	 * @returns {{ count: number, lastModified?: Date }}
	 */
	getCalibreAnnotationStats(metadata) {
		this._ensureType('epub');
		return this._primaryView.getCalibreAnnotationStats(metadata);
	}

	/**
	 * @param {string} metadata
	 */
	importAnnotationsFromCalibreMetadata(metadata) {
		this._ensureType('epub');
		this._primaryView.importAnnotationsFromCalibreMetadata(metadata);
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

	async navigate(location, options) {
		await this._lastView.initializedPromise;
		// Select the annotation instead of just navigating when navigation is triggered externally
		if (
			location.annotationID
			&& this._state.annotations.find(x => x.id === location.annotationID)
		) {
			this.setSelectedAnnotations([location.annotationID]);
		}
		else {
			this._lastView.navigate(location, options);
		}
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
		// Temporary workaround for deselecting annotations
		if (!ids.length && this._state.selectedAnnotationIDs.some(id => !this._state.annotations.find(x => x.id === id))) {
			this._updateState({ selectedAnnotationIDs: [] });
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

		// TODO: This is temporary, until annotation selection and focus management is reworked
		if (this._state.selectedAnnotationIDs.length && !triggeringEvent && !shift && mod && !this._keyboardManager.pointerDown) {
			return;
		}

		let reselecting = ids.length === 1 && this._state.selectedAnnotationIDs.includes(ids[0]);

		// Cache previous focus before it may be updated below
		let prevLastSelectedAnnotationID = this._lastSelectedAnnotationID;

		if (ids[0]) {
			this._lastSelectedAnnotationID = ids[0];
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

					let idxOf = (aid) => annotations.findIndex(a => a.id === aid);
					let curIndex = annotations.findIndex(x => x.id === id);

					// Derive an anchor from current selection and previous focus
					let anchorIndex;
					if (selectedIDs.length === 1) {
						anchorIndex = idxOf(selectedIDs[0]);
					}
					else {
						let selectedIdxs = selectedIDs.map(idxOf).filter(i => i >= 0).sort((a, b) => a - b);
						let low = selectedIdxs[0];
						let high = selectedIdxs[selectedIdxs.length - 1];
						let prevIdx = idxOf(prevLastSelectedAnnotationID);

						if (prevIdx >= 0) {
							// Use the endpoint opposite to the previous focus as the anchor
							anchorIndex = Math.abs(prevIdx - low) <= Math.abs(prevIdx - high) ? high : low;
						}
						else {
							// Fallback: pick the endpoint farther from the current index
							anchorIndex = Math.abs(curIndex - low) >= Math.abs(curIndex - high) ? low : high;
						}
					}

					// Select exactly the continuous range between anchor and current item (inclusive)
					if (curIndex >= 0 && anchorIndex >= 0) {
						let start = Math.min(anchorIndex, curIndex);
						let end = Math.max(anchorIndex, curIndex);
						selectedIDs = [];
						for (let i = start; i <= end; i++) {
							selectedIDs.push(annotations[i].id);
						}
						this._updateState({ selectedAnnotationIDs: selectedIDs });
					}
					else {
						// Fallback: keep previous selection if indices are not resolvable
						this._updateState({ selectedAnnotationIDs: selectedIDs });
					}
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

					// Don't navigate to annotation or focus comment if opening a context menu
					// unless it is a note (so that one can type after creating it via shortcut, same as with text annotation)
					if (!triggeringEvent || triggeringEvent.button !== 2) {
						if (triggeredFromView) {
							if (['note', 'highlight', 'underline', 'image'].includes(annotation.type)
								&& !annotation.comment
								&& (!triggeringEvent || !('key' in triggeringEvent) || annotation.type === 'note')
							) {
								this._enableAnnotationDeletionFromComment = true;
								setTimeout(() => {
									let content;
									if (this._state.sidebarOpen && this._state.sidebarView === 'annotations') {
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
					// After a small delay for focus to settle, announce to screen readers that annotation
					// is selected and how one can manipulate it
					setTimeout(() => {
						let annotationType = getLocalizedString(`reader-${annotation.type}-annotation`);
						let a11yAnnouncement = getLocalizedString('reader-a11y-annotation-selected', { type: annotationType });
						// Announce if there is a popup.
						if (document.querySelector('.annotation-popup')) {
							a11yAnnouncement += ' ' + getLocalizedString('reader-a11y-annotation-popup-appeared');
						}
						// Announce available keyboard interface options for this annotation type
						if (['highlight', 'underline'].includes(annotation.type)) {
							a11yAnnouncement += ' ' + getLocalizedString('reader-a11y-edit-text-annotation');
						}
						else if (['note', 'text', 'image'].includes(annotation.type)) {
							a11yAnnouncement += ' ' + getLocalizedString('reader-a11y-move-annotation');
							if (['text', 'image'].includes(annotation.type)) {
								a11yAnnouncement += ' ' + getLocalizedString('reader-a11y-resize-annotation');
							}
						}
						// only announce if the content view is focused. E.g. if comment in
						// sidebar has focus, say nothing as it will not be relevant
						if (document.activeElement.nodeName === 'IFRAME') {
							this.setA11yMessage(a11yAnnouncement);
						}
					}, 100);
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

	setHyphenate(hyphenate) {
		this._updateState({ hyphenate });
	}

	setSidebarView(view) {
		this._updateState({ sidebarView: view });
	}

	setCustomThemes(customThemes) {
		this._updateState({ customThemes });

		let themes = [...DEFAULT_THEMES, ...(customThemes || [])];
		themes = new Map(themes.map(theme => [theme.id, theme]));

		let lightThemeID = this._state.lightTheme?.id;
		if (lightThemeID) {
			let lightTheme = themes.get(lightThemeID) || null;
			this._updateState({ lightTheme });
		}

		let darkThemeID = this._state.darkTheme?.id;
		if (darkThemeID) {
			let darkTheme = themes.get(darkThemeID) || null;
			this._updateState({ darkTheme });
		}
	}

	setLightTheme(themeName) {
		let themes = [...DEFAULT_THEMES, ...(this._state.customThemes || [])];
		themes = new Map(themes.map(theme => [theme.id, theme]));
		let lightTheme = themes.get(themeName) || null;
		this._updateState({ lightTheme });
	}

	setDarkTheme(themeName) {
		let themes = [...DEFAULT_THEMES, ...(this._state.customThemes || [])];
		themes = new Map(themes.map(theme => [theme.id, theme]));
		let darkTheme = themes.get(themeName) || null;
		this._updateState({ darkTheme });
	}

	toggleSidebar(open) {
		if (open === undefined) {
			open = !this._state.sidebarOpen;
		}
		this._updateState({ sidebarOpen: open });
	}

	setContextPaneOpen(open) {
		// Our context pane toggle will replace the sidenav context pane toggle,
		// so we need to be sure that this update renders synchronously
		flushSync(() => {
			this._updateState({ contextPaneOpen: open });
		});
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
				this._handleSetPrintPopup({});
			}
			else {
				window.print();
			}
		}
		else {
			// Show print popup with indeterminate progress bar
			this._handleSetPrintPopup(null);
			this._primaryView.print().then(() => {
				this._handleSetPrintPopup(null);
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
		this._onBringReaderToFront?.(true);
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
		this._onBringReaderToFront?.(false);
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

	_handleSetPrintPopup(state) {
		this._onBringReaderToFront?.(!!state);
		this._updateState({ printPopup: state });
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
