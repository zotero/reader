import {
	AnnotationType,
	WADMAnnotation,
	FindState,
	isSDTPosition,
	NavLocation,
	NewAnnotation,
	Position,
	ViewStats,
	OutlineItem,
	SDTPosition,
} from "../../common/types";
import {
	getBoundingPageRect,
	getInnerText,
	getStartElement,
} from "../common/lib/range";
import {
	Selector,
} from "../common/lib/selector";
import DOMView, {
	DOMViewState,
	NavigateOptions,
} from "../common/dom-view";
import {
	closestElement,
	getVisibleTextNodes,
} from "../common/lib/nodes";
import DefaultFindProcessor, { createSearchContext } from "../common/lib/find";
import { isPageRectVisible } from "../common/lib/rect";
import { scrollIntoView } from "../common/lib/scroll-into-view";
import { isSafari } from "../../common/lib/utilities";
import { renderSDT } from "./lib/renderer";
import { type PositionMapper } from "./lib/position-index";
import { createPositionMapper } from "./lib/create-position-mapper";
import sdtSCSS from './stylesheets/sdt.scss';
import type { StructuredDocumentText } from '../../../structured-document-text/schema';

export interface SDTViewData {
	sdt: StructuredDocumentText;
	getSourceAnnotationMeta: (position: Position) => { sortIndex: string; pageLabel: string } | null;
	syncBaseView: (blockIndex: number) => void;
}

class SDTView extends DOMView<DOMViewState, SDTViewData> {
	protected _find: DefaultFindProcessor | null = null;

	private _sdt!: StructuredDocumentText;

	private _positionMapper!: PositionMapper;

	private get _searchContext() {
		let searchContext = createSearchContext(getVisibleTextNodes(this._iframeDocument.body));
		Object.defineProperty(this, '_searchContext', { value: searchContext });
		return searchContext;
	}

	protected override async _getSrcDoc() {
		return '<!DOCTYPE html><html><head></head><body></body></html>';
	}

	override getData(): SDTViewData {
		return this._options.data;
	}

	override get lang(): string {
		let lang = this._sdt.metadata?.language
			|| this._sdt.metadata?.Language
			|| this._sdt.metadata?.['dc:language'];
		if (typeof lang === 'string' && lang) {
			return lang.split('-')[0];
		}
		return 'en';
	}

	protected override async _handleViewCreated(viewState: Partial<DOMViewState>) {
		this._sdt = this._options.data.sdt;

		// Render SDT content into the iframe body
		let content = renderSDT(this._sdt, this._iframeDocument);
		this._iframeDocument.body.append(content);

		// Build position index for source-format annotation mapping
		this._positionMapper = this._createPositionMapper();

		// Inject SDT stylesheet
		let style = this._iframeDocument.createElement('style');
		style.textContent = sdtSCSS;
		this._iframeDocument.head.append(style);

		await super._handleViewCreated(viewState);

		this._setScale(viewState.scale ?? 1);

		// Build outline
		this._initOutline();

		if (this._options.location) {
			this.navigate(this._options.location, { behavior: 'instant' });
		}
	}

	getVisibleBlockIndex(): number | null {
		let blocks = this._iframeDocument.querySelectorAll('#sdt-content > [data-ref-path]');
		let bestRefPath: string | null = null;
		let bestDist = Infinity;
		for (let block of blocks) {
			let rect = block.getBoundingClientRect();
			if (rect.bottom < 0) continue;
			let dist = Math.abs(rect.top);
			if (dist < bestDist) {
				bestDist = dist;
				bestRefPath = (block as HTMLElement).dataset.refPath ?? null;
			}
			if (rect.top > 200) break;
		}
		if (!bestRefPath) return null;
		return parseInt(bestRefPath.split('.')[0]);
	}

	private _createPositionMapper(): PositionMapper {
		return createPositionMapper(this._sdt);
	}

	private _initOutline() {
		if (!this._sdt.outline?.length) return;
		let outline = this._convertOutline(this._sdt.outline);
		this._options.onSetOutline(outline);
	}

	private _convertOutline(items: StructuredDocumentText['outline']): OutlineItem[] {
		if (!items) return [];
		return items.map((item) => {
			let location: NavLocation = {};
			if (item.ref) {
				location.href = '#sdt-' + item.ref.join('.');
			}
			return {
				title: item.title,
				location,
				items: item.children ? this._convertOutline(item.children) : undefined,
			};
		});
	}

	// Annotation methods

	override getAnnotationFromRange(range: Range, type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null {
		if (range.collapsed) {
			return null;
		}

		let text = getInnerText(range);
		if (!text.trim().length) {
			return null;
		}

		let selector = this.toSelector(range);
		if (!selector) {
			return null;
		}

		let meta = this._options.data.getSourceAnnotationMeta(selector);
		if (!meta) {
			return null;
		}

		return {
			type,
			color,
			sortIndex: meta.sortIndex,
			position: selector,
			text,
			pageLabel: meta.pageLabel,
		};
	}

	protected override _finalizeAnnotation(annotation: NewAnnotation<WADMAnnotation>): NewAnnotation<WADMAnnotation> {
		let position = this._positionMapper.transformAnnotationPosition(annotation.position, annotation.type);
		if (position === annotation.position) return annotation;
		return {
			...annotation,
			position: position as Selector,
			sortIndex: this._options.data.getSourceAnnotationMeta(position)?.sortIndex
				?? annotation.sortIndex,
		};
	}

	override toSelector(range: Range): Selector | null {
		if (!this._positionMapper) {
			return null;
		}

		// Resolve DOM range to SDT text node positions
		let sdtPos = this._resolveRangeToSDT(range);
		if (!sdtPos) return null;

		// Map through SDT anchors to source-format position
		return this._positionMapper.sdtToSourcePosition(sdtPos) as Selector | null;
	}

	override toDisplayedRange(position: Position): Range | null {
		if (!this._positionMapper) {
			return null;
		}

		if (isSDTPosition(position)) {
			return this._createDOMRange(position);
		}

		// Source-format position: map through SDT anchors to DOM range
		let sdtPos = this._positionMapper.sourceToSDTPosition(position);
		if (!sdtPos) return null;

		return this._createDOMRange(sdtPos);
	}

	/**
	 * Get the current text selection as SDT coordinates, if any.
	 */
	getSelectionAsSDTRange(): SDTPosition | null {
		let sel = this._iframeDocument.getSelection();
		if (!sel || sel.isCollapsed) return null;
		let range = sel.getRangeAt(0);
		return this._resolveRangeToSDT(range);
	}

	protected override _getAnnotationDisplayedRange(annotation: Partial<WADMAnnotation> & Pick<WADMAnnotation, 'type' | 'position'>): Range | null {
		let range = this.toDisplayedRange(annotation.position);
		if (!range) return null;
		if (annotation.type === 'note') {
			let block = closestElement(range.commonAncestorContainer)?.closest('[data-ref-path]');
			if (block) {
				range = this._iframeDocument.createRange();
				range.selectNodeContents(block);
			}
		}
		return range;
	}

	/**
	 * Resolve a DOM Range to SDT text node coordinates.
	 */
	private _resolveRangeToSDT(range: Range): {
		startBlockRefPath: string; startTextIndex: number; startCharOffset: number;
		endBlockRefPath: string; endTextIndex: number; endCharOffset: number;
	} | null {
		let start = this._domPositionToSDT(range.startContainer, range.startOffset, false);
		let end = this._domPositionToSDT(range.endContainer, range.endOffset, true);
		if (!start || !end) return null;
		return {
			startBlockRefPath: start.blockRefPath,
			startTextIndex: start.textIndex,
			startCharOffset: start.charOffset,
			endBlockRefPath: end.blockRefPath,
			endTextIndex: end.textIndex,
			endCharOffset: end.charOffset,
		};
	}

	/**
	 * Map a single DOM position (node + offset) to SDT text node coordinates.
	 */
	private _domPositionToSDT(node: Node, offset: number, isEnd = false): {
		blockRefPath: string;
		textIndex: number;
		charOffset: number;
	} | null {
		// Walk up to find the text span (has data-text-index)
		let textSpan: HTMLElement | null = null;
		let current: Node | null = node;
		while (current && current !== this._iframeDocument.body) {
			if (current.nodeType === Node.ELEMENT_NODE
					&& (current as HTMLElement).dataset.textIndex !== undefined) {
				textSpan = current as HTMLElement;
				break;
			}
			current = current.parentNode;
		}

		// If we didn't find a text span (e.g., position is at an element boundary
		// between blocks), resolve to the nearest text span
		if (!textSpan && node.nodeType === Node.ELEMENT_NODE) {
			let el = node as HTMLElement;
			if (isEnd && offset > 0) {
				// End position: find the last text span in the preceding content
				let child = el.childNodes[offset - 1];
				if (child) {
					let spans = (child.nodeType === Node.ELEMENT_NODE ? child as HTMLElement : el)
						.querySelectorAll('[data-text-index]');
					if (spans?.length) {
						textSpan = spans[spans.length - 1] as HTMLElement;
					}
				}
			}
			if (!textSpan) {
				// Start position or fallback: find the first text span in the following content
				let child = el.childNodes[offset] || el.childNodes[el.childNodes.length - 1];
				if (child) {
					textSpan = (child.nodeType === Node.ELEMENT_NODE ? child as HTMLElement : el)
						.querySelector('[data-text-index]') as HTMLElement | null;
				}
			}
		}

		if (!textSpan) return null;

		// Walk up further to find the block (has data-ref-path)
		let blockEl: HTMLElement | null = textSpan.parentElement;
		while (blockEl && !blockEl.dataset.refPath) {
			blockEl = blockEl.parentElement;
		}
		if (!blockEl) return null;

		// Compute character offset within this text span.
		let charOffset: number;
		if (textSpan.contains(node)) {
			let charRange = this._iframeDocument.createRange();
			charRange.setStart(textSpan, 0);
			charRange.setEnd(node, offset);
			charOffset = charRange.toString().length;
		}
		else {
			// Position was resolved to a different span — use start or end
			charOffset = isEnd ? (textSpan.textContent?.length ?? 0) : 0;
		}

		return {
			blockRefPath: blockEl.dataset.refPath!,
			textIndex: parseInt(textSpan.dataset.textIndex!),
			charOffset,
		};
	}

	/**
	 * Create a DOM Range from SDT position coordinates.
	 */
	private _createDOMRange(pos: {
		startBlockRefPath: string; startTextIndex: number; startCharOffset: number;
		endBlockRefPath: string; endTextIndex: number; endCharOffset: number;
	}): Range | null {
		let startPos = this._sdtPositionToDOM(pos.startBlockRefPath, pos.startTextIndex, pos.startCharOffset);
		let endPos = this._sdtPositionToDOM(pos.endBlockRefPath, pos.endTextIndex, pos.endCharOffset);
		if (!startPos || !endPos) return null;

		let range = this._iframeDocument.createRange();
		range.setStart(startPos.node, startPos.offset);
		range.setEnd(endPos.node, endPos.offset);
		return range;
	}

	/**
	 * Map SDT coordinates to a DOM text node + offset.
	 */
	private _sdtPositionToDOM(blockRefPath: string, textIndex: number, charOffset: number): {
		node: Node; offset: number;
	} | null {
		let blockEl = this._iframeDocument.querySelector(`[data-ref-path="${blockRefPath}"]`);
		if (!blockEl) return null;

		let textSpan = blockEl.querySelector(`[data-text-index="${textIndex}"]`);
		if (!textSpan) return null;

		// Walk text nodes within the span to find the right offset
		let walker = this._iframeDocument.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT);
		let remaining = charOffset;
		let textNode;
		while ((textNode = walker.nextNode())) {
			let len = textNode.textContent!.length;
			if (remaining <= len) {
				return { node: textNode, offset: remaining };
			}
			remaining -= len;
		}

		// Fallback: end of last text node
		let lastText = textSpan.lastChild;
		if (lastText) {
			return { node: lastText, offset: lastText.textContent?.length ?? 0 };
		}
		return null;
	}

	protected override _getHistoryLocation(): NavLocation | null {
		return { scrollCoords: [this._iframeWindow.scrollX, this._iframeWindow.scrollY] };
	}

	override navigate(location: NavLocation, options: NavigateOptions = {}) {
		if (location.href?.startsWith('#sdt-')) {
			let el = this._iframeDocument.getElementById(location.href.slice(1));
			if (el) {
				scrollIntoView(el, {
					behavior: options.behavior ?? 'smooth',
					block: options.block ?? 'start',
				});
			}
			return;
		}
		if (location.scrollYPercent !== undefined) {
			this._iframeWindow.scrollTo({
				top: location.scrollYPercent / 100
					* (this._iframeDocument.body.scrollHeight - this._iframeDocument.documentElement.clientHeight),
				behavior: options.behavior as ScrollBehavior ?? 'instant',
			});
			return;
		}
		if (location.scrollCoords) {
			this._iframeWindow.scrollTo(...location.scrollCoords);
			return;
		}
		super.navigate(location, options);
	}

	override navigateToSelector(selector: Selector, options: NavigateOptions = {}) {
		let range = this.toDisplayedRange(selector);
		if (!range) {
			return;
		}
		let rect = getBoundingPageRect(range);
		if (!rect || options.ifNeeded && isPageRectVisible(rect, this._iframeWindow)) {
			return;
		}
		scrollIntoView(range, {
			behavior: options.behavior ?? 'smooth',
			block: options.block ?? 'center',
		});
	}

	protected override _handleScroll(event: Event) {
		super._handleScroll(event);
		this._updateViewState();
	}

	protected override _updateViewState() {
		let blockIndex = this.getVisibleBlockIndex();
		if (blockIndex !== null) {
			this._options.data.syncBaseView(blockIndex);
		}
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

	protected override _handleInternalLinkClick(link: HTMLAnchorElement): void {
		let href = link.getAttribute('href');
		if (!href?.startsWith('#sdt-')) return;
		this.navigate({ href }, { behavior: 'smooth', block: 'center' });
	}

	protected override _setScale(scale: number) {
		this.scale = scale;
		let scaleString = scale.toFixed(3);
		if (CSS.supports('scale', scaleString)) {
			this._iframeDocument.documentElement.style.setProperty('--scale', scaleString);
			if (isSafari) {
				this._iframeCoordScaleFactor = scale;
			}
		}
	}

	override getReadAloudBlock(element: Element): Element | null {
		return element.closest('[data-ref-path]');
	}

	protected override _getRoots(): HTMLElement[] {
		return [this._iframeDocument.body];
	}

	async setFindState(state: FindState) {
		let previousState = this._findState;
		this._findState = state;
		if (!state.active && previousState && previousState.active !== state.active) {
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
				this._find = new DefaultFindProcessor({
					findState: { ...state },
					onSetFindState: (result) => {
						this._options.onSetFindState({
							...state,
							result: {
								total: result.total ?? 0,
								index: result.index ?? 0,
								snippets: result.snippets ?? [],
								annotation: (
									result.range
									&& this.getAnnotationFromRange(result.range.toRange(), 'highlight')
								) ?? undefined,
								currentSnippet: result.snippets?.[result.index ?? 0] ?? '',
								currentPageLabel: null,
							},
						});
						if (result.range) {
							this._a11yVirtualCursorTarget = getStartElement(result.range);
						}
					},
				});
				await this._find.run(
					this._searchContext,
					this._lastSelectionRange ?? undefined,
				);
				this.findNext();
			}
			else {
				if (previousState && previousState.highlightAll !== state.highlightAll) {
					this._find.findState.highlightAll = state.highlightAll;
					this._renderAnnotations();
				}
				if (previousState && state.index !== null && previousState.index !== state.index) {
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
		if (this._find) {
			let result = this._find.next();
			if (result) {
				scrollIntoView(result.range.toRange(), { block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	findPrevious() {
		if (this._find) {
			let result = this._find.prev();
			if (result) {
				scrollIntoView(result.range.toRange(), { block: 'center' });
			}
			this._renderAnnotations();
		}
	}

	override async print() {
		this._iframeWindow.print();
	}

	setSidebarOpen(_sidebarOpen: boolean) {
		// Ignore
	}
}

export default SDTView;
