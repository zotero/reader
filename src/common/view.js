import PDFView from '../pdf/pdf-view';
import EPUBView from '../dom/epub/epub-view';
import SnapshotView from '../dom/snapshot/snapshot-view';
import SDTView from '../dom/sdt/sdt-view';
import { debounce } from './lib/debounce';
import AnnotationManager from './annotation-manager';
import {
	BASE_VIEW_STATS_KEYS,
	DEBOUNCE_STATE_CHANGE,
	DEBOUNCE_STATS_CHANGE,
	DEFAULT_THEMES,
	SDT_ANNOTATION_TYPES,
} from './defines';
import { getCurrentColorScheme } from './lib/utilities';
import { SDTDocumentSession } from './sdt/document-session.mjs';
import { isSDTPosition } from './types';
import { getTextNodeSpans } from './sdt/position-mapper';
import { buildSDTReadAloudSegments, getSDTLang } from './read-aloud/sdt-segments';

let nop = () => undefined;

class View {
	constructor(options) {
		// Direct mobile View entry points don't initialize these in Reader.
		let computedStyle = window.getComputedStyle(document.body);
		window.computedFontFamily = computedStyle.getPropertyValue('font-family');
		window.computedColorFocusBorder = computedStyle.getPropertyValue('--color-focus-border');
		window.computedWidthFocusBorder = computedStyle.getPropertyValue('--width-focus-border');

		this._type = options.type;
		this._options = options;
		this._sdtDocumentSession = new SDTDocumentSession({
			documentType: this._type,
			retainReader: false,
		});

		// This is quite hacky, but this way we enable search functionality over the existing findState
		this._findState = {
			active: !!options.findParams,
			query: '',
			highlightAll: true,
			caseSensitive: false,
			entireWord: false,
			index: null,
			result: null,
			// View can be created with an active search
			...(options.findParams || {})
		};

		this._lightTheme = (options.lightTheme && DEFAULT_THEMES.find(x => x.id === options.lightTheme))
			?? null;
		this._darkTheme = options.darkTheme
			? DEFAULT_THEMES.find(x => x.id === options.darkTheme) ?? null
			: DEFAULT_THEMES.find(x => x.id === 'dark');
		this._colorScheme = options.colorScheme;
		this._tool = options.tool || { type: 'pointer' };

		// Reading Mode overlay, shown on top of the (hidden) base view
		this._sdtView = null;
		this._readingModeQueue = null;
		this._baseViewOutline = undefined;
		this._baseViewStats = null;
		this._sdtViewStats = null;
		this._emitViewStats = debounce(this._options.onChangeViewStats, DEBOUNCE_STATS_CHANGE);

		this._view = this._createView();
		this._annotationManager = new AnnotationManager({
			readOnly: options.readOnly,
			authorName: options.authorName,
			annotations: options.annotations,
			// Mobile apps receive annotation data only via onSaveAnnotations, while other
			// events (e.g. onSelectAnnotations) can reference annotation IDs, so a new
			// annotation must always be delivered before anything can refer to it
			saveNewAnnotationsImmediately: true,
			onSave: options.onSaveAnnotations,
			onDelete: options.onDeleteAnnotations || nop,
			adjustTextAnnotationPosition: (annotation, adjustOptions) => this._view.adjustTextAnnotationPosition(annotation, adjustOptions),
			onRender: (annotations) => {
				this._view.setAnnotations(annotations);
				this._sdtView?.setAnnotations(this._getSDTAnnotations(annotations));
			},
			onChangeFilter: nop
		});
	}

	_ensureType() {
		if (!Array.from(arguments).includes(this._type)) {
			throw new Error(`The operation is not supported for '${this._type}'`);
		}
	}

	// The view the user currently interacts with: the Reading Mode overlay
	// when enabled, otherwise the base view
	get _activeView() {
		return this._sdtView || this._view;
	}

	_getCommonViewOptions() {
		let onAddAnnotation = (annotation, select) => {
			annotation = this._annotationManager.addAnnotation(annotation);
			// Select like reader.js does, otherwise e.g. an empty text annotation created
			// with a non-touch pointer would be left unselected and deleted by the
			// empty-annotation cleanup on the next selection change
			if (annotation && select) {
				this.selectAnnotations([annotation.id]);
			}
			return annotation;
		};

		let onUpdateAnnotations = (annotations) => {
			this._annotationManager.updateAnnotations(annotations);
		};

		let onSetFindState = (params) => {
			this._findState = params;
			this._options.onFindResult(params.result);
		};

		let common = {
			primary: true,
			platform: this._options.platform,
			mobile: true,
			showAnnotations: true,
			container: this._options.container,
			data: this._options.data,
			tool: this._tool,
			selectedAnnotationIDs: this._options.selectedAnnotationIDs || [],
			findState: this._findState,
			lightTheme: this._lightTheme,
			darkTheme: this._darkTheme,
			colorScheme: this._colorScheme,
			penActive: this._options.penActive ?? false,
			penExclusive: this._options.penExclusive ?? false,
			fontFamily: this._options.fontFamily,
			onAddAnnotation,
			onUpdateAnnotations,
			onOpenLink: this._options.onOpenLink,
			onSetSelectionPopup: this._options.onSetSelectionPopup,
			onSetAnnotationPopup: this._options.onSetAnnotationPopup,
			onSetFindState,
			onSelectAnnotations: this._options.onSelectAnnotations,
			onSetDataTransferAnnotations: nop,
			onFocus: nop,
			onOpenAnnotationContextMenu: nop,
			onOpenViewContextMenu: nop,
			onSetOverlayPopup: nop,
			onTabOut: nop,
			onKeyDown: nop,
			onKeyUp: nop,
			onFocusAnnotation: nop,
			onBackdropTap: this._options.onBackdropTap,
			onEdgePageTurnTap: this._options.onEdgePageTurnTap,
		};
		return common;
	}

	_createView() {
		let common = {
			...this._getCommonViewOptions(),
			annotations: this._options.annotations || [],
			viewState: this._options.viewState || null,
			location: this._options.location || null,
			onChangeViewState: debounce(this._options.onChangeViewState, DEBOUNCE_STATE_CHANGE),
			onChangeViewStats: (stats) => {
				this._baseViewStats = stats;
				this._handleViewStatsChange();
			},
			onSetOutline: (outline) => {
				// Keep the base view's outline to restore once Reading Mode is disabled
				this._baseViewOutline = outline;
				if (!this._sdtView) {
					this._options.onSetOutline(outline);
				}
				// Propagate back to view, as in Reader
				this._view.setOutline(outline);
			},
		};

		let view;
		if (this._type === 'pdf') {
			view = new PDFView({
				...common,
				password: this._options.password,
				pageLabels: this._options.pageLabels || [],
				onRequestPassword: this._options.onRequestPassword || nop,
				onInitThumbnails: this._options.onInitThumbnails,
				onSetThumbnails: this._options.onSetThumbnails || nop,
				onRenderThumbnail: this._options.onRenderThumbnail,
				onRenderAnnotationImage: this._options.onRenderAnnotationImage,
				onSetPageLabels: this._options.onSetPageLabels || nop,
				// PDF can delete annotations inside the view, for example by completely erasing ink.
				onDeleteAnnotations: this._options.onDeleteAnnotations || nop
			});
		}
		else if (this._type === 'epub') {
			view = new EPUBView({
				...common
			});
		}
		else if (this._type === 'snapshot') {
			view = new SnapshotView({
				...common
			});
		}
		else {
			throw new Error('Invalid view type');
		}
		view.initializedPromise.then((initialized) => {
			if (this._type !== 'pdf'
					|| (initialized !== false && this._view === view)) {
				this._options.onInitialized();
			}
		});
		return view;
	}

	_getSDTAnnotations(annotations) {
		return annotations.filter(x => SDT_ANNOTATION_TYPES.includes(x.type));
	}

	// Only text annotation tools work in Reading Mode
	_getSDTTool(tool) {
		return SDT_ANNOTATION_TYPES.includes(tool.type) ? tool : { type: 'pointer' };
	}

	// While Reading Mode is enabled, page numbers and progress keep coming from
	// the base view (which the overlay scroll-syncs), and everything else from
	// the overlay
	_handleViewStatsChange() {
		let stats = this._baseViewStats;
		if (this._sdtView && this._sdtViewStats) {
			stats = { ...this._sdtViewStats };
			for (let key of BASE_VIEW_STATS_KEYS) {
				if (this._baseViewStats && key in this._baseViewStats) {
					stats[key] = this._baseViewStats[key];
				}
				else {
					delete stats[key];
				}
			}
		}
		if (stats) {
			this._emitViewStats(stats);
		}
	}

	_createSDTView(sdt) {
		let baseView = this._view;
		let view = new SDTView({
			...this._getCommonViewOptions(),
			tool: this._getSDTTool(this._tool),
			annotations: this._getSDTAnnotations([...this._annotationManager._annotations]),
			viewState: {},
			location: baseView.getSDTLocation?.(sdt.structure) ?? null,
			// The base view keeps providing the view state, since it's scroll-synced
			// and can be restored without Reading Mode
			onChangeViewState: nop,
			onChangeViewStats: (stats) => {
				if (this._sdtView !== view) {
					return;
				}
				this._sdtViewStats = stats;
				this._handleViewStatsChange();
			},
			onSetOutline: (outline) => {
				if (this._sdtView !== view) {
					return;
				}
				this._options.onSetOutline(outline);
				view.setOutline(outline);
			},
			data: {
				structure: sdt.structure,
				mapper: sdt.mapper,
				paged: this._type === 'pdf',
				getSourceAnnotationMeta: position => baseView.getAnnotationMeta?.(position) ?? null,
				syncBaseView: (blockIndex) => {
					baseView.navigateToSDTBlock?.(sdt.structure, blockIndex);
				},
				getImageForBlock: (blockRef) => {
					return baseView.getSDTBlockImage?.(sdt.structure, blockRef)
						?? Promise.resolve(null);
				},
				getBlockCrops: this._type === 'pdf'
					? baseView.createSDTBlockCropProvider?.(sdt.structure)
					: undefined,
			},
		});
		return view;
	}

	_destroySDTView() {
		let view = this._sdtView;
		this._sdtView = null;
		this._sdtViewStats = null;
		view._iframe?.remove();
		view.destroy();

		let baseIframe = this._view._iframe;
		if (baseIframe) {
			baseIframe.style.visibility = '';
			baseIframe.style.position = '';
		}
		if (this._baseViewOutline !== undefined) {
			this._options.onSetOutline(this._baseViewOutline);
		}
		this._handleViewStatsChange();
	}

	/**
	 * Enable or disable Reading Mode, which displays the document's structured
	 * text as reflowable HTML over the base view. Requires `setSDTPack` to have
	 * been called. Only highlight, underline, and note annotations can be
	 * created and are displayed while Reading Mode is enabled; other tools fall
	 * back to the pointer tool.
	 * @param {boolean} enabled
	 * @returns {Promise<boolean>} Whether Reading Mode is enabled afterwards
	 */
	setReadingModeEnabled(enabled) {
		this._ensureType('pdf', 'snapshot');
		// Serialize transitions so rapid toggles don't create two overlay views
		let apply = async () => {
			if (enabled && !this._sdtView) {
				let sdt = await this._loadSDT();
				if (!sdt) {
					throw new Error('SDT unavailable');
				}
				let baseIframe = this._view._iframe;
				if (baseIframe) {
					baseIframe.style.visibility = 'hidden';
					baseIframe.style.position = 'absolute';
				}
				this._sdtView = this._createSDTView(sdt);
				let initialized = await this._sdtView.initializedPromise;
				if (initialized === false) {
					this._destroySDTView();
					throw new Error('Reading Mode failed to initialize');
				}
			}
			else if (!enabled && this._sdtView) {
				this._destroySDTView();
			}
			return !!this._sdtView;
		};

		let next = Promise.resolve(this._readingModeQueue).then(apply);
		this._readingModeQueue = next.catch(() => {});
		return next;
	}

	get readingModeEnabled() {
		return !!this._sdtView;
	}

	/**
	 * Add/replace annotations in the view
	 * @param annotations
	 */
	setAnnotations(annotations) {
		this._annotationManager.setAnnotations(annotations);
	}

	// Remove annotations from the view
	unsetAnnotations(ids) {
		this._annotationManager.unsetAnnotations(ids);
	}

	/**
	 * @param {String} [params.query]
	 * @param {String} [params.highlightAll]
	 * @param {String} [params.caseSensitive]
	 * @param {String} [params.entireWord]
	 * @param {String} [params.index] Focus specific result
	 */
	find(params) {
		let active = !!params;
		if (active === this._findState.active) {
			this._activeView.setFindState({
				...this._findState,
				...(params || {})
			});
		}
		else {
			this._activeView.setFindState({
				active,
				query: '',
				highlightAll: true,
				caseSensitive: false,
				entireWord: false,
				index: null,
				result: null,
				...(params || {})
			});
		}
	}

	findNext() {
		this._activeView.findNext();
	}

	findPrevious() {
		this._activeView.findPrevious();
	}

	/**
	 * Set/unset annotation tool
	 *
	 * @param {Object|undefined} tool Examples: { type: 'highlight', color: '#ffd400' }, or undefined to deactivate the tool
	 */
	setTool(tool) {
		if (!tool) {
			tool = { type: 'pointer' };
		}
		this._tool = tool;
		this._view.setTool(tool);
		this._sdtView?.setTool(this._getSDTTool(tool));
	}

	get canUndo() {
		return this._annotationManager.canUndo;
	}

	get canRedo() {
		return this._annotationManager.canRedo;
	}

	undo() {
		this._annotationManager.undo();
		this._deselectAnnotations();
	}

	redo() {
		this._annotationManager.redo();
		this._deselectAnnotations();
	}

	// Deselect without the empty-text-annotation cleanup, so that undo/redo
	// can restore an annotation to its empty state
	_deselectAnnotations() {
		this._options.selectedAnnotationIDs = [];
		this._view.setSelectedAnnotationIDs([]);
		this._sdtView?.setSelectedAnnotationIDs([]);
	}

	/**
	 * @param {Array} ids Array of annotation ids (item keys)
	 */
	selectAnnotations(ids) {
		if (this._options.onDeleteAnnotations) {
			this._annotationManager.deleteEmptyTextAnnotationsExcept(ids);
		}
		this._options.selectedAnnotationIDs = ids;
		this._view.setSelectedAnnotationIDs(ids);
		this._sdtView?.setSelectedAnnotationIDs(ids);
	}

	getSelectedAnnotationIDs() {
		return (this._options.selectedAnnotationIDs || []).slice();
	}

	getFocusedTextAnnotationID() {
		return this._activeView.getFocusedTextAnnotationID?.() || null;
	}

	finishTextAnnotationEditing() {
		return this._activeView.finishTextAnnotationEditing?.() || false;
	}

	zoomIn() {
		this._activeView.zoomIn();
	}

	zoomOut() {
		this._activeView.zoomOut();
	}

	zoomBy(delta) {
		this._activeView.zoomBy(delta);
	}

	zoomReset() {
		this._activeView.zoomReset();
	}

	navigate(location) {
		this._activeView.navigate(location);
	}

	// Group live PDF navigation into one Back/Forward step. End also on cancellation.
	beginNavigation() {
		this._ensureType('pdf');
		this._view.beginNavigation();
	}

	endNavigation() {
		this._ensureType('pdf');
		return this._view.endNavigation();
	}

	/**
	 * Navigate to the previous position in the document
	 */
	navigateBack() {
		this._activeView.navigateBack();
	}

	/**
	 * Navigate to the latest position in the document
	 */
	navigateForward() {
		this._activeView.navigateForward();
	}

	enterPassword(password) {
		this._ensureType('pdf');
		this._options.password = password;
		if (this._view.enterPassword?.(password)) {
			return;
		}
		if (this._sdtView) {
			this._destroySDTView();
		}
		if (this._type === 'pdf') {
			this._view.destroy?.();
		}
		this._options.container.replaceChildren();
		this._view = this._createView();
		this._view.setAnnotations([...this._annotationManager._annotations]);
		this._view.setSelectedAnnotationIDs(this._options.selectedAnnotationIDs || []);
	}

	/**
	 * Change flow mode
	 * @param mode paginated|scrolled
	 */
	setFlowMode(mode) {
		this._ensureType('epub');
		this._view.setFlowMode(mode);
	}

	/**
	 * @param {number} mode 0 - vertical, 1 - horizontal, 2 - wrapped
	 */
	setScrollMode(mode) {
		this._ensureType('pdf');
		this._view.setScrollMode(mode);
	}

	/**
	 * @param {import('../dom/epub/epub-view').SpreadMode} mode
	 */
	setSpreadMode(mode) {
		this._ensureType('pdf', 'epub');
		this._view.setSpreadMode(mode);
	}

	/**
	 * @returns {string} Theme ID
	 */
	getTheme() {
		let theme = getCurrentColorScheme(this._colorScheme) === 'dark'
			? this._darkTheme
			: this._lightTheme;
		return theme?.id ?? 'light';
	}

	/**
	 * @param {string} themeID
	 */
	setTheme(themeID) {
		let themes = new Map(DEFAULT_THEMES.map(theme => [theme.id, theme]));
		let theme = themes.get(themeID) || null;
		if (getCurrentColorScheme(this._colorScheme) === 'dark') {
			this._darkTheme = theme;
			this._view.setDarkTheme(theme);
			this._sdtView?.setDarkTheme(theme);
		}
		else {
			this._lightTheme = theme;
			this._view.setLightTheme(theme);
			this._sdtView?.setLightTheme(theme);
		}
	}

	/**
	 * @returns {'light' | 'dark' | null}
	 */
	getColorScheme() {
		return this._colorScheme;
	}

	/**
	 * @param {'light' | 'dark' | null} scheme
	 */
	setColorScheme(scheme) {
		this._colorScheme = scheme;
		this._view.setColorScheme(scheme);
		this._sdtView?.setColorScheme(scheme);
	}

	setPenActive(penActive) {
		this._view.setPenActive(penActive);
		this._sdtView?.setPenActive(penActive);
	}

	setPenExclusive(penExclusive) {
		this._view.setPenExclusive(penExclusive);
		this._sdtView?.setPenExclusive(penExclusive);
	}

	setFontFamily(fontFamily) {
		this._view.setFontFamily(fontFamily);
		this._sdtView?.setFontFamily(fontFamily);
	}

	setPageLabels(pageLabels) {
		this._view.setPageLabels?.(pageLabels);
	}

	/**
	 * Render PDF page thumbnails, preserving page aspect ratio within the
	 * optional logical-pixel bounds. With no bounds, the legacy 120px maximum
	 * width is used.
	 * @param {number[]} pageIndexes
	 * @param {{ maxWidth?: number, maxHeight?: number }} [options]
	 */
	renderThumbnails(pageIndexes, options) {
		this._ensureType('pdf');
		this._view.renderThumbnails?.(pageIndexes, options);
	}

	/**
	 * Request images for ink/image annotations. Each is rendered once and
	 * delivered via onRenderAnnotationImage; request again to refresh an image
	 * after the annotation changes. An unknown id, or one of an annotation
	 * that has no image, is answered with an empty string.
	 * Providing onRenderAnnotationImage also stops annotation images from
	 * being rendered at load and included in onSaveAnnotations
	 * @param {Array} ids Array of annotation ids (item keys)
	 */
	renderAnnotationImages(ids) {
		this._ensureType('pdf');
		this._view.renderAnnotationImages?.(ids);
	}

	setReadAloudSpotlight(selector) {
		// PDF can only show the spotlight in Reading Mode
		if (!this._sdtView) {
			this._ensureType('epub', 'snapshot');
		}
		this._activeView.setSpotlight('ReadAloudActiveSegment', selector, null);
		if (selector) {
			this._activeView.navigate({ position: selector }, {
				ifNeeded: true,
				block: 'center',
				behavior: 'smooth'
			});
		}
	}

	// Store an SDT pack for later operations.
	setSDTPack(pack) {
		this._sdtDocumentSession.setPack(pack);
	}

	async _loadSDT() {
		return this._sdtDocumentSession.getDocument();
	}

	async sdtAnchorToPosition(sdtAnchor) {
		let sdt = await this._loadSDT();
		return sdt ? sdt.mapper.sdtToSourcePosition(sdtAnchor) : null;
	}

	/**
	 * Structured-document-text position for a source position (an EPUB CFI `FragmentSelector`, a snapshot `CssSelector`),
	 * or null when it can't be mapped. Positions that are already SDT positions (Reading mode) pass through. The inverse
	 * of `sdtAnchorToPosition`; requires `setSDTPack` to have been called.
	 * @returns {Promise<SDTPosition | null>}
	 */
	async sourceToSDTPosition(position) {
		if (!position) {
			return null;
		}
		if (isSDTPosition(position)) {
			return position;
		}
		let sdt = await this._loadSDT();
		return sdt ? sdt.mapper.sourceToSDTPosition(position) : null;
	}

	/**
	 * Top-level structured-document-text block index currently in view, or null. Used to start Read Aloud playback
	 * where the reader is.
	 * @returns {Promise<number | null>}
	 */
	async getVisibleBlockIndex() {
		let sdt = await this._loadSDT();
		return sdt ? (this._activeView.getVisibleBlockIndex?.(sdt.structure) ?? null) : null;
	}

	async createAnnotationFromSDT({ sdtAnchor, type, color, comment, tags }) {
		let sdt = await this._loadSDT();
		if (!sdt) {
			return null;
		}
		let built = this._buildAnnotationFromSDT(sdt, sdtAnchor, type);
		if (!built) {
			return null;
		}
		return this._annotationManager.addAnnotation({
			type,
			color,
			comment,
			tags,
			position: built.position,
			text: built.text,
			sortIndex: built.sortIndex,
			pageLabel: built.pageLabel,
		});
	}

	/**
	 * @param {ReadAloudGranularity} granularity
	 * @returns {Promise<ReadAloudSegment[] | null>}
	 */
	async getReadAloudSegments(granularity) {
		let sdt = await this._loadSDT();
		if (!sdt) {
			return null;
		}
		let lang = getSDTLang(sdt.structure);
		let { segments } = buildSDTReadAloudSegments(sdt.structure, granularity, lang);
		return segments;
	}

	/**
	 * @param {string} [id] If set, resize an existing annotation
	 * @param {SDTPosition} startPosition
	 * @param {SDTPosition} [endPosition] Defaults to startPosition
	 * @param {AnnotationType} type
	 * @param {string} color
	 * @param {string} [comment]
	 * @param {string[]} [tags]
	 * @returns {Promise<import('./types').Annotation | null>}
	 */
	async setReadAloudAnnotation({ id, startPosition, endPosition, type, color, comment, tags }) {
		let sdt = await this._loadSDT();
		if (!sdt) {
			return null;
		}
		let sdtAnchor = {
			start: startPosition.start,
			end: (endPosition || startPosition).end,
		};
		let built = this._buildAnnotationFromSDT(sdt, sdtAnchor, type);
		if (!built) {
			return null;
		}
		if (id && this._annotationManager._getAnnotationByID(id)) {
			let update = {
				id,
				position: built.position,
				sortIndex: built.sortIndex,
				pageLabel: built.pageLabel,
				text: built.text,
			};
			// Only overwrite type/color when explicitly provided, so a resize
			// preserves them
			if (type) {
				update.type = type;
			}
			if (color) {
				update.color = color;
			}
			this._annotationManager.updateAnnotations([update]);
			return this._annotationManager._getAnnotationByID(id);
		}
		return this._annotationManager.addAnnotation({
			type,
			color,
			comment,
			tags,
			position: built.position,
			text: built.text,
			sortIndex: built.sortIndex,
			pageLabel: built.pageLabel,
		});
	}

	// Map an SDT range to a source position, sortIndex/pageLabel, and text.
	_buildAnnotationFromSDT(sdt, sdtAnchor, type) {
		let spans = getTextNodeSpans(sdt.structure, sdtAnchor);
		let position = sdt.mapper.textNodeSpansToSourcePosition(spans);
		if (!position) {
			return null;
		}
		// Adjust for format conventions (e.g. PDF notes -> fixed-size rect)
		position = sdt.mapper.transformAnnotationPosition(position, type);
		// sortIndex and pageLabel can only come from the live view
		let meta = this._view.getAnnotationMeta?.(position);
		if (!meta) {
			return null;
		}
		let text = spans.map(s => s.node.text.slice(s.start, s.end)).join('');
		return { position, text, sortIndex: meta.sortIndex, pageLabel: meta.pageLabel };
	}
}

export default View;
