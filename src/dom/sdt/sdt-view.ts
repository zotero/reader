import {
	AnnotationType,
	WADMAnnotation,
	FindState,
	isSDTPosition,
	NavLocation,
	NewAnnotation,
	Position,
	SDTPosition,
	SourcePosition,
	ViewStats,
	OutlineItem,
} from "../../common/types";
import type { StructuredDocumentText } from '../../../structured-document-text/schema';
import type { SDTPositionMapper } from '../../common/sdt/position-mapper';
import { getSDTLang } from '../../common/read-aloud/sdt-segments';
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
import sdtSCSS from './stylesheets/sdt.scss';

export interface SDTViewData {
	structure: StructuredDocumentText;
	mapper: SDTPositionMapper;
	getSourceAnnotationMeta: (position: SourcePosition) => { sortIndex: string, pageLabel: string } | null;
	syncBaseView: (blockIndex: number) => void;
}

/**
 * Displays SDT content as reflowable HTML -- the Reading Mode overlay for
 * PDFs and snapshots. Annotations pass through to the source document's
 * coordinate system, so everything created here works in the base view and
 * vice versa.
 */
class SDTView extends DOMView<DOMViewState, SDTViewData> {
	protected _find: DefaultFindProcessor | null = null;

	private _structure = this._options.data.structure;

	private _mapper = this._options.data.mapper;

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
		return getSDTLang(this._structure);
	}

	protected override async _handleViewCreated(viewState: Partial<DOMViewState>) {
		this._iframeDocument.body.append(renderSDT(this._structure, this._iframeDocument));

		let style = this._iframeDocument.createElement('style');
		style.textContent = sdtSCSS;
		this._iframeDocument.head.append(style);

		await super._handleViewCreated(viewState);

		this._setScale(viewState.scale ?? 1);
		this._initOutline();

		if (this._options.location) {
			this.navigate(this._options.location, { behavior: 'instant' });
		}
	}

	// Top-level SDT block index for the block nearest the top of the
	// viewport, or null
	getVisibleBlockIndex(_structure?: StructuredDocumentText): number | null {
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

	private _initOutline() {
		if (!this._structure.catalog.outline?.length) return;
		this._options.onSetOutline(this._convertOutline(this._structure.catalog.outline));
	}

	private _convertOutline(items: StructuredDocumentText['catalog']['outline']): OutlineItem[] {
		return items.map(item => ({
			title: item.title,
			location: item.ref ? { href: '#sdt-' + item.ref.join('.') } : {},
			items: item.children ? this._convertOutline(item.children) : undefined,
		}));
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
		let position = this._mapper.transformAnnotationPosition(annotation.position, annotation.type);
		if (position === annotation.position) {
			return annotation;
		}
		return {
			...annotation,
			position: position as Selector,
			sortIndex: this._options.data.getSourceAnnotationMeta(position)?.sortIndex
				?? annotation.sortIndex,
		};
	}

	override toSelector(range: Range): Selector | null {
		let sdtPosition = this._rangeToSDTPosition(range);
		if (!sdtPosition) return null;
		// The selector lives in the source document's coordinate system, so
		// it works in the base view and can be saved on annotations
		return this._mapper.sdtToSourcePosition(sdtPosition) as Selector | null;
	}

	override toDisplayedRange(position: Position): Range | null {
		let sdtPosition = isSDTPosition(position)
			? position
			: this._mapper.sourceToSDTPosition(position as SourcePosition);
		if (!sdtPosition) return null;
		return this._sdtPositionToRange(sdtPosition);
	}

	override getSelectionPosition(): SDTPosition | null {
		let selection = this._iframeWindow.getSelection();
		if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
		return this._rangeToSDTPosition(selection.getRangeAt(0));
	}

	protected override _getAnnotationDisplayedRange(annotation: Partial<WADMAnnotation> & Pick<WADMAnnotation, 'type' | 'position'>): Range | null {
		let range = this.toDisplayedRange(annotation.position);
		if (!range) return null;
		// Note annotations anchor to a point -- display them on their block
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
	 * Resolve a DOM Range to an SDTPosition.
	 */
	private _rangeToSDTPosition(range: Range): SDTPosition | null {
		let start = this._domPositionToPoint(range.startContainer, range.startOffset, false);
		let end = this._domPositionToPoint(range.endContainer, range.endOffset, true);
		if (!start || !end) return null;
		return { start, end };
	}

	/**
	 * Map a single DOM position (node + offset) to an SDT content point.
	 */
	private _domPositionToPoint(node: Node, offset: number, isEnd: boolean): number[] | null {
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

		// If we didn't find a text span (e.g., position is at an element
		// boundary between blocks), resolve to the nearest text span
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

		let blockEl = textSpan.closest('[data-ref-path]') as HTMLElement | null;
		if (!blockEl) return null;

		// Compute character offset within this text span
		let charOffset: number;
		if (textSpan.contains(node)) {
			let charRange = this._iframeDocument.createRange();
			charRange.setStart(textSpan, 0);
			charRange.setEnd(node, offset);
			charOffset = charRange.toString().length;
		}
		else {
			// Position was resolved to a different span -- use its start or end
			charOffset = isEnd ? (textSpan.textContent?.length ?? 0) : 0;
		}

		return [
			...blockEl.dataset.refPath!.split('.').map(Number),
			parseInt(textSpan.dataset.textIndex!),
			charOffset,
		];
	}

	private _sdtPositionToRange(position: SDTPosition): Range | null {
		let start = this._pointToDOMPosition(position.start);
		let end = this._pointToDOMPosition(position.end);
		if (!start || !end) return null;

		let range = this._iframeDocument.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		return range;
	}

	/**
	 * Map an SDT content point to a DOM text node + offset. The point's path
	 * ends with a text node index and a character offset; everything before
	 * that names the block.
	 */
	private _pointToDOMPosition(point: number[]): { node: Node, offset: number } | null {
		if (point.length < 3) {
			// Block-level point -- resolve to the start of the block
			let blockEl = this._iframeDocument.querySelector(`[data-ref-path="${point.join('.')}"]`)
				?? this._iframeDocument.querySelector(`[data-ref-path^="${point.join('.')}."]`);
			if (!blockEl) return null;
			return { node: blockEl, offset: 0 };
		}

		let refPath = point.slice(0, -2).join('.');
		let textIndex = point[point.length - 2];
		let charOffset = point[point.length - 1];

		let blockEl = this._iframeDocument.querySelector(`[data-ref-path="${refPath}"]`);
		if (!blockEl) return null;
		let textSpan = blockEl.querySelector(`[data-text-index="${textIndex}"]`);
		if (!textSpan) return null;

		// Walk text nodes within the span to find the right offset
		let walker = this._iframeDocument.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT);
		let remaining = charOffset;
		let textNode;
		while ((textNode = walker.nextNode())) {
			let length = textNode.textContent!.length;
			if (remaining <= length) {
				return { node: textNode, offset: remaining };
			}
			remaining -= length;
		}

		// Fallback: end of the span's last text node
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
		if (!rect || options.ifNeeded && isPageRectVisible(rect, this._iframeWindow, options.visibilityMargin ?? 0)) {
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
		// Keep the hidden base view's position in sync, so page numbers stay
		// correct and the document reopens where the user left off
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
				// Scaling doesn't affect getClientRects() in Safari
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
