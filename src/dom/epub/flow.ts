import { EpubCFI } from "epubjs";
import { debounce } from "../../common/lib/debounce";
import { NavigateOptions } from "../common/dom-view";
import { closestAll, closestElement, isRTL, isVertical, iterateWalker } from "../common/lib/nodes";
import EPUBView, { SpreadMode } from "./epub-view";
import { getBoundingPageRect, PersistentRange } from "../common/lib/range";
import { isSafari } from "../../common/lib/utilities";
import { getSelectionRanges } from "../common/lib/selection";
import { isPageRectVisible, rectContainsPoint } from "../common/lib/rect";
import Section from "epubjs/types/section";
import SectionRenderer from "./section-renderer";

export interface Flow {
	readonly startSection: Section | null;

	readonly startRange: Range | null;

	readonly startCFI: EpubCFI | null;

	readonly startCFIOffset: number | null;

	readonly startRangeIsBeforeFirstMapping: boolean;

	scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: NavigateOptions): void;

	canNavigateToPreviousPage(): boolean;

	canNavigateToNextPage(): boolean;

	navigateToPreviousPage(): void;

	navigateToNextPage(): void;

	navigateToFirstPage(): void;

	navigateToLastPage(): void;

	canNavigateLeft(): boolean;

	canNavigateRight(): boolean;

	navigateLeft(): void;

	navigateRight(): void;

	invalidate: ReturnType<typeof debounce<() => void>>;

	setScale(scale: number): void;

	setSpreadMode(spreadMode: SpreadMode): void;

	destroy(): void;
}

abstract class AbstractFlow implements Flow {
	protected _view: EPUBView;

	protected _cachedStartSection: Section | null = null;

	protected _cachedStartRange: PersistentRange | null = null;

	protected _cachedStartCFI: EpubCFI | null = null;

	protected _cachedStartCFIOffset: number | null = null;

	protected _iframe: HTMLIFrameElement;

	protected _iframeWindow: Window & typeof globalThis;

	protected _iframeDocument: Document;

	protected _scale = 1;

	protected _isRTL = false;

	protected _isVertical = false;

	protected _onUpdateViewState: () => void;

	protected _onUpdateViewStats: () => void;

	protected _onViewUpdate: () => void;

	protected _onPushHistoryPoint: (transient: boolean) => void;

	protected _onManualNavigation: () => void;

	protected _nextHistoryPushIsFromNavigation = false;

	protected _intersectionObserver: IntersectionObserver;

	protected constructor(options: Options) {
		this._view = options.view;
		this._iframe = options.iframe;
		this._iframeWindow = options.iframe.contentWindow! as Window & typeof globalThis;
		this._iframeDocument = options.iframe.contentDocument!;
		this._scale = options.view.scale;
		this._onUpdateViewState = options.onUpdateViewState;
		this._onUpdateViewStats = options.onUpdateViewStats;
		this._onViewUpdate = options.onViewUpdate;
		this._onPushHistoryPoint = options.onPushHistoryPoint;
		this._onManualNavigation = options.onManualNavigation;

		this._isRTL = isRTL(this._iframeDocument.body);
		this._isVertical = isVertical(this._iframeDocument.body);

		this._iframeWindow.addEventListener('scroll', this._pushHistoryPoint);

		this._intersectionObserver = new IntersectionObserver(() => this.invalidate(), {
			threshold: [0, 1]
		});
		for (let range of this._view.pageMapping.ranges()) {
			let elem = closestElement(range.startContainer);
			if (elem) {
				this._intersectionObserver.observe(elem);
			}
		}
	}

	destroy(): void {
		this._iframeWindow.removeEventListener('scroll', this._pushHistoryPoint);
		this._intersectionObserver.disconnect();
	}

	get startSection(): Section | null {
		if (!this._cachedStartSection) {
			this._updateDisplayCache();
		}
		return this._cachedStartSection;
	}

	get startRange(): Range | null {
		if (!this._cachedStartRange) {
			this._updateDisplayCache();
		}
		return this._cachedStartRange?.toRange() ?? null;
	}

	get startCFI(): EpubCFI | null {
		if (!this._cachedStartCFI) {
			this._updateUserAnchor();
		}
		return this._cachedStartCFI;
	}

	get startCFIOffset(): number | null {
		if (this._cachedStartCFIOffset === null) {
			this._updateUserAnchor();
		}
		return this._cachedStartCFIOffset;
	}

	get startRangeIsBeforeFirstMapping() {
		if (!this.startRange) {
			return true;
		}
		let firstMappedRange = this._view.pageMapping.firstRange;
		if (!firstMappedRange) {
			return false;
		}
		return EPUBView.compareBoundaryPoints(Range.START_TO_START, this.startRange, firstMappedRange) < 0;
	}

	/**
	 * Return a range before or at the top of the viewport.
	 *
	 * @param renderer
	 * @param textNodesOnly Return only text nodes, for constructing CFIs
	 */
	protected _getFirstVisibleRange(renderer: SectionRenderer, textNodesOnly: boolean): Range | null {
		if (!renderer.mounted) {
			return null;
		}
		let isPaginated = this instanceof PaginatedFlow;
		let isScrolledVerticalRTL = !isPaginated && this._isVertical && this._isRTL;
		let mainAxisViewportEnd = isPaginated ? this._iframe.clientWidth : this._iframe.clientHeight;
		let crossAxisViewportEnd = isPaginated ? this._iframe.clientHeight : this._iframe.clientWidth;
		let filter = NodeFilter.SHOW_TEXT | (textNodesOnly ? 0 : NodeFilter.SHOW_ELEMENT);
		let iter = this._iframeDocument.createNodeIterator(renderer.container, filter, (node) => {
			return node.nodeType == Node.TEXT_NODE && node.nodeValue?.trim().length
					|| (node as Element).tagName === 'IMG'
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP;
		});
		let bestRange = null;
		for (let node of iterateWalker(iter)) {
			let range = this._iframeDocument.createRange();
			if (node.nodeType == Node.ELEMENT_NODE) {
				range.selectNode(node);
			}
			else {
				range.selectNodeContents(node);
			}

			let rect = range.getBoundingClientRect();
			// Skip invisible nodes
			if (!(rect.width || rect.height)) {
				continue;
			}
			let mainAxisRectStart = isPaginated ? rect.left : rect.top;
			let mainAxisRectEnd = isPaginated ? rect.right : rect.bottom;
			let crossAxisRectStart = isPaginated ? rect.top : rect.left;
			let crossAxisRectEnd = isPaginated ? rect.bottom : rect.right;
			if (isScrolledVerticalRTL) {
				crossAxisRectStart = this._iframe.clientWidth - crossAxisRectStart;
				crossAxisRectEnd = this._iframe.clientHeight - crossAxisRectEnd;
			}
			// If the range starts past the end of the viewport, we've gone too far -- return our previous best guess
			if (mainAxisRectStart > mainAxisViewportEnd || crossAxisRectStart > crossAxisViewportEnd) {
				return bestRange;
			}
			// If it starts in the viewport, return it immediately
			if (
				(mainAxisRectStart >= 0 || mainAxisRectStart < 0 && mainAxisRectEnd > 0)
				&& (crossAxisRectStart >= 0 || crossAxisRectStart < 0 && crossAxisRectEnd > 0)
			) {
				return range;
			}
			// Otherwise, it's before the start of the viewport -- save it as our best guess in case nothing within
			// the viewport is usable, but keep going
			else {
				bestRange = range;
			}
		}
		return null;
	}

	abstract scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: NavigateOptions): void;

	abstract canNavigateToNextPage(): boolean;

	abstract canNavigateToPreviousPage(): boolean;

	abstract navigateToNextPage(): void;

	abstract navigateToPreviousPage(): void;

	abstract navigateToFirstPage(): void;

	abstract navigateToLastPage(): void;

	canNavigateLeft() {
		return this._view.pageProgressionRTL
			? this.canNavigateToNextPage()
			: this.canNavigateToPreviousPage();
	}

	canNavigateRight() {
		return this._view.pageProgressionRTL
			? this.canNavigateToPreviousPage()
			: this.canNavigateToNextPage();
	}

	navigateLeft() {
		if (this._view.pageProgressionRTL) {
			this.navigateToNextPage();
		}
		else {
			this.navigateToPreviousPage();
		}
	}

	navigateRight() {
		if (this._view.pageProgressionRTL) {
			this.navigateToPreviousPage();
		}
		else {
			this.navigateToNextPage();
		}
	}

	// Debounced refresh: runs 200ms after the last view update. Only touches the display
	// cache -- the user anchor (see _refreshUserAnchor) is managed eagerly by navigation
	// methods so that sequential resizes don't compound drift.
	invalidate = debounce(
		() => {
			this._refreshDisplayCache();
			this._onUpdateViewState();
			this._onUpdateViewStats();
			this._pushHistoryPoint();
		},
		200
	);

	protected _refreshDisplayCache(): void {
		this._cachedStartRange = null;
		this._cachedStartSection = null;
		this._updateDisplayCache();
	}

	protected _refreshUserAnchor(): void {
		this._cachedStartCFI = null;
		this._cachedStartCFIOffset = null;
		this._updateUserAnchor();
	}

	protected _refreshUserAnchorAfterScroll = debounce(() => {
		this._refreshUserAnchor();
	}, 100);

	protected _pushHistoryPoint = () => {
		this._onPushHistoryPoint(!this._nextHistoryPushIsFromNavigation);
		this._nextHistoryPushIsFromNavigation = false;
	};

	/** Populate _cachedStartRange and _cachedStartSection from the current layout. */
	protected abstract _updateDisplayCache(): void;

	/** Populate _cachedStartCFI and _cachedStartCFIOffset from the current layout. */
	protected abstract _updateUserAnchor(): void;

	setScale(scale: number) {
		this._scale = scale;
	}

	abstract setSpreadMode(spreadMode: SpreadMode): void;
}

interface Options {
	view: EPUBView;
	iframe: HTMLIFrameElement;
	onUpdateViewState: () => void;
	onUpdateViewStats: () => void;
	onViewUpdate: () => void;
	onPushHistoryPoint: (transient: boolean) => void;
	onManualNavigation: () => void;
}

export class ScrolledFlow extends AbstractFlow {
	static readonly SCROLL_PADDING_UNSCALED = 35;

	constructor(options: Options) {
		super(options);

		this._iframe.classList.add('flow-mode-scrolled');
		this._iframeDocument.body.classList.add('flow-mode-scrolled');
		this._iframeWindow.addEventListener('scroll', this._refreshUserAnchorAfterScroll, { passive: true });

		for (let view of this._view.renderers) {
			view.mount();
		}

		if (isSafari) {
			// Safari doesn't actually make the body scrollable unless we invalidate
			// something or other by manually setting overflowY to auto
			// (This is a Safari bug)
			setTimeout(() => {
				this._iframeDocument.body.style.overflowY = 'auto';
			});
		}
	}

	override destroy(): void {
		super.destroy();
		this._iframe.classList.remove('flow-mode-scrolled');
		this._iframeDocument.body.classList.remove('flow-mode-scrolled');
		this._iframeWindow.removeEventListener('scroll', this._refreshUserAnchorAfterScroll);

		if (isSafari) {
			// Undo our Safari workaround above
			this._iframeDocument.body.style.overflowY = '';
		}
	}

	scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: NavigateOptions): void {
		let rect = (target instanceof PersistentRange ? target.toRange() : target).getBoundingClientRect();

		if (options?.ifNeeded && isPageRectVisible(
			getBoundingPageRect(target),
			this._iframeWindow,
			options.visibilityMargin ?? 0
		)) {
			return;
		}

		if (!options?.skipHistory) {
			this._nextHistoryPushIsFromNavigation = true;
		}

		// Disable smooth scrolling when target is too far away
		if (options?.behavior == 'smooth'
				&& (Math.abs(rect.top + rect.bottom / 2) > this._iframe.clientHeight * 2
					|| Math.abs(rect.left + rect.right / 2) > this._iframe.clientWidth * 2)) {
			options.behavior = 'auto';
		}

		if ('nodeType' in target) {
			target.scrollIntoView(options);
			this._settleAnchorAfterProgrammaticScroll(options);
			this.invalidate();
			return;
		}

		let x = rect.x;
		let y = rect.y;
		if (isVertical(target.startContainer)) {
			if (options && options.block == 'center') {
				x += rect.width / 2;
				x -= this._iframe.clientWidth / 2;
			}
			if (options && options.offsetBlock !== undefined) {
				x -= options.offsetBlock;
			}
		}
		else {
			x += rect.width / 2;
			if (options && options.block == 'center') {
				y += rect.height / 2;
				y -= this._iframe.clientHeight / 2;
			}
			if (options && options.offsetBlock !== undefined) {
				y -= options.offsetBlock;
			}
		}
		this._iframeWindow.scrollBy({
			...options,
			left: x,
			top: y,
		});
		this._settleAnchorAfterProgrammaticScroll(options);
		this.invalidate();
	}

	private _settleAnchorAfterProgrammaticScroll(options?: NavigateOptions) {
		// scroll should have fired before this, so cancel
		// the debounced refresh that triggered
		this._refreshUserAnchorAfterScroll.cancel();
		if (!options?.keepAnchor) {
			this._refreshUserAnchor();
		}
	}

	get scrollPadding() {
		return ScrolledFlow.SCROLL_PADDING_UNSCALED * this._scale;
	}

	canNavigateToPreviousPage() {
		if (this._isVertical) {
			return Math.abs(this._iframeWindow.scrollX) >= this._iframe.clientWidth
				- this.scrollPadding;
		}
		else {
			return this._iframeWindow.scrollY >= this._iframe.clientHeight
				- this.scrollPadding;
		}
	}

	canNavigateToNextPage() {
		if (this._isVertical) {
			return Math.abs(this._iframeWindow.scrollX) <= this._iframeDocument.documentElement.scrollWidth
				- this._iframe.clientWidth * 2
				+ this.scrollPadding;
		}
		else {
			return this._iframeWindow.scrollY <= this._iframeDocument.documentElement.scrollHeight
				- this._iframe.clientHeight * 2
				+ this.scrollPadding;
		}
	}

	navigateToPreviousPage() {
		if (!this.canNavigateToPreviousPage()) {
			return;
		}
		if (this._isVertical) {
			this._iframeWindow.scrollBy({ left: this._iframe.clientWidth + this.scrollPadding });
		}
		else {
			this._iframeWindow.scrollBy({ top: -this._iframe.clientHeight + this.scrollPadding });
		}
		this._onViewUpdate();
	}

	navigateToNextPage() {
		if (!this.canNavigateToNextPage()) {
			return;
		}
		if (this._isVertical) {
			this._iframeWindow.scrollBy({ left: -this._iframe.clientWidth - this.scrollPadding });
		}
		else {
			this._iframeWindow.scrollBy({ top: this._iframe.clientHeight - this.scrollPadding });
		}
		this._onViewUpdate();
	}

	navigateToFirstPage(): void {
		if (this._isVertical) {
			this._iframeWindow.scrollTo({ left: 0 });
		}
		else {
			this._iframeWindow.scrollTo({ top: 0 });
		}
		this._onViewUpdate();
	}

	navigateToLastPage(): void {
		if (this._isVertical) {
			this._iframeWindow.scrollTo({ left: this._iframeDocument.documentElement.scrollWidth });
		}
		else {
			this._iframeWindow.scrollTo({ top: this._iframeDocument.documentElement.scrollHeight });
		}
		this._onViewUpdate();
	}

	private* _visibleRenderers(): Generator<SectionRenderer> {
		let foundVisible = false;
		for (let renderer of this._view.renderers) {
			if (!renderer.mounted) continue;
			let visible = isPageRectVisible(getBoundingPageRect(renderer.container), this._iframeWindow);
			if (foundVisible && !visible) break;
			if (!visible) continue;
			foundVisible = true;
			yield renderer;
		}
	}

	protected _updateDisplayCache(): void {
		for (let renderer of this._visibleRenderers()) {
			this._cachedStartSection = renderer.section;
			let startRange = this._getFirstVisibleRange(renderer, false);
			if (!startRange) continue;
			// Navigating to page N might put us on a line containing the boundary between
			// page N-1 and page N somewhere in its middle. We want the page number field to
			// show N in that case, not N-1. We collapse the range to its end so that, for
			// the purpose of comparing with page number-delineating ranges, it looks like
			// we're scrolled down a little further than we actually are -- to the end of
			// the uppermost element or text node.
			// TODO: Make sure this doesn't break anything involving images / block elements / long text
			startRange.collapse(false);
			this._cachedStartRange = new PersistentRange(startRange);
			break;
		}
	}

	protected _updateUserAnchor(): void {
		for (let renderer of this._visibleRenderers()) {
			let startCFIRange = this._getFirstVisibleRange(renderer, true);
			if (!startCFIRange) continue;
			// CFIs should be calculated based on the start of the range, so collapse to the
			// start. The offset is the Y coord of that point in the viewport, which we use
			// to restore scroll position precisely after a resize.
			startCFIRange.collapse(true);
			this._cachedStartCFI = new EpubCFI(startCFIRange, renderer.section.cfiBase);
			let rect = startCFIRange.getBoundingClientRect();
			this._cachedStartCFIOffset = isVertical(renderer.body) ? rect.left : rect.top;
			break;
		}
	}

	setSpreadMode() {
		// No-op
	}
}

const PAGE_TURN_SWIPE_LENGTH_PX = 100;
const PAGE_TURN_TAP_MARGIN_FRACTION = 0.2;
const EPSILON_PX = 10;

export class PaginatedFlow extends AbstractFlow {
	private _sectionsContainer: HTMLElement;

	private _swipeIndicators: HTMLElement;

	private _touchDown = false;

	private _touchStartX = 0;

	private _touchStartY = 0;

	private _currentSectionIndex!: number;

	private _offsetLeft = 0;

	private _offsetTop = 0;

	constructor(options: Options) {
		super(options);
		this._sectionsContainer = this._iframeDocument.body.querySelector(':scope > .sections') as HTMLElement;
		this._swipeIndicators = this._iframeDocument.querySelector('.swipe-indicators') as HTMLElement;

		this._iframeDocument.documentElement.addEventListener('keydown', this._handleKeyDown, { capture: true });
		this._iframeDocument.documentElement.addEventListener('pointerdown', this._handlePointerDown);
		this._iframeDocument.documentElement.addEventListener('pointermove', this._handlePointerMove);
		this._iframeDocument.documentElement.addEventListener('pointerup', this._handlePointerUp);
		this._iframeDocument.documentElement.addEventListener('pointerout', this._handlePointerCancel);
		this._iframeDocument.documentElement.addEventListener('pointercancel', this._handlePointerCancel);
		this._iframeDocument.documentElement.addEventListener('wheel', this._handleWheel, { passive: false });
		this._iframeDocument.documentElement.addEventListener('selectionchange', this._handleSelectionChange);
		this._iframe.classList.add('flow-mode-paginated');
		this._iframeDocument.body.classList.add('flow-mode-paginated');
	}

	override destroy(): void {
		super.destroy();
		this._iframeDocument.documentElement.removeEventListener('keydown', this._handleKeyDown, { capture: true });
		this._iframeDocument.documentElement.removeEventListener('pointerdown', this._handlePointerDown);
		this._iframeDocument.documentElement.removeEventListener('pointermove', this._handlePointerMove);
		this._iframeDocument.documentElement.removeEventListener('pointerup', this._handlePointerUp);
		this._iframeDocument.documentElement.removeEventListener('pointerout', this._handlePointerCancel);
		this._iframeDocument.documentElement.removeEventListener('pointercancel', this._handlePointerCancel);
		this._iframeDocument.documentElement.removeEventListener('wheel', this._handleWheel);
		this._iframeDocument.documentElement.removeEventListener('selectionchange', this._handleSelectionChange);
		this._iframe.classList.remove('flow-mode-paginated');
		this._iframeDocument.body.classList.remove('flow-mode-paginated');
	}

	private get _spreadWidth(): number {
		return this._sectionsContainer.offsetWidth
			// NaN (fixed-layout, non-columnar book) -> 0
			+ (parseFloat(getComputedStyle(this._sectionsContainer).columnGap) || 0);
	}

	private get _spreadHeight(): number {
		return this._sectionsContainer.offsetHeight
			// NaN (fixed-layout, non-columnar book) -> 0
			+ (parseFloat(getComputedStyle(this._sectionsContainer).columnGap) || 0);
	}

	private _setOffset(left: number, top: number) {
		this._offsetLeft = left;
		this._offsetTop = top;
		this._sectionsContainer.style.left = `${-left}px`;
		this._sectionsContainer.style.top = `${-top}px`;
		this._refreshDisplayCache();
	}

	private _setOffsetToEndOfSection() {
		if (this._isVertical) {
			this._setOffset(
				0,
				Math.max(0, this._sectionsContainer.scrollHeight - this._sectionsContainer.offsetHeight)
			);
		}
		else {
			this._setOffset(
				Math.max(0, this._sectionsContainer.scrollWidth - this._sectionsContainer.offsetWidth),
				0
			);
		}
	}

	get currentSectionIndex(): number {
		return this._currentSectionIndex;
	}

	set currentSectionIndex(index: number) {
		if (index === this._currentSectionIndex) {
			return;
		}
		let oldIndex = this._currentSectionIndex;
		this._currentSectionIndex = index;
		if (oldIndex === undefined) {
			for (let view of this._view.renderers) {
				view.unmount();
			}
		}
		else {
			this._view.renderers[oldIndex].unmount();
		}
		this._view.renderers[index].mount();
		this._setOffset(0, 0);
		this._onViewUpdate();
	}

	scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: NavigateOptions): void {
		let index = EPUBView.getContainingSectionIndex(target);
		if (index === null) {
			return;
		}

		if (!options?.skipHistory) {
			this._nextHistoryPushIsFromNavigation = true;
		}

		this.currentSectionIndex = index;

		if (options?.ifNeeded && isPageRectVisible(
			getBoundingPageRect(target),
			this._iframeWindow,
			options.visibilityMargin ?? 0
		)) {
			return;
		}

		let rect = (target instanceof PersistentRange ? target.toRange() : target).getBoundingClientRect();
		let containerRect = this._sectionsContainer.getBoundingClientRect();
		let internalX = rect.x - containerRect.x;
		let internalY = rect.y - containerRect.y;
		if (options?.block === 'center') {
			if (this._isVertical) {
				internalY += rect.height / 2;
			}
			else {
				internalX += rect.width / 2;
			}
		}
		if (this._isVertical) {
			this._setOffset(
				0,
				Math.max(0, Math.floor(internalY / this._spreadHeight)) * this._spreadHeight
			);
		}
		else {
			this._setOffset(
				Math.max(0, Math.floor(internalX / this._spreadWidth)) * this._spreadWidth,
				0
			);
		}
		if (!options?.keepAnchor) {
			this._refreshUserAnchor();
		}
		this._onViewUpdate();
	}

	canNavigateToPreviousPage(): boolean {
		if (this.canNavigateToPreviousSection()) {
			return true;
		}
		return this._isVertical ? this._offsetTop > 0 : this._offsetLeft > 0;
	}

	canNavigateToNextPage(): boolean {
		if (this.canNavigateToNextSection()) {
			return true;
		}
		return this._isVertical
			? this._offsetTop < this._sectionsContainer.scrollHeight - this._sectionsContainer.offsetHeight
			: this._offsetLeft < this._sectionsContainer.scrollWidth - this._sectionsContainer.offsetWidth;
	}

	atStartOfSection(): boolean {
		return this._isVertical ? this._offsetTop == 0 : this._offsetLeft == 0;
	}

	atEndOfSection(): boolean {
		return this._isVertical
			? this._offsetTop > this._sectionsContainer.scrollHeight - this._sectionsContainer.offsetHeight - this._spreadHeight
			: this._offsetLeft > this._sectionsContainer.scrollWidth - this._sectionsContainer.offsetWidth - this._spreadWidth;
	}

	canNavigateToPreviousSection(): boolean {
		return this.currentSectionIndex > 0;
	}

	canNavigateToNextSection(): boolean {
		return this.currentSectionIndex < this._view.renderers.length - 1;
	}

	navigateToPreviousSection(): void {
		if (this.canNavigateToPreviousSection()) {
			this.currentSectionIndex--;
		}
	}

	navigateToNextSection(): void {
		if (this.canNavigateToNextSection()) {
			this.currentSectionIndex++;
		}
	}

	navigateToPreviousPage(): void {
		if (!this.canNavigateToPreviousPage()) {
			return;
		}
		if (this.atStartOfSection()) {
			this.navigateToPreviousSection();
			this._setOffsetToEndOfSection();
		}
		else if (this._isVertical) {
			this._setOffset(0, this._offsetTop - this._spreadHeight);
		}
		else {
			this._setOffset(this._offsetLeft - this._spreadWidth, 0);
		}
		this._refreshUserAnchor();
		this._onViewUpdate();
	}

	navigateToNextPage(): void {
		if (!this.canNavigateToNextPage()) {
			return;
		}
		if (this.atEndOfSection()) {
			this.navigateToNextSection();
		}
		else if (this._isVertical) {
			this._setOffset(0, this._offsetTop + this._spreadHeight);
		}
		else {
			this._setOffset(this._offsetLeft + this._spreadWidth, 0);
		}
		this._refreshUserAnchor();
		this._onViewUpdate();
	}

	navigateToFirstPage(): void {
		this.currentSectionIndex = this._view.renderers[0].section.index;
		this._setOffset(0, 0);
		this._refreshUserAnchor();
		this._onViewUpdate();
	}

	navigateToLastPage(): void {
		this.currentSectionIndex = this._view.renderers[this._view.renderers.length - 1].section.index;
		this._setOffsetToEndOfSection();
		this._refreshUserAnchor();
		this._onViewUpdate();
	}

	private _handleKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) {
			return;
		}
		let { key, shiftKey } = event;
		// Left/right arrows are handled in EPUBView
		if (!shiftKey) {
			if (key == 'ArrowUp') {
				this._onManualNavigation();
				this.navigateToPreviousPage();
				event.preventDefault();
				return;
			}
			if (key == 'ArrowDown') {
				this._onManualNavigation();
				this.navigateToNextPage();
				event.preventDefault();
				return;
			}
			if (key == 'PageUp') {
				this._onManualNavigation();
				this.navigateToPreviousPage();
				event.preventDefault();
				return;
			}
			if (key == 'PageDown') {
				this._onManualNavigation();
				this.navigateToNextPage();
				event.preventDefault();
				return;
			}
			if (key == 'Home') {
				this._onManualNavigation();
				this.navigateToFirstPage();
				event.preventDefault();
				return;
			}
			if (key == 'End') {
				this._onManualNavigation();
				this.navigateToLastPage();
				event.preventDefault();
				return;
			}
		}
		if (key == ' ') {
			this._onManualNavigation();
			if (shiftKey) {
				this.navigateToPreviousPage();
			}
			else {
				this.navigateToNextPage();
			}
			event.preventDefault();
		}
	};

	private _handlePointerDown = (event: PointerEvent) => {
		if (!event.isPrimary
				|| (event.pointerType !== 'touch' && event.pointerType !== 'pen')
				|| (event.composedPath()[0] as Element).closest('.annotation-container')) {
			return;
		}
		// Safari: Ignore touches near a selection, because Safari still sends pointer events
		// for selection handle drags
		if (isSafari) {
			let selectionRect = getSelectionRanges(this._iframeWindow.getSelection()!)[0]
				?.getBoundingClientRect();
			if (selectionRect && selectionRect.width && selectionRect.height) {
				selectionRect.x -= 40;
				selectionRect.y -= 40;
				selectionRect.width += 80;
				selectionRect.height += 80;
				if (rectContainsPoint(selectionRect, event.clientX, event.clientY)) {
					console.log('Ignoring pointerdown near selection');
					return;
				}
			}
		}

		this._touchDown = true;
		this._touchStartX = event.clientX;
		this._touchStartY = event.clientY;
	};

	private _handlePointerMove = (event: PointerEvent) => {
		if (!this._touchDown
				|| !event.isPrimary
				|| event.buttons % 1 !== 0
				|| !this._iframeDocument.getSelection()!.isCollapsed) {
			return;
		}
		let swipeAmount = (event.clientX - this._touchStartX) / PAGE_TURN_SWIPE_LENGTH_PX;
		// If on the first/last page, clamp the CSS variable so the indicator doesn't expand all the way
		if (swipeAmount < 0 && !this.canNavigateRight()) {
			swipeAmount = Math.max(swipeAmount, -0.6);
		}
		else if (swipeAmount > 0 && !this.canNavigateLeft()) {
			swipeAmount = Math.min(swipeAmount, 0.6);
		}
		this._swipeIndicators.style.setProperty('--swipe-amount', swipeAmount.toString());
	};

	private _handlePointerUp = (event: PointerEvent) => {
		if (!this._touchDown
				|| !event.isPrimary
				// No event.buttons check - "buttons" have now been released
				|| !this._iframeDocument.getSelection()!.isCollapsed) {
			return;
		}
		this._swipeIndicators.style.setProperty('--swipe-amount', '0');
		this._touchDown = false;

		// Switch pages after swiping
		let swipeAmount = (event.clientX - this._touchStartX) / PAGE_TURN_SWIPE_LENGTH_PX;
		if (swipeAmount <= -1) {
			this._onManualNavigation();
			this.navigateRight();
			event.preventDefault();
		}
		else if (swipeAmount >= 1) {
			this._onManualNavigation();
			this.navigateLeft();
			event.preventDefault();
		}
		// If there's no selection, allow single-tap page turns
		else if (this._iframeWindow.getSelection()!.isCollapsed
				&& !this._view.selectedAnnotationIDs.length
				&& Math.abs(event.clientX - this._touchStartX) < EPSILON_PX
				&& Math.abs(event.clientY - this._touchStartY) < EPSILON_PX
				&& !(event.target as Element).closest('a, .clickable-image')) {
			if (event.clientX >= this._iframeWindow.innerWidth * (1 - PAGE_TURN_TAP_MARGIN_FRACTION)) {
				this._onManualNavigation();
				this.navigateRight();
				event.preventDefault();
			}
			else if (event.clientX <= this._iframeWindow.innerWidth * PAGE_TURN_TAP_MARGIN_FRACTION) {
				this._onManualNavigation();
				this.navigateLeft();
				event.preventDefault();
			}
		}
	};

	private _handlePointerCancel = (event: PointerEvent) => {
		if (!this._touchDown
				|| !event.isPrimary) {
			// No event.buttons check - "buttons" have now been released
			return;
		}
		this._touchDown = false;
		this._swipeIndicators.style.setProperty('--swipe-amount', '0');
	};

	private _handleWheel = debounce((event: WheelEvent) => {
		for (let tableParent of closestAll(event.target as Element, 'table, .table-like')) {
			if (tableParent.clientHeight < tableParent.scrollHeight) {
				return;
			}
		}
		this._onManualNavigation();
		if (event.deltaY < 0) {
			this.navigateToPreviousPage();
			event.preventDefault();
		}
		else if (event.deltaY > 0) {
			this.navigateToNextPage();
			event.preventDefault();
		}
	}, 100, { leading: true, trailing: false, maxWait: 400 });

	private _handleSelectionChange = () => {
		this._swipeIndicators.style.setProperty('--swipe-amount', '0');
		this._touchDown = false;
	};

	private* _visibleRenderers(): Generator<SectionRenderer> {
		for (let renderer of this._view.renderers.values()) {
			if (!renderer.mounted) continue;
			// Avoid getBoundingClientRect here -- cheap offsetLeft check is enough, and
			// this runs in the hot path for display/anchor refresh.
			let visible = renderer.container.offsetLeft < this._iframeWindow.scrollX + this._iframe.clientWidth
				&& renderer.container.offsetLeft + renderer.container.offsetWidth >= this._iframeWindow.scrollX;
			if (!visible) continue;
			yield renderer;
		}
	}

	protected _updateDisplayCache(): void {
		for (let renderer of this._visibleRenderers()) {
			this._cachedStartSection = renderer.section;
			let startRange = this._getFirstVisibleRange(renderer, true);
			if (!startRange) continue;
			// Collapse to end so the page label is biased toward the later page when the
			// first visible line straddles a page boundary
			startRange.collapse(false);
			this._cachedStartRange = new PersistentRange(startRange);
			break;
		}
	}

	protected _updateUserAnchor(): void {
		for (let renderer of this._visibleRenderers()) {
			let range = this._getFirstVisibleRange(renderer, true);
			if (!range) continue;
			range.collapse(true);
			this._cachedStartCFI = new EpubCFI(range, renderer.section.cfiBase);
			this._cachedStartCFIOffset = 0;
			break;
		}
	}

	setSpreadMode(spreadMode: SpreadMode) {
		this._sectionsContainer.classList.toggle('spread-mode-none', spreadMode === SpreadMode.None);
		this._sectionsContainer.classList.toggle('spread-mode-odd', spreadMode === SpreadMode.Odd);
	}
}
