import injectCSS from './stylesheets/inject.scss';
import Path from "epubjs/src/utils/path";
import {
	AnnotationType,
	ArrayRect,
	FindState,
	NavLocation,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	ViewStats,
	WADMAnnotation
} from "../../common/types";
import Epub, { Book, EpubCFI, NavItem } from "epubjs";
import {
	getStartElement,
	moveRangeEndsIntoTextNodes,
	PersistentRange,
	splitRangeToTextNodes
} from "../common/lib/range";
import { FragmentSelector, FragmentSelectorConformsTo, isFragment, Selector } from "../common/lib/selector";
import { EPUBFindProcessor } from "./find";
import DOMView, {
	DOMViewOptions,
	DOMViewState,
	NavigateOptions,
	ReflowableAppearance
} from "../common/dom-view";
import SectionRenderer from "./section-renderer";
import Section from "epubjs/types/section";
import { closestElement, getContainingBlock } from "../common/lib/nodes";
import { CSSRewriter } from "./lib/sanitize-and-render";
import PageMapping from "./lib/page-mapping";
import { lengthenCFI, shortenCFI } from "./cfi";
import {
	Flow,
	PaginatedFlow,
	ScrolledFlow
} from "./flow";
import { RTL_SCRIPTS, A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH } from "./defines";
import { parseAnnotationsFromKOReaderMetadata, koReaderAnnotationToRange } from "./lib/koreader";
import { ANNOTATION_COLORS } from "../../common/defines";
import { calibreAnnotationToRange, parseAnnotationsFromCalibreMetadata } from "./lib/calibre";
import LRUCacheMap from "../common/lib/lru-cache-map";
import { mode } from "../common/lib/collection";
import { debounce } from '../../common/lib/debounce';
import { placeA11yVirtualCursor } from '../../common/lib/utilities';
import { DEFAULT_REFLOWABLE_APPEARANCE } from "../common/defines";

class EPUBView extends DOMView<EPUBViewState, EPUBViewData> {
	protected _find: EPUBFindProcessor | null = null;

	readonly book: Book;

	flow!: Flow;

	flowMode!: FlowMode;

	spreadMode!: SpreadMode.None | SpreadMode.Odd;

	pageMapping!: PageMapping;

	pageProgressionRTL!: boolean;

	private _lastResizeWidth: number | null = null;

	private _lastResizeHeight: number | null = null;

	private _sectionsContainer!: HTMLElement;

	private readonly _sectionRenderers: SectionRenderer[] = [];

	private readonly _rangeCache = new LRUCacheMap<string, PersistentRange>();

	private readonly _hrefTargetCache = new Map<string, HTMLElement>();

	private _lastNavigationTime = 0;

	constructor(options: DOMViewOptions<EPUBViewState, EPUBViewData>) {
		super(options);
		if (options.data.buf) {
			this.book = Epub(options.data.buf.buffer);
			delete this._options.data.buf;
		}
		else if (options.data.url) {
			this.book = Epub(options.data.url, {
				openAs: 'epub'
			});
		}
		else if (options.data.book) {
			this.book = options.data.book;
		}
		else {
			throw new Error('buf, url, or book is required');
		}
	}

	protected _getSrcDoc() {
		return '<!DOCTYPE html><html><body></body></html>';
	}

	getData() {
		return {
			book: this.book
		};
	}

	protected override _handleIFrameLoaded() {
		this._iframeDocument.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));

		return super._handleIFrameLoaded();
	}

	protected override async _handleViewCreated(viewState: Partial<Readonly<EPUBViewState>>) {
		await super._handleViewCreated(viewState);
		await this.book.opened;

		this._iframeDocument.documentElement.lang = this.book.packaging.metadata.language;

		let cspMeta = this._iframeDocument.createElement('meta');
		cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
		cspMeta.setAttribute('content', this._getCSP());
		this._iframeDocument.head.prepend(cspMeta);

		let style = this._iframeDocument.createElement('style');
		style.innerHTML = injectCSS;
		this._iframeDocument.head.append(style);

		let swipeIndicatorContainer = this._iframeDocument.createElement('div');
		swipeIndicatorContainer.classList.add('swipe-indicators');

		let swipeIndicatorLeft = this._iframeDocument.createElement('div');
		swipeIndicatorLeft.classList.add('swipe-indicator-left');
		swipeIndicatorContainer.append(swipeIndicatorLeft);

		let swipeIndicatorRight = this._iframeDocument.createElement('div');
		swipeIndicatorRight.classList.add('swipe-indicator-right');
		swipeIndicatorContainer.append(swipeIndicatorRight);

		this._iframeDocument.body.append(swipeIndicatorContainer);

		this._sectionsContainer = this._iframeDocument.createElement('div');
		this._sectionsContainer.classList.add('sections');
		this._sectionsContainer.hidden = true;
		this._iframeDocument.body.prepend(this._sectionsContainer);

		await this._displaySections();

		if (this._sectionRenderers.some(view => view.error) && await this._isEncrypted()) {
			this._options.onEPUBEncrypted();
			this._sectionsContainer.remove();
			return;
		}

		this.pageProgressionRTL = this.book.packaging.metadata.direction === 'rtl';
		if (!this.pageProgressionRTL) {
			try {
				let locale = new Intl.Locale(this.book.packaging.metadata.language).maximize();
				this.pageProgressionRTL = locale.script ? RTL_SCRIPTS.has(locale.script) : false;
				if (this.pageProgressionRTL) {
					console.log('Guessed RTL page progression from maximized locale: ' + locale);
				}
			}
			catch (e) {
				// Ignore
			}
		}
		if (!this.pageProgressionRTL) {
			let writingMode = this._iframeDocument.documentElement.style.writingMode || '';
			this.pageProgressionRTL = writingMode.endsWith('rl');
			if (this.pageProgressionRTL) {
				console.log('Guessed RTL page progression from writing mode: ' + writingMode);
			}
		}

		if (this._options.fontFamily) {
			this.setFontFamily(this._options.fontFamily);
		}

		this._sectionsContainer.hidden = false;
		this.pageMapping = this._initPageMapping(viewState.savedPageMapping);
		this._initOutline();
		this._addAriaNavigationLandmarks();

		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState

		this._setScale(viewState.scale || 1);

		if (viewState.flowMode) {
			this.setFlowMode(viewState.flowMode);
		}
		else {
			this.setFlowMode('paginated');
		}
		if (viewState.spreadMode) {
			this.setSpreadMode(viewState.spreadMode);
		}
		else {
			this.setSpreadMode(SpreadMode.None);
		}
		if (viewState.appearance) {
			this.setAppearance(viewState.appearance);
		}
		else {
			this.setAppearance(DEFAULT_REFLOWABLE_APPEARANCE);
		}

		if (this._options.location) {
			this.navigate(this._options.location, { behavior: 'instant' });
		}
		else if (!viewState.cfi || viewState.cfi === '_start') {
			this.navigateToFirstPage();
		}
		else {
			let cfi = lengthenCFI(viewState.cfi);
			// Perform the navigation on the next frame, because apparently the split view layout might not have
			// settled yet
			await new Promise(resolve => requestAnimationFrame(resolve));
			this.navigate({ pageNumber: cfi }, { behavior: 'auto', offsetBlock: viewState.cfiElementOffset });
		}

		this._lastResizeWidth = this._iframeWindow.innerWidth;
		this._lastResizeHeight = this._iframeWindow.innerHeight;

		this._handleViewUpdate();

		this.book.archive.zip = null;
	}

	private async _isEncrypted() {
		try {
			let xml = await this.book.archive.request('/META-INF/encryption.xml', 'text') as string;
			return xml.includes('<EncryptedData');
		}
		catch (e) {
			return false;
		}
	}

	private async _displaySection(section: Section, cssRewriter: CSSRewriter) {
		let renderer = new SectionRenderer({
			section,
			sectionsContainer: this._sectionsContainer,
			document: this._iframeDocument,
		});
		await renderer.render(this.book.archive.request.bind(this.book.archive), cssRewriter);
		renderer.body.lang = this.book.packaging.metadata.language;
		this._sectionRenderers[section.index] = renderer;
	}

	private async _displaySections() {
		let cssRewriter = new CSSRewriter(this._iframeDocument);
		for (let section of this.book.spine.spineItems) {
			// We should filter to linear sections only,
			// but we need to be sure it won't break anything
			await this._displaySection(section, cssRewriter);
		}

		this._iframeDocument.documentElement.style.writingMode = this.book.packaging.metadata.primary_writing_mode
			|| mode(this._sectionRenderers.map(r => r.container.dataset.writingMode).filter(Boolean))
			|| '';
	}

	private _initPageMapping(json?: string): PageMapping {
		let mapping: PageMapping | null = null;

		if (json) {
			mapping = PageMapping.load(json, this);
		}
		if (!json || !mapping) {
			mapping = PageMapping.generate(this);

			if (window.dev) {
				mapping = PageMapping.load(mapping.toJSON(), this);
				if (!mapping) {
					throw new Error('Failed to round-trip page mapping');
				}
			}
		}

		return mapping;
	}

	private _initOutline() {
		let base = new Path(this.book.packaging.navPath || this.book.packaging.ncxPath || '');
		let toOutlineItem: (navItem: NavItem) => OutlineItem = navItem => ({
			title: navItem.label,
			location: {
				href: base.resolve(navItem.href).replace(/^\//, '')
			},
			items: navItem.subitems?.map(toOutlineItem),
			expanded: true,
		});
		this._options.onSetOutline(this.book.navigation.toc.map(toOutlineItem));
	}

	protected _getOutlinePath() {
		let bestPath: number[] = [];
		let bestTarget: HTMLElement | null = null;

		if (!this.flow.startRange || !this._outline) {
			return bestPath;
		}

		let helper = (item: OutlineItem, index: number, currentPath: number[]) => {
			const newPath = [...currentPath, index];

			let target = this._getHrefTarget(item.location.href!);
			if (!target) {
				return;
			}

			// Skip this item and all its children if we're earlier than it in the document
			// Presumably child items will never come before their parent?
			// I don't think anything in the EPUB spec prohibits that, though...
			if (EPUBView.compareRangeToPoint(this.flow.startRange!, target, 0) < 0) {
				return;
			}
			if (!bestTarget || EPUBView.compareDocumentPositions(target, bestTarget) >= 0) {
				bestTarget = target;
				bestPath = newPath;
			}
			if (item.items) {
				for (let [i, child] of item.items.entries()) {
					helper(child, i, newPath);
				}
			}
		};

		for (let [i, child] of this._outline.entries()) {
			helper(child, i, []);
		}

		return bestPath;
	}

	getCFI(rangeOrNode: Range | Node): EpubCFI | null {
		let commonAncestorNode;
		if ('nodeType' in rangeOrNode) {
			commonAncestorNode = rangeOrNode;
		}
		else {
			commonAncestorNode = rangeOrNode.commonAncestorContainer;
		}
		let sectionContainer = closestElement(commonAncestorNode)?.closest('[data-section-index]');
		if (!sectionContainer) {
			return null;
		}
		let section = this.book.section(sectionContainer.getAttribute('data-section-index')!);
		return new EpubCFI(rangeOrNode, section.cfiBase);
	}

	getRange(cfi: EpubCFI | string, mount = false): PersistentRange | null {
		if (!this._sectionRenderers.length) {
			// The book isn't loaded yet -- don't spam the console
			return null;
		}
		let cfiString = cfi.toString();
		if (typeof cfi === 'string') {
			cfi = new EpubCFI(cfi);
		}
		let view = this._sectionRenderers[cfi.spinePos];
		if (!view) {
			console.error('Unable to find view for CFI', cfiString);
			return null;
		}
		if (!view.mounted && mount) {
			view.mount();
		}
		if (this._rangeCache.has(cfiString)) {
			return this._rangeCache.get(cfiString)!;
		}
		try {
			let range = cfi.toRange(view.container.ownerDocument, undefined, view.container);
			if (!range) {
				console.error('Unable to get range for CFI', cfiString);
				return null;
			}
			let persistentRange = new PersistentRange(range);
			this._rangeCache.set(cfiString, persistentRange);
			return persistentRange;
		}
		catch (e) {
			console.error('Unable to get range for CFI', cfiString, e);
			return null;
		}
	}

	// Add landmarks with page labels for screen reader navigation
	private async _addAriaNavigationLandmarks() {
		let locator = this._options.getLocalizedString
			? this._options.getLocalizedString(
				this.pageMapping.isPhysical ? 'reader-page' : 'reader-location'
			)
			: (this.pageMapping.isPhysical ? 'Page' : 'Location');

		for (let [range, pageLabel] of this.pageMapping.entries()) {
			let node = range.startContainer;
			let containingElement = closestElement(node);
			if (!containingElement) continue;

			// This is semantically not correct, as we are assigning
			// navigation role to <p> and <h> nodes but this is the
			// best solution to avoid adding nodes into the DOM, which
			// will break CFIs.
			containingElement.setAttribute('role', 'navigation');
			containingElement.setAttribute('aria-label', `${locator}: ${pageLabel}`);
		}
	}

	override toSelector(range: Range): FragmentSelector | null {
		range = moveRangeEndsIntoTextNodes(range);
		let cfi = this.getCFI(range);
		if (!cfi) {
			return null;
		}
		return {
			type: 'FragmentSelector',
			conformsTo: FragmentSelectorConformsTo.EPUB3,
			value: cfi.toString(true)
		};
	}

	override toDisplayedRange(selector: Selector): Range | null {
		switch (selector.type) {
			case 'FragmentSelector': {
				if (selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
					throw new Error(`Unsupported FragmentSelector.conformsTo: ${selector.conformsTo}`);
				}
				if (selector.refinedBy) {
					throw new Error('Refinement of FragmentSelectors is not supported');
				}
				let range = this.getRange(selector.value);
				if (!range) {
					return null;
				}
				let sectionIndex = EPUBView.getContainingSectionIndex(range);
				if (sectionIndex === null || !this._sectionRenderers[sectionIndex].mounted) {
					return null;
				}
				return range.toRange();
			}
			default:
				// No other selector types supported on EPUBs
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}

	protected override _getHistoryLocation(): NavLocation | null {
		let cfi = this.flow.startCFI?.toString();
		if (!cfi) return null;
		return { pageNumber: cfi };
	}

	private _keepPosition<T>(block?: () => T) {
		let cfiBefore = this.flow?.startCFI;
		let offsetBefore = this.flow?.startCFIOffset;
		let result = block?.();
		if (cfiBefore) {
			this.navigate(
				{ pageNumber: cfiBefore.toString() },
				{
					skipHistory: true,
					behavior: 'auto',
					offsetBlock: offsetBefore ?? undefined
				}
			);
		}
		return result;
	}

	protected _navigateToSelector(selector: Selector, options: NavigateOptions = {}) {
		if (!isFragment(selector) || selector.conformsTo !== FragmentSelectorConformsTo.EPUB3) {
			console.warn("Not a CFI FragmentSelector", selector);
			return;
		}
		this.navigate({ pageNumber: selector.value }, options);
	}

	protected _getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		range = moveRangeEndsIntoTextNodes(range);
		if (range.collapsed) {
			return null;
		}
		let text;
		if (type == 'highlight' || type == 'underline') {
			text = '';
			let lastSplitRange;
			for (let splitRange of splitRangeToTextNodes(range)) {
				if (lastSplitRange) {
					let lastSplitRangeContainer = closestElement(lastSplitRange.commonAncestorContainer);
					let lastSplitRangeBlock = lastSplitRangeContainer && getContainingBlock(lastSplitRangeContainer);
					let splitRangeContainer = closestElement(splitRange.commonAncestorContainer);
					let splitRangeBlock = splitRangeContainer && getContainingBlock(splitRangeContainer);
					if (lastSplitRangeBlock !== splitRangeBlock) {
						text += '\n\n';
					}
				}
				text += splitRange.toString().replace(/\s+/g, ' ');
				lastSplitRange = splitRange;
			}
			text = text.trim();

			// If this annotation type wants text, but we didn't get any, abort
			if (!text) {
				return null;
			}
		}
		else {
			text = undefined;
		}

		let selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		let pageLabel = this.pageMapping.isPhysical && this.pageMapping.getPageLabel(range) || '';

		// Use the number of characters between the start of the section and the start of the selection range
		// to disambiguate the sortIndex
		let sectionContainer = closestElement(range.startContainer)?.closest('[data-section-index]');
		if (!sectionContainer) {
			return null;
		}
		let sectionIndex = parseInt(sectionContainer.getAttribute('data-section-index')!);
		let offsetRange = this._iframeDocument.createRange();
		offsetRange.setStart(sectionContainer, 0);
		offsetRange.setEnd(range.startContainer, range.startOffset);
		let sortIndex = String(sectionIndex).padStart(5, '0') + '|' + String(offsetRange.toString().length).padStart(8, '0');
		return {
			type,
			color,
			sortIndex,
			pageLabel,
			position: selector,
			text
		};
	}

	protected override _getContainingRoot(node: Node) {
		return this._sectionRenderers.find(r => r.container.contains(node))?.container
			?? null;
	}

	private _upsertAnnotation(annotation: NewAnnotation<WADMAnnotation>) {
		let existingAnnotation = this._annotations.find(
			existingAnnotation => existingAnnotation.text === annotation!.text
					&& existingAnnotation.sortIndex === annotation!.sortIndex
		);
		if (existingAnnotation) {
			this._options.onUpdateAnnotations([{
				...existingAnnotation,
				comment: annotation.comment,
			}]);
		}
		else {
			this._options.onAddAnnotation(annotation);
		}
	}

	getKOReaderAnnotationStats(metadata: BufferSource): { count: number, lastModified?: Date } {
		try {
			let annotations = parseAnnotationsFromKOReaderMetadata(metadata);
			if (annotations.length) {
				return {
					count: annotations.length,
					lastModified: annotations.map(a => new Date(a.datetime)).reduce(
						(max, cur) => (cur > max ? cur : max)
					),
				};
			}
		}
		catch (e) {
			console.error(e);
		}
		return { count: 0 };
	}

	importAnnotationsFromKOReaderMetadata(metadata: BufferSource) {
		for (let koReaderAnnotation of parseAnnotationsFromKOReaderMetadata(metadata)) {
			let range = koReaderAnnotationToRange(koReaderAnnotation, this._sectionRenderers);
			if (!range) {
				console.warn('Unable to resolve annotation', koReaderAnnotation);
				continue;
			}

			let colorName;
			// https://github.com/koreader/koreader/blob/15995650e/frontend/apps/reader/modules/readerhighlight.lua#L31-L39
			switch (koReaderAnnotation.color) {
				case 'red':
				case 'orange':
				case 'yellow':
				case 'green':
				case 'blue':
				case 'purple':
				case 'gray':
					colorName = koReaderAnnotation.color;
					break;

				// Use similar fallbacks for colors we don't support
				case 'olive':
					colorName = 'green';
					break;
				case 'cyan':
					colorName = 'blue';
					break;

				default:
					if (koReaderAnnotation.color) {
						console.warn('Unknown KOReader color', koReaderAnnotation.color);
					}
					colorName = 'yellow';
					break;
			}

			let color = ANNOTATION_COLORS
				.find(([name]) => name === `general-${colorName}`)
				?.[1];
			if (!color) {
				throw new Error('Missing color: ' + color);
			}
			let annotation = this._getAnnotationFromRange(
				range,
				'highlight',
				color,
			);
			if (!annotation) {
				console.warn('Unable to resolve range', koReaderAnnotation);
				continue;
			}
			annotation.comment = koReaderAnnotation.note;

			this._upsertAnnotation(annotation);
		}
	}

	getCalibreAnnotationStats(metadata: string): { count: number, lastModified?: Date } {
		try {
			let annotations = parseAnnotationsFromCalibreMetadata(metadata);
			if (annotations.length) {
				return {
					count: annotations.length,
					lastModified: annotations.map(a => new Date(a.timestamp)).reduce(
						(max, cur) => (cur > max ? cur : max)
					),
				};
			}
		}
		catch (e) {
			console.error(e);
		}
		return { count: 0 };
	}

	importAnnotationsFromCalibreMetadata(metadata: string) {
		for (let calibreAnnotation of parseAnnotationsFromCalibreMetadata(metadata)) {
			let range = calibreAnnotationToRange(calibreAnnotation, this._sectionRenderers);
			if (!range) {
				console.warn('Unable to resolve annotation', calibreAnnotation);
				continue;
			}

			let type: 'highlight' | 'underline' = 'highlight';
			let color = ANNOTATION_COLORS[0][1]; // Default to yellow
			switch (calibreAnnotation.style?.kind) {
				case 'color':
					switch (calibreAnnotation.style.which) {
						case 'green':
							color = ANNOTATION_COLORS[2][1];
							break;
						case 'blue':
							color = ANNOTATION_COLORS[3][1];
							break;
						case 'purple':
							color = ANNOTATION_COLORS[4][1];
							break;
						case 'pink':
							color = ANNOTATION_COLORS[5][1];
							break;
						case 'yellow':
						default:
							break;
					}
					break;
				case 'decoration':
					switch (calibreAnnotation.style.which) {
						case 'strikeout':
							color = ANNOTATION_COLORS[1][1]; // Red highlight as a stand-in
							break;
						case 'wavy':
							type = 'underline';
							break;
					}
					break;
			}

			let annotation = this._getAnnotationFromRange(range, type, color);
			if (!annotation) {
				console.warn('Unable to resolve range', calibreAnnotation);
				continue;
			}
			annotation.comment = calibreAnnotation.notes || '';

			this._upsertAnnotation(annotation);
		}
	}

	// ***
	// Event handlers
	// ***

	protected _handleVisibilityChange() {
		if (this._iframeDocument.visibilityState !== 'visible') {
			return;
		}
		this._keepPosition();
		this._handleViewUpdate();
	}

	protected override _handleResize() {
		if (!this.flow || document.hidden
				|| (this._iframeWindow.innerWidth === this._lastResizeWidth
					&& this._iframeWindow.innerHeight === this._lastResizeHeight)) {
			return;
		}
		this._lastResizeWidth = this._iframeWindow.innerWidth;
		this._lastResizeHeight = this._iframeWindow.innerHeight;

		this._keepPosition();
		this._handleViewUpdate();
	}

	protected _getInternalLinkHref(link: HTMLAnchorElement) {
		if (this._isExternalLink(link)) {
			return null;
		}
		let href = link.getAttribute('href')!;
		let section = this._sectionRenderers.find(view => view.container.contains(link))?.section;
		if (!section) {
			return null;
		}
		// This is a hack - we're using the URL constructor to resolve the relative path based on the section's
		// canonical URL, but it'll error without a host. So give it one!
		let url = new URL(href, new URL(section.canonical, 'https://www.example.com/'));
		let decodedURL = url.pathname + url.hash;
		try {
			decodedURL = decodeURIComponent(decodedURL);
		}
		catch (e) {}
		return this.book.path.relative(decodedURL);
	}

	protected _splitHref(href: string): [string, string | null] {
		let [pathname, hash] = href.split('#');
		try {
			pathname = decodeURIComponent(pathname);
		}
		catch (e) {}
		if (hash) {
			try {
				hash = decodeURIComponent(hash);
			}
			catch (e) {
			}
		}
		return [pathname, hash ?? null];
	}

	protected _getHrefTarget(href: string): HTMLElement | null {
		if (this._hrefTargetCache.has(href)) {
			return this._hrefTargetCache.get(href)!;
		}

		let [pathname, hash] = this._splitHref(href);
		let section = this.book.spine.get(pathname);
		if (!section) {
			console.error('Unable to find section for pathname', pathname);
			return null;
		}
		let target = this._sectionRenderers[section.index].container;
		if (!target) {
			console.error('Unable to find view for section', section.index);
			return null;
		}
		if (hash) {
			let hashTarget = target.querySelector('#' + CSS.escape(hash));
			if (hashTarget) {
				target = hashTarget as HTMLElement;
			}
			else {
				console.warn('Unable to resolve hash', hashTarget);
			}
		}
		this._hrefTargetCache.set(href, target);
		return target;
	}

	protected override _handlePointerOverInternalLink(link: HTMLAnchorElement) {
		let element = this._getFootnoteTargetElement(link);
		if (element) {
			this._overlayPopupDelayer.open(link, () => {
				this._openFootnoteOverlayPopup(link, element!);
			});
		}
		else {
			this._overlayPopupDelayer.close(() => {
				this._options.onSetOverlayPopup();
			});
		}
	}

	protected override _handlePointerLeftInternalLink() {
		this._overlayPopupDelayer.close(() => {
			this._options.onSetOverlayPopup();
		});
	}

	protected _handleInternalLinkClick(link: HTMLAnchorElement) {
		let href = this._getInternalLinkHref(link);
		if (!href) {
			return;
		}
		this.navigate({ href });
	}

	protected override _handleClick(event: PointerEvent) {
		super._handleClick(event);

		if (event.defaultPrevented || event.button !== 0) {
			return;
		}

		let target = event.target as Element;
		if (target.tagName === 'IMG'
				&& target.classList.contains('clickable-image')
				&& (target as HTMLImageElement).naturalWidth
				&& (target as HTMLImageElement).naturalHeight) {
			let img = target as HTMLImageElement;
			let rect = img.getBoundingClientRect();
			this._options.onSetOverlayPopup({
				type: 'image',
				src: img.currentSrc || img.src,
				title: img.title,
				alt: img.alt,
				rect: [rect.left, rect.top, rect.right, rect.bottom],
			});
			event.preventDefault();
		}
	}

	protected override _handleKeyDown(event: KeyboardEvent) {
		let { key } = event;

		super._handleKeyDown(event);
		if (event.defaultPrevented) {
			return;
		}

		// These keypresses scroll the content and should change focus for screen readers
		if (!event.shiftKey && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(key)) {
			this._a11yShouldFocusVirtualCursorTarget = true;
		}

		if (!event.shiftKey) {
			if (key == 'ArrowLeft') {
				this.flow.navigateLeft();
				event.preventDefault();
				return;
			}
			if (key == 'ArrowRight') {
				this.flow.navigateRight();
				event.preventDefault();
				// eslint-disable-next-line no-useless-return
				return;
			}
		}
	}

	protected override _updateViewState() {
		let cfi;
		if (this.flow.startCFI) {
			cfi = shortenCFI(this.flow.startCFI.toString(true));
		}
		else if (this.flow.startRangeIsBeforeFirstMapping) {
			cfi = '_start';
		}
		let viewState: EPUBViewState = {
			scale: Math.round(this.scale * 1000) / 1000, // Three decimal places
			cfi,
			cfiElementOffset: this.flow.startCFIOffset ?? undefined,
			savedPageMapping: this.pageMapping.toJSON(),
			flowMode: this.flowMode,
			spreadMode: this.spreadMode,
			appearance: this.appearance,
		};
		this._options.onChangeViewState(viewState);
	}

	// View stats provide information about the view
	protected override _updateViewStats() {
		let startRange = this.flow.startRange;
		let pageIndex = startRange && this.pageMapping.getPageIndex(startRange);
		let pageLabel = startRange && this.pageMapping.getPageLabel(startRange);
		let canNavigateToPreviousPage = this.flow.canNavigateToPreviousPage();
		let canNavigateToNextPage = this.flow.canNavigateToNextPage();
		let viewStats: ViewStats = {
			pageIndex: pageIndex ?? undefined,
			pageLabel: pageLabel ?? '',
			pagesCount: this.pageMapping.length,
			usePhysicalPageNumbers: this.pageMapping.isPhysical,
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this.scale === undefined || this.scale < this.MAX_SCALE,
			canZoomOut: this.scale === undefined || this.scale > this.MIN_SCALE,
			canZoomReset: this.scale !== undefined && this.scale !== 1,
			canNavigateBack: this._history.canNavigateBack,
			canNavigateForward: this._history.canNavigateForward,
			canNavigateToFirstPage: canNavigateToPreviousPage,
			canNavigateToLastPage: canNavigateToNextPage,
			canNavigateToPreviousPage,
			canNavigateToNextPage,
			canNavigateToPreviousSection: this.canNavigateToPreviousSection(),
			canNavigateToNextSection: this.canNavigateToNextSection(),
			flowMode: this.flowMode,
			spreadMode: this.spreadMode,
			appearance: this.appearance,
			outlinePath: Date.now() - this._lastNavigationTime > 1500 ? this._getOutlinePath() : undefined,
		};
		this._options.onChangeViewStats(viewStats);
		this.a11yRecordCurrentPage();
	}

	protected override _handleViewUpdate() {
		if (!this.initialized) {
			return;
		}
		super._handleViewUpdate();
		this.flow.invalidate();
	}

	protected _openFootnoteOverlayPopup(link: HTMLAnchorElement, element: Element) {
		let doc = document.implementation.createHTMLDocument();

		doc.documentElement.dataset.colorScheme = this._iframeDocument.documentElement.dataset.colorScheme;

		let css = '';
		for (let sheet of [...this._iframeDocument.styleSheets, ...this._iframeDocument.adoptedStyleSheets]) {
			for (let rule of sheet.cssRules) {
				css += rule.cssText + '\n\n';
			}
		}
		css += `
			:root {
				--content-scale: ${this.scale};
				--content-font-family: ${this._iframeDocument.documentElement.style.getPropertyValue('--content-font-family')};
				--selection-color: ${this._iframeDocument.documentElement.style.getPropertyValue('--selection-color')};
				--background-color: ${this._iframeDocument.documentElement.style.getPropertyValue('--background-color')};
				--text-color: ${this._iframeDocument.documentElement.style.getPropertyValue('--text-color')};
			}
		`;

		let cspMeta = doc.createElement('meta');
		cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
		cspMeta.setAttribute('content', this._getCSP());
		doc.head.prepend(cspMeta);

		let container = doc.createElement('div');

		let handledIbid = false;
		let ibidRe = /\bIbid\b/;

		let current = element;
		let currentClone = current.cloneNode(true) as HTMLElement;
		while (!current.classList.contains('section-container')) {
			let parent = current.parentElement;
			if (!parent) {
				break;
			}
			let parentClone = parent.cloneNode(false) as HTMLElement;
			parentClone.appendChild(currentClone);

			// If the current footnote contains "Ibid", keep prepending previous siblings
			// until we find one that doesn't
			if (!handledIbid
					&& current.previousElementSibling
					&& current.textContent
					&& ibidRe.test(current.textContent)) {
				do {
					current = current.previousElementSibling;
					let currentClone = current.cloneNode(true) as HTMLElement;
					parentClone.prepend(currentClone);
				}
				while (current.previousElementSibling?.textContent
					&& ibidRe.test(current.previousElementSibling.textContent));
				handledIbid = true;
			}

			currentClone = parentClone;
			current = parent;
		}
		container.append(currentClone);

		for (let link of container.querySelectorAll('a')) {
			if (!this._isExternalLink(link)) {
				link.removeAttribute('href');
			}
		}

		doc.body.append(container);
		let content = new XMLSerializer().serializeToString(doc);

		let domRect = link.getBoundingClientRect();
		let rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];

		let overlayPopup = {
			type: 'footnote',
			content,
			css,
			rect,
			ref: link
		} satisfies OverlayPopupParams;
		this._options.onSetOverlayPopup(overlayPopup);
	}

	protected _isFootnoteLink(link: HTMLAnchorElement, target: Element): boolean {
		// Modeled on Calibre's heuristic
		// https://github.com/kovidgoyal/calibre/blob/87f4c08c16b07058dd25733eb5c30022246a66f2/src/pyj/read_book/footnotes.pyj#L32

		if (link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'noteref') {
			return true;
		}
		let roles = link.role?.split(' ') ?? [];
		if (roles.includes('doc-noteref') || roles.includes('doc-biblioref') || roles.includes('doc-glossref')) {
			return true;
		}
		if (roles.includes('doc-link')) {
			return false;
		}

		// Check if element has super/subscript alignment
		let elem: HTMLElement | null = link;
		let remainingDepth = 3;
		while (elem && remainingDepth > 0) {
			let style = getComputedStyle(elem);
			if (!['inline', 'inline-block'].includes(style.display)) {
				break;
			}
			if (['sub', 'super', 'top', 'bottom'].includes(style.verticalAlign)) {
				return true;
			}

			elem = elem.parentElement;
			remainingDepth--;
		}

		// Check if it has a single child with super/subscript alignment
		if (link.innerText.trim() && link.children.length === 1) {
			let style = getComputedStyle(link.children[0]);
			if (['inline', 'inline-block'].includes(style.display)
					&& ['sub', 'super', 'top', 'bottom'].includes(style.verticalAlign)) {
				return true;
			}
		}

		// Check if it has a link back to the original link
		let sectionIndex = link.closest('[data-section-index]')?.getAttribute('data-section-index');
		let section = sectionIndex && this.book.spine.get(sectionIndex);
		if (!section) {
			return false;
		}
		for (let linkInTarget of target.querySelectorAll('a')) {
			let linkInTargetHref = this._getInternalLinkHref(linkInTarget);
			if (!linkInTargetHref) {
				continue;
			}
			let [pathname, hash] = this._splitHref(linkInTargetHref);
			if (pathname === section.href && hash === link.id) {
				return true;
			}
		}

		return false;
	}

	protected _getFootnoteTargetElement(link: HTMLAnchorElement) {
		let href = this._getInternalLinkHref(link);
		if (!href) {
			return null;
		}
		let [pathname, hash] = this._splitHref(href);
		if (!pathname || !hash) {
			return null;
		}
		let section = this.book.spine.get(pathname);
		if (!section) {
			return null;
		}
		let target = this._sectionRenderers[section.index].container
			.querySelector('[id="' + CSS.escape(hash) + '"]');
		if (!target) {
			return null;
		}

		let epubType = target.getAttributeNS('http://www.idpf.org/2007/ops', 'type');
		if (!epubType || !['footnote', 'rearnote', 'note'].includes(epubType)) {
			target = getContainingBlock(target) || target;
		}

		if (!this._isFootnoteLink(link, target)) {
			return null;
		}
		return target;
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	// Unlike annotation, selection and overlay popups, find popup open state is determined
	// with .open property. All popup properties are preserved even when it's closed
	async setFindState(state: FindState) {
		let previousState = this._findState;
		this._findState = state;
		if (!state.active && previousState && previousState.active !== state.active) {
			console.log('Closing find popup');
			if (this._find) {
				this._find.cancel();
				this._find = null;
				this._handleViewUpdate();
			}
		}
		else if (state.active) {
			if (!this._find
					|| !previousState
					|| previousState.query !== state.query
					|| previousState.caseSensitive !== state.caseSensitive
					|| previousState.entireWord !== state.entireWord
					|| previousState.active !== state.active) {
				console.log('Initiating new search', state);
				this._find?.cancel();
				this._find = new EPUBFindProcessor({
					view: this,
					findState: { ...state },
					onSetFindState: (result) => {
						this._options.onSetFindState({
							...state,
							result: {
								total: result.total,
								index: result.index,
								snippets: result.snippets,
								annotation: (
									result.range
									&& this._getAnnotationFromRange(result.range.toRange(), 'highlight')
								) ?? undefined,
								currentPageLabel: result.range ? this.pageMapping.getPageLabel(result.range.toRange()) : null,
								currentSnippet: result.snippets[result.index]
							}
						});
						if (result.range) {
							// Record the result that screen readers should focus on after search popup is closed
							this._a11yVirtualCursorTarget = getStartElement(result.range);
						}
					},
				});
				let startRange = (this.flow.startRange && new PersistentRange(this.flow.startRange)) ?? undefined;
				let onFirstResult = () => this.findNext();
				await this._find.run(startRange, onFirstResult);
			}
			else {
				if (previousState && previousState.highlightAll !== state.highlightAll) {
					this._find.findState.highlightAll = state.highlightAll;
					this._find.updateFindState();
					this._renderAnnotations();
				}
				if (previousState && state.index !== null && previousState.index !== state.index) {
					console.log('Navigate to result', state.index);
					let result = await this._find.setPosition(state.index);
					if (result) {
						this.flow.scrollIntoView(result.range);
					}
					this._renderAnnotations();
				}
			}
		}
	}

	setFlowMode(flowMode: FlowMode) {
		if (flowMode == this.flowMode) {
			return;
		}

		this._keepPosition(() => {
			if (this.flow) {
				this.flow.destroy();
			}
			this.flowMode = flowMode;
			this.flow = new (flowMode == 'paginated' ? PaginatedFlow : ScrolledFlow)({
				view: this,
				iframe: this._iframe,
				onUpdateViewState: () => this._updateViewState(),
				onUpdateViewStats: () => this._updateViewStats(),
				onViewUpdate: () => this._handleViewUpdate(),
				onPushHistoryPoint: (transient) => {
					this._pushHistoryPoint(transient);
				},
			});
			this.flow.setSpreadMode(this.spreadMode);
		});
		this._handleViewUpdate();
	}

	setSpreadMode(spreadMode: SpreadMode) {
		if (spreadMode !== SpreadMode.None && spreadMode !== SpreadMode.Odd) {
			throw new Error('Unsupported spread mode');
		}

		if (spreadMode == this.spreadMode) {
			return;
		}

		this._keepPosition(() => {
			this.spreadMode = spreadMode;
			this.flow?.setSpreadMode(spreadMode);
		});
		this._handleViewUpdate();
	}

	override setAppearance(partialAppearance: Partial<ReflowableAppearance>) {
		this._keepPosition(() => {
			super.setAppearance(partialAppearance);
		});
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	async findNext() {
		console.log('Find next');
		if (this._find) {
			let processor = this._find;
			let result = await processor.next();
			if (result) {
				this.flow.scrollIntoView(result.range);
			}
			this._renderAnnotations();
		}
	}

	async findPrevious() {
		console.log('Find previous');
		if (this._find) {
			let processor = this._find;
			let result = await processor.prev();
			if (result) {
				this.flow.scrollIntoView(result.range);
			}
			this._renderAnnotations();
		}
	}

	// Place virtual cursor to the top of the current page.
	// Debounce to not run this on every view stats update.
	protected a11yRecordCurrentPage = debounce(() => {
		if (!this.flow.startRange) return;
		// Do not interfere with marking search results as virtual cursor targets
		if (this._findState?.active) return;
		let node = this.flow.startRange.startContainer;
		this._a11yVirtualCursorTarget = closestElement(node);
		if (this._a11yShouldFocusVirtualCursorTarget) {
			this._a11yShouldFocusVirtualCursorTarget = false;
			placeA11yVirtualCursor(this._a11yVirtualCursorTarget);
		}
	}, A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH);

	protected _setScale(scale: number) {
		this._keepPosition(() => {
			this.scale = scale;
			this._iframeDocument.documentElement.style.setProperty('--content-scale', String(scale));
			this.flow?.setScale(scale);
		});
	}

	override navigate(location: NavLocation, options: NavigateOptions = {}) {
		console.log('Navigating to', location);
		this._lastNavigationTime = Date.now();

		options.behavior ||= 'smooth';

		if (location.pageNumber) {
			options.block ||= 'start';

			let range;
			if (location.pageNumber.startsWith('epubcfi(')) {
				range = this.getRange(location.pageNumber, true);
			}
			else {
				if (this.flow.startRange && this.pageMapping.getPageLabel(this.flow.startRange) === location.pageNumber) {
					console.log('Already on page', location.pageNumber);
					return;
				}
				range = this.pageMapping.getRange(location.pageNumber);
			}

			if (!range) {
				console.error('Unable to find range');
				return;
			}
			this.flow.scrollIntoView(range, options);
		}
		else if (location.href) {
			options.block ||= 'start';

			let target = this._getHrefTarget(location.href);
			if (target) {
				this.flow.scrollIntoView(target, options);
				if (target !== target.closest('.section-container')) {
					let range = this._iframeDocument.createRange();
					// Rough, but try not to highlight a huge area
					if (target.firstElementChild && target.innerHTML.length > 1000) {
						range.selectNode(target.firstElementChild || target.firstChild);
					}
					else {
						range.selectNode(target);
					}
					let selector = this.toSelector(range);
					if (selector) {
						this._setHighlight(selector);
					}
				}
			}
		}
		else {
			super.navigate(location, options);
		}
	}

	navigateToFirstPage() {
		this.flow.navigateToFirstPage();
	}

	navigateToLastPage() {
		this.flow.navigateToLastPage();
	}

	canNavigateToPreviousPage() {
		return this.flow.canNavigateToPreviousPage();
	}

	canNavigateToNextPage() {
		return this.flow.canNavigateToNextPage();
	}

	navigateToPreviousPage() {
		this.flow.navigateToPreviousPage();
	}

	navigateToNextPage() {
		this.flow.navigateToNextPage();
	}

	canNavigateToPreviousSection() {
		return !!this.flow.startSection?.prev();
	}

	canNavigateToNextSection() {
		return !!this.flow.startSection?.next();
	}

	navigateToPreviousSection() {
		let section = this.flow.startSection?.prev();
		if (section) {
			this.navigate({ href: section.href });
		}
	}

	navigateToNextSection() {
		let section = this.flow.startSection?.next();
		if (section) {
			this.navigate({ href: section.href });
		}
	}

	async print() {
		// It's going to get ugly in here, so hide the iframe
		this._iframe.classList.remove('loaded');

		// Mount all views
		let renderersToMount = this._sectionRenderers.filter(view => !view.mounted);
		for (let renderer of renderersToMount) {
			renderer.mount();
		}

		// Wait for all images to load
		await Promise.allSettled(
			Array.from(this._iframeDocument.images)
				.map(image => image.decode())
		);

		if (typeof this._iframeWindow.zoteroPrint === 'function') {
			await this._iframeWindow.zoteroPrint({
				overrideSettings: {
					// Set title based on the book's title
					title: this.book.packaging.metadata.title || '',
					// Remove 'about:srcdoc' URL
					docURL: '',
					// And disable printing either of those things in the margins by default
					headerStrLeft: '',
					headerStrCenter: '',
					headerStrRight: '',
					footerStrLeft: '',
					footerStrCenter: '',
					footerStrRight: '',
				}
			});
		}
		else {
			this._iframeWindow.print();
		}

		// Unmount the views that weren't mounted before
		for (let view of renderersToMount) {
			view.unmount();
		}

		this._iframe.classList.add('loaded');
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		window.dispatchEvent(new Event('resize'));
	}

	get renderers(): SectionRenderer[] {
		return this._sectionRenderers;
	}

	static getContainingSectionIndex(rangeOrNode: Range | PersistentRange | Node): number | null {
		let elem;
		if ('nodeType' in rangeOrNode) {
			elem = closestElement(rangeOrNode);
		}
		else {
			elem = closestElement(rangeOrNode.startContainer.childNodes[rangeOrNode.startOffset] || rangeOrNode.startContainer);
		}
		elem = elem?.closest('[data-section-index]');
		if (!elem) {
			return null;
		}
		return parseInt(elem.getAttribute('data-section-index')!);
	}

	private static _compareSectionIndices(a: Range | PersistentRange | Node, b: Range | PersistentRange | Node): number {
		let aSectionIndex = this.getContainingSectionIndex(a);
		if (aSectionIndex === null) {
			throw new Error('a is not inside a section');
		}
		let bSectionIndex = this.getContainingSectionIndex(b);
		if (bSectionIndex === null) {
			throw new Error('b is not inside a section');
		}
		return aSectionIndex - bSectionIndex;
	}

	static compareBoundaryPoints(how: number, a: Range | PersistentRange, b: Range | PersistentRange): number {
		if (a.startContainer.getRootNode() !== b.startContainer.getRootNode()) {
			return this._compareSectionIndices(a, b) || -1;
		}
		return a.compareBoundaryPoints(how, b as Range);
	}

	static compareRangeToPoint(a: Range, b: Node, bOffset: number): number {
		if (a.startContainer.getRootNode() !== b.getRootNode()) {
			return this._compareSectionIndices(a, b) || -1;
		}
		return -a.comparePoint(b, bOffset);
	}

	static compareDocumentPositions(a: Node, b: Node): number {
		if (a.getRootNode() !== b.getRootNode()) {
			return this._compareSectionIndices(a, b) || -1;
		}
		return a.compareDocumentPosition(b);
	}
}

type FlowMode = 'paginated' | 'scrolled';

export const enum SpreadMode {
	Unknown = -1,
	None = 0,
	Odd = 1,
	Even = 2
}

export interface EPUBViewState extends DOMViewState {
	cfi?: string;
	cfiElementOffset?: number;
	savedPageMapping?: string;
	flowMode?: FlowMode;
	spreadMode?: SpreadMode;
}

export interface EPUBViewData {
	book?: Book;
}

export default EPUBView;
