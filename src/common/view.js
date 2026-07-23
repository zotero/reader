import PDFView from '../pdf/pdf-view';
import EPUBView from '../dom/epub/epub-view';
import SnapshotView from '../dom/snapshot/snapshot-view';
import { debounce } from './lib/debounce';
import AnnotationManager from './annotation-manager';
import { DEBOUNCE_STATE_CHANGE, DEBOUNCE_STATS_CHANGE, DEFAULT_THEMES } from './defines';
import { getCurrentColorScheme } from './lib/utilities';
import pako from 'pako';
import { createPositionMapper } from './sdt/create-position-mapper';
import { getTextNodeSpans } from './sdt/position-mapper';
import { buildSDTReadAloudSegments, getSDTLang } from './read-aloud/sdt-segments';
import {
	openStructuredDocumentTextPack,
	SDT_PACK_VERSION,
	SDT_SCHEMA_VERSION,
} from '../../structured-document-text/src/read.js';

let nop = () => undefined;

class View {
	constructor(options) {
		this._type = options.type;
		this._options = options;

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

		this._view = this._createView();
		this._annotationManager = new AnnotationManager({
			readOnly: options.readOnly,
			authorName: options.authorName,
			annotations: options.annotations,
			onSave: options.onSaveAnnotations,
			onDelete: nop,
			adjustTextAnnotationPosition: (annotation, adjustOptions) => this._view.adjustTextAnnotationPosition(annotation, adjustOptions),
			onRender: (annotations) => {
				this._view.setAnnotations(annotations);
			},
			onChangeFilter: nop
		});
	}

	_ensureType() {
		if (!Array.from(arguments).includes(this._type)) {
			throw new Error(`The operation is not supported for '${this._type}'`);
		}
	}

	_createView() {
		let onAddAnnotation = async (annotation) => {
			await this._annotationManager.addAnnotation(annotation);
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
			tool: this._options.tool || { type: 'pointer' },
			selectedAnnotationIDs: this._options.selectedAnnotationIDs || [],
			annotations: this._options.annotations || [],
			findState: this._findState,
			viewState: this._options.viewState || null,
			location: this._options.location || null,
			lightTheme: this._lightTheme,
			darkTheme: this._darkTheme,
			colorScheme: this._colorScheme,
			penActive: this._options.penActive ?? false,
			penExclusive: this._options.penExclusive ?? false,
			fontFamily: this._options.fontFamily,
			onChangeViewState: debounce(this._options.onChangeViewState, DEBOUNCE_STATE_CHANGE),
			onChangeViewStats: debounce(this._options.onChangeViewStats, DEBOUNCE_STATS_CHANGE),
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
			onSetOutline: (outline) => {
				this._options.onSetOutline(outline);
				// Propagate back to view, as in Reader
				this._view.setOutline(outline);
			},
			onTabOut: nop,
			onKeyDown: nop,
			onKeyUp: nop,
			onFocusAnnotation: nop,
			onBackdropTap: this._options.onBackdropTap,
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
		view.initializedPromise.then(() => this._options.onInitialized());
		return view;
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
			this._view.setFindState({
				...this._findState,
				...(params || {})
			});
		}
		else {
			this._view.setFindState({
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
		this._view.findNext();
	}

	findPrevious() {
		this._view.findPrevious();
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
		this._view.setTool(tool);
	}

	get canUndo() {
		return this._annotationManager.canUndo;
	}

	get canRedo() {
		return this._annotationManager.canRedo;
	}

	undo() {
		this._annotationManager.undo();
		this.selectAnnotations([]);
	}

	redo() {
		this._annotationManager.redo();
		this.selectAnnotations([]);
	}

	/**
	 * @param {Array} ids Array of annotation ids (item keys)
	 */
	selectAnnotations(ids) {
		this._options.selectedAnnotationIDs = ids;
		this._view.setSelectedAnnotationIDs(ids);
	}

	zoomIn() {
		this._view.zoomIn();
	}

	zoomOut() {
		this._view.zoomOut();
	}

	zoomBy(delta) {
		this._view.zoomBy(delta);
	}

	zoomReset() {
		this._view.zoomReset();
	}

	navigate(location) {
		this._view.navigate(location);
	}

	/**
	 * Navigate to the previous position in the document
	 */
	navigateBack() {
		this._view.navigateBack();
	}

	/**
	 * Navigate to the latest position in the document
	 */
	navigateForward() {
		this._view.navigateForward();
	}

	enterPassword(password) {
		this._ensureType('pdf');
		this._options.password = password;
		if (this._view.enterPassword?.(password)) {
			return;
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
		}
		else {
			this._lightTheme = theme;
			this._view.setLightTheme(theme);
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
	}

	setPenActive(penActive) {
		this._view.setPenActive(penActive);
	}

	setPenExclusive(penExclusive) {
		this._view.setPenExclusive(penExclusive);
	}

	setFontFamily(fontFamily) {
		this._view.setFontFamily(fontFamily);
	}

	setPageLabels(pageLabels) {
		this._view.setPageLabels?.(pageLabels);
	}

	renderThumbnails(pageIndexes) {
		this._ensureType('pdf');
		this._view.renderThumbnails?.(pageIndexes);
	}

	setReadAloudSpotlight(selector) {
		this._ensureType('epub', 'snapshot');
		this._view.setSpotlight('ReadAloudActiveSegment', selector, null);
		if (selector) {
			this._view.navigate(selector, {
				ifNeeded: true,
				block: 'center',
				behavior: 'smooth'
			});
		}
	}

	// Store an SDT pack for later operations.
	setSDTPack(pack) {
		this._sdtPack = pack;
		this._sdt = null;
		this._sdtPromise = null;
	}

	// Materialize the stored pack and build the position mapper. Resolves
	// to null when SDT is unavailable or the pack version doesn't match.
	async _loadSDT() {
		if (this._sdt) {
			return this._sdt;
		}
		if (!this._sdtPromise) {
			this._sdtPromise = (async () => {
				let pack = this._sdtPack;
				if (!pack) {
					return null;
				}
				if (pack.packVersion !== SDT_PACK_VERSION
						|| pack.schemaMajorVersion !== Number(SDT_SCHEMA_VERSION.split('.')[0])) {
					console.warn('Unsupported SDT pack version', pack.packVersion, pack.schemaMajorVersion);
					return null;
				}
				let bytes = new Uint8Array(pack.bytes);
				let source = {
					byteLength: bytes.byteLength,
					read: async (offset, length) => bytes.buffer.slice(
						bytes.byteOffset + offset,
						bytes.byteOffset + offset + length
					),
				};
				let reader = await openStructuredDocumentTextPack(source, {
					inflate: b => pako.inflateRaw(b),
				});
				let structure = await reader.materialize();
				this._sdt = { structure, mapper: createPositionMapper(structure) };
				return this._sdt;
			})().catch((e) => {
				this._sdtPromise = null;
				console.warn('Failed to load SDT', e);
				return null;
			});
		}
		return this._sdtPromise;
	}

	async sdtAnchorToPosition(sdtAnchor) {
		let sdt = await this._loadSDT();
		return sdt ? sdt.mapper.sdtToSourcePosition(sdtAnchor) : null;
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
