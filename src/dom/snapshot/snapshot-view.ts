import {
	AnnotationType,
	WADMAnnotation,
	FindState,
	NavLocation,
	NewAnnotation,
	ViewStats,
	OutlineItem,
	Position,
} from "../../common/types";
import {
	getBoundingPageRect,
	getInnerText,
	getStartElement,
} from "../common/lib/range";
import {
	CssSelector,
	isSelector,
	textPositionFromRange,
	Selector,
	textPositionToRange
} from "../common/lib/selector";
import DOMView, {
	DOMViewState,
	NavigateOptions
} from "../common/dom-view";
import { getUniqueSelectorContaining } from "../common/lib/unique-selector";
import {
	closestElement,
	getVisibleTextNodes,
	iterateWalker
} from "../common/lib/nodes";
import DefaultFindProcessor, { createSearchContext } from "../common/lib/find";
import injectCSS from './stylesheets/inject.scss';
import darkReaderJS from '!!raw-loader!darkreader/darkreader';
import { DynamicThemeFix } from "darkreader";
import { isPageRectVisible } from "../common/lib/rect";
import { debounceUntilScrollFinishes, isSafari } from "../../common/lib/utilities";
import { scrollIntoView } from "../common/lib/scroll-into-view";
import { SORT_INDEX_LENGTH, SORT_INDEX_LENGTH_OLD } from "./defines";
import { detectLang } from '../../common/lib/detect-lang';
import type { StructuredDocumentText } from '../../../structured-document-text/schema';

class SnapshotView extends DOMView<SnapshotViewState, SnapshotViewData> {
	protected _find: DefaultFindProcessor | null = null;

	private _isDynamicThemeSupported = true;

	private get _searchContext() {
		let searchContext = createSearchContext(getVisibleTextNodes(this._iframeDocument.body));
		Object.defineProperty(this, '_searchContext', { value: searchContext });
		return searchContext;
	}

	protected async _getSrcDoc() {
		if (this._options.data.srcDoc) {
			return this._options.data.srcDoc;
		}
		else if (this._options.data.buf || this._options.data.url !== undefined) {
			let buf;
			if (this._options.data.buf) {
				buf = this._options.data.buf;
			}
			else {
				buf = await fetch(this._options.data.url!).then(r => r.arrayBuffer());
			}
			let text = new TextDecoder('utf-8').decode(buf);
			delete this._options.data.buf;
			let doc = new DOMParser().parseFromString(text, 'text/html');

			for (let base of doc.querySelectorAll('base')) {
				base.remove();
			}
			if (this._options.data.url !== undefined) {
				let base = doc.createElement('base');
				base.href = this._options.data.url;
				doc.head.prepend(base);
			}

			for (let cspMeta of Array.from(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'))) {
				cspMeta.remove();
			}
			let cspMeta = doc.createElement('meta');
			cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
			cspMeta.setAttribute('content', this._getCSP());
			doc.head.prepend(cspMeta);

			// Fix Twitter snapshots breaking because of <noscript> styles
			for (let noscript of Array.from(doc.querySelectorAll('noscript'))) {
				noscript.remove();
			}

			let doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
			let html = doc.documentElement.outerHTML;
			return doctype + html;
		}
		else {
			throw new Error('buf, url, or srcDoc is required');
		}
	}

	getData() {
		return {
			srcDoc: this._iframe.srcdoc,
			url: this._iframeDocument.head.querySelector('base')?.href,
			importedFromURL: this._options.data.importedFromURL,
		};
	}

	get lang(): string {
		let lang = this._iframeDocument.body.lang || this._iframeDocument.documentElement.lang;
		if (!lang) {
			lang = detectLang(this._iframeDocument.body.innerText) || 'en';
			this._iframeDocument.documentElement.lang = lang;
		}
		return lang;
	}

	protected override _handleIFrameLoaded() {
		let maxRules = this._options.preview ? 100 : 500;
		let numRules = 0;

		let foundSFImg = false;
		let foundFontFace = false;
		for (let sheet of this._iframeDocument.styleSheets) {
			try {
				// Ignore SingleFile embedded image stylesheet
				// https://github.com/gildas-lormeau/single-file-core/blob/1b6cecbe0/core/index.js#L1548-L1560
				if (!foundSFImg && sheet.ownerNode?.textContent?.startsWith(':root{--sf-img-')) {
					foundSFImg = true;
					continue;
				}
				// Ignore SingleFile font-face stylesheet
				// https://github.com/gildas-lormeau/single-file-core/blob/1b6cecbe0/core/index.js#L1047-L1055
				if (!foundFontFace && sheet.ownerNode?.textContent?.startsWith('@font-face{')
					&& Array.prototype.every.call(
						sheet.cssRules,
						rule => rule.constructor.name === 'CSSFontFaceRule'
					)
				) {
					foundFontFace = true;
					continue;
				}
				numRules += sheet.cssRules.length;
				if (numRules > maxRules) {
					this._isDynamicThemeSupported = false;
					break;
				}
			}
			catch {
				// Cross-origin violation, etc.
				// Doesn't matter, this is just a heuristic for disabling Reading Mode
			}
		}

		this._iframeDocument.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));

		return super._handleIFrameLoaded();
	}

	protected override async _handleViewCreated(viewState: Partial<Readonly<SnapshotViewState>>) {
		await super._handleViewCreated(viewState);

		let style = this._iframeDocument.createElement('style');
		style.innerHTML = injectCSS;
		this._iframeDocument.head.append(style);

		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		this._setScale(viewState.scale ?? 1);
		if (this._options.location) {
			this.navigate(this._options.location, { behavior: 'instant' });
		}
		else if (viewState.scrollYPercent !== undefined) {
			this._iframeWindow.scrollTo({
				top: viewState.scrollYPercent
					/ 100
					* (this._iframeDocument.body.scrollHeight - this._iframeDocument.documentElement.clientHeight)
			});
		}

		this._initOutline();

		try {
			// Update old sortIndexes (determined based on length)
			if (!this._options.readOnly) {
				this._options.onUpdateAnnotations(this._annotations
					.filter(a => !a.readOnly && a.sortIndex && a.sortIndex.length === SORT_INDEX_LENGTH_OLD)
					.map((a) => {
						let range = this.toDisplayedRange(a.position);
						if (!range) {
							return null;
						}
						return { id: a.id, sortIndex: this._getSortIndex(range) };
					})
					.filter(Boolean) as Partial<WADMAnnotation>[]
				);
			}
		}
		catch (e) {
			console.warn('Failed to update sortIndexes', e);
		}
	}

	private _getSnapshotLocation() {
		let singleFileComment = this._iframeDocument.documentElement.firstChild;
		if (singleFileComment?.nodeType === Node.COMMENT_NODE
				&& singleFileComment.nodeValue!.trim().startsWith('Page saved with SingleFile')) {
			let matches = singleFileComment.nodeValue!.match(/^\s*url: (https?:\/\/\S+)/m);
			if (matches) {
				return matches[1];
			}
		}
		return null;
	}

	private _initOutline() {
		let bodyFontSize = parseFloat(getComputedStyle(this._iframeDocument.body).fontSize);
		let flatOutline: (OutlineItem & { level: number })[] = [];
		for (let heading of this._iframeDocument.body.querySelectorAll('h1, h2, h3, h4, h5, h6') as NodeListOf<HTMLElement>) {
			if (heading.closest('aside, nav, footer, template, [hidden]')) {
				continue;
			}
			if (!heading.innerText.trim()) {
				continue;
			}
			let headingFontSize = parseFloat(getComputedStyle(heading).fontSize);
			if (headingFontSize <= bodyFontSize) {
				continue;
			}

			let range = this._iframeDocument.createRange();
			range.selectNode(heading);
			let selector = this.toSelector(range);
			if (!selector) {
				continue;
			}
			let level = parseInt(heading.tagName[1]);
			flatOutline.push({
				title: heading.innerText.trim(),
				location: { position: selector },
				items: [],
				expanded: true,
				level
			});
		}
		let outline = [];
		let stack: (OutlineItem & { level: number })[] = [];
		for (let item of flatOutline) {
			while (stack.length && stack[stack.length - 1].level >= item.level) {
				stack.pop();
			}
			if (stack.length) {
				stack[stack.length - 1].items!.push(item);
			}
			else {
				outline.push(item);
			}
			stack.push(item);
		}
		this._options.onSetOutline(outline);
	}

	getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		if (range.collapsed) {
			return null;
		}
		let text = type == 'highlight' || type == 'underline' ? getInnerText(range).trim() : undefined;
		if (text === '') {
			return null;
		}

		let selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		let sortIndex = this._getSortIndex(range);
		return {
			type,
			color,
			sortIndex,
			position: selector,
			text
		};
	}

	private _getSortIndex(range: Range) {
		let getCount = (root: Node, stopContainer?: Node, stopOffset?: number) => {
			let iter = this._iframeDocument.createNodeIterator(root, NodeFilter.SHOW_TEXT);
			let count = 0;
			for (let node of iterateWalker(iter)) {
				if (stopContainer?.contains(node)) {
					return count + stopOffset!;
				}
				count += node.nodeValue!.trim().length;
			}
			return 0;
		};

		let count = getCount(this._iframeDocument.body, range.startContainer, range.startOffset);
		let countString = String(count).padStart(SORT_INDEX_LENGTH, '0');
		if (countString.length > SORT_INDEX_LENGTH) {
			countString = countString.substring(0, SORT_INDEX_LENGTH);
		}
		return countString;
	}

	getSDTLocation(_sdtData: StructuredDocumentText): NavLocation | null {
		return { scrollYPercent: this._getScrollYPercent() };
	}

	navigateToSDTBlock(sdtData: StructuredDocumentText, blockIndex: number) {
		let block = sdtData.content[blockIndex];
		if (!block.anchor || !('selectorMap' in block.anchor)) return;
		let el = this._iframeDocument.body.querySelector(block.anchor.selectorMap);
		if (el) {
			el.scrollIntoView({ behavior: 'instant', block: 'start' });
		}
	}

	private _getScrollYPercent(): number {
		return this._iframeWindow.scrollY
			/ Math.max(1, this._iframeDocument.body.scrollHeight - this._iframeDocument.documentElement.clientHeight)
			* 100;
	}

	getAnnotationMeta(position: Selector): { sortIndex: string; pageLabel: string } | null {
		let range = this.toDisplayedRange(position);
		if (!range) return null;
		return {
			sortIndex: this._getSortIndex(range),
			pageLabel: '',
		};
	}

	toSelector(range: Range): Selector | null {
		let doc = range.commonAncestorContainer.ownerDocument;
		if (!doc) return null;
		let targetNode;
		if (range.startContainer === range.endContainer
				&& range.startOffset == range.endOffset - 1
				&& range.startContainer.nodeType == Node.ELEMENT_NODE) {
			targetNode = range.startContainer.childNodes[range.startOffset];
		}
		else {
			targetNode = range.commonAncestorContainer;
		}
		let targetElement = closestElement(targetNode);
		if (!targetElement) {
			return null;
		}
		let targetElementQuery = getUniqueSelectorContaining(targetElement);
		if (targetElementQuery) {
			let selector: CssSelector = {
				type: 'CssSelector',
				value: targetElementQuery
			};
			if (range.toString().trim() !== (targetElement.textContent || '').trim()) {
				selector.refinedBy = textPositionFromRange(range, targetElement) || undefined;
			}
			return selector;
		}
		else {
			return textPositionFromRange(range, doc.body);
		}
	}

	toDisplayedRange(position: Position): Range | null {
		if (!isSelector(position)) return null;
		let selector = position;
		switch (selector.type) {
			case 'CssSelector': {
				if (selector.refinedBy && selector.refinedBy.type != 'TextPositionSelector') {
					throw new Error('CssSelectors can only be refined by TextPositionSelectors');
				}
				let root = this._iframeDocument.body.querySelector(selector.value);
				if (!root) {
					console.error(`Unable to locate selector root for selector '${selector.value}'`);
					return null;
				}
				let range;
				if (selector.refinedBy) {
					range = textPositionToRange(selector.refinedBy, root);
				}
				else {
					range = this._iframeDocument.createRange();
					range.selectNodeContents(root);
				}
				if (!range?.getClientRects().length) {
					try {
						range?.selectNode(range.commonAncestorContainer);
					}
					catch (e) {
						return null;
					}
				}
				return range;
			}
			case 'TextPositionSelector': {
				if (selector.refinedBy) {
					throw new Error('Refinement of TextPositionSelectors is not supported');
				}
				return textPositionToRange(selector, this._iframeDocument.body);
			}
			default:
				throw new Error(`Unsupported Selector.type: ${selector.type}`);
		}
	}

	protected _getHistoryLocation(): NavLocation | null {
		return { scrollCoords: [this._iframeWindow.scrollX, this._iframeWindow.scrollY] };
	}

	navigateToSelector(selector: Selector, options: NavigateOptions = {}) {
		let range = this.toDisplayedRange(selector);
		if (!range) {
			console.warn('Unable to resolve selector to range', selector);
			return;
		}

		let elem = getStartElement(range);

		if (options.ifNeeded && isPageRectVisible(
			getBoundingPageRect(elem ?? range),
			this._iframeWindow,
			options.visibilityMargin ?? 0
		)) {
			return;
		}

		if (elem) {
			elem.scrollIntoView(options);
			debounceUntilScrollFinishes(this._iframeDocument).then(() => {
				this._a11yVirtualCursorTarget = elem;
			});
		}

		scrollIntoView(range, options);
	}

	protected override _updateViewState() {
		let scale = Math.round(this.scale * 1000) / 1000;
		let scrollYPercent = this._iframeWindow.scrollY
			/ (this._iframeDocument.body.scrollHeight - this._iframeDocument.documentElement.clientHeight)
			* 100;
		if (isNaN(scrollYPercent)) {
			scrollYPercent = 0;
		}
		scrollYPercent = Math.max(0, Math.min(100, scrollYPercent));
		scrollYPercent = Math.round(scrollYPercent * 10) / 10;
		let viewState: SnapshotViewState = {
			scale,
			scrollYPercent,
			appearance: this.appearance,
		};
		this._options.onChangeViewState(viewState);
	}

	protected override _updateViewStats() {
		let viewStats: ViewStats = {
			canCopy: !!this._selectedAnnotationIDs.length || !(this._iframeWindow.getSelection()?.isCollapsed ?? true),
			canZoomIn: this.scale === undefined || this.scale < this.MAX_SCALE,
			canZoomOut: this.scale === undefined || this.scale > this.MIN_SCALE,
			canZoomReset: this.scale !== undefined && this.scale !== 1,
			canNavigateBack: this._history.canNavigateBack,
			canNavigateForward: this._history.canNavigateForward,
			appearance: this.appearance,
		};
		this._options.onChangeViewStats(viewStats);
	}

	protected _getRoots(): HTMLElement[] {
		return [this._iframeDocument.body];
	}

	protected override _updateColorScheme() {
		super._updateColorScheme();
		if (this._isDynamicThemeSupported) {
			this._iframeDocument.body.classList.remove('force-static-theme');
			if (!('DarkReader' in this._iframeWindow)) {
				let url = this._getSnapshotLocation() || 'about:blank';
				this._iframeWindow.eval(`{ let location = new URL(${JSON.stringify(url)}); ${darkReaderJS} }`);
			}
			let DarkReader = this._iframeWindow.DarkReader!;
			if (this._themeColorScheme === 'light' && this._theme.id === 'light') {
				DarkReader.disable();
			}
			else {
				DarkReader.enable({
					mode: this._themeColorScheme === 'light' ? 0 : 1,
					darkSchemeBackgroundColor: this._theme.background,
					darkSchemeTextColor: this._theme.foreground,
					lightSchemeBackgroundColor: this._theme.background,
					lightSchemeTextColor: this._theme.foreground,
				}, {
					invert: [
						'.mw-invert'
					]
				} satisfies Partial<DynamicThemeFix> as DynamicThemeFix);
			}
		}
		else {
			if ('DarkReader' in this._iframeWindow) {
				this._iframeWindow.DarkReader!.disable();
			}
			this._iframeDocument.body.classList.toggle('force-static-theme', this._theme?.id !== 'light');
		}
	}

	// ***
	// Event handlers
	// ***

	protected _handleInternalLinkClick(link: HTMLAnchorElement): void {
		this._iframeDocument.location.hash = link.getAttribute('href')!;
		this._updateViewState();
	}

	protected override _handleScroll(event: Event) {
		super._handleScroll(event);
		this._updateViewState();
		this._pushHistoryPoint(true);

		if (this._readAloud.state?.active && !this._readAloud.scrolling) {
			this._onManualNavigation();
		}
	}

	protected _handleVisibilityChange() {
		if (this._iframeDocument.visibilityState !== 'visible') {
			return;
		}
		this._handleViewUpdate();
	}


	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	async setFindState(state: FindState) {
		let previousState = this._findState;
		this._findState = state;
		if (!state.active && previousState && previousState.active !== state.active) {
			console.log('Closing find popup');
			if (this._find) {
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
				this._find = new DefaultFindProcessor({
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
									&& this.getAnnotationFromRange(result.range.toRange(), 'highlight')
								) ?? undefined,
								currentPageLabel: null,
								currentSnippet: result.snippets[result.index]
							}
						});
						if (result.range) {
							this._a11yVirtualCursorTarget = getStartElement(result.range);
						}
					},
				});
				await this._find.run(
					this._searchContext,
					this._lastSelectionRange ?? undefined
				);
				this.findNext();
			}
			else {
				if (previousState && previousState.highlightAll !== state.highlightAll) {
					this._find.findState.highlightAll = state.highlightAll;
					this._renderAnnotations();
				}
				if (previousState && state.index !== null && previousState.index !== state.index) {
					console.log('Navigate to result', state.index);
					this._find.position = state.index;
					let result = this._find.getResults()[state.index];
					if (result) {
						scrollIntoView(result.range.toRange(), { block: 'center' });
					}
					this._renderAnnotations();
				}
			}
		}
	}

	findNext() {
		console.log('Find next');
		if (this._find) {
			let result = this._find.next();
			if (result) {
				scrollIntoView(result.range.toRange(), { block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	findPrevious() {
		console.log('Find previous');
		if (this._find) {
			let result = this._find.prev();
			if (result) {
				scrollIntoView(result.range.toRange(), { block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	protected _setScale(scale: number) {
		this.scale = scale;

		let scaleString = scale.toFixed(3);
		if (CSS.supports('scale', scaleString)) {
			this._iframeDocument.documentElement.style.setProperty('--scale', scaleString);
			if (isSafari) {
				this._iframeCoordScaleFactor = scale;
			}
		}
		else {
			if (scale == 1) {
				this._iframeDocument.documentElement.style.fontSize = '';
				return;
			}

			this._iframeDocument.documentElement.style.fontSize = '';
			let defaultSize = parseFloat(getComputedStyle(this._iframeDocument.documentElement).fontSize);
			this._iframeDocument.documentElement.style.fontSize = (defaultSize * scale) + 'px';
		}
	}

	override navigate(location: NavLocation, options: NavigateOptions = {}) {
		console.log('Navigating to', location);
		options.behavior ||= 'smooth';

		if (location.scrollCoords) {
			this._iframeWindow.scrollTo(...location.scrollCoords);
		}
		else {
			super.navigate(location, options);
		}

		if (!options.skipHistory) {
			this._pushHistoryPoint();
		}
	}

	async print() {
		if (typeof this._iframeWindow.zoteroPrint === 'function') {
			await this._iframeWindow.zoteroPrint({
				overrideSettings: {
					docURL: this._options.data.importedFromURL || '',
				},
			});
		}
		else {
			this._iframeWindow.print();
		}
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		// Ignore
	}
}

export interface SnapshotViewState extends DOMViewState {
	scrollYPercent?: number;
}

export interface SnapshotViewData {
	srcDoc?: string;
	url?: string;
	importedFromURL?: string;
}

export default SnapshotView;
