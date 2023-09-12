import SectionView from "./section-view";
import { EpubCFI } from "epubjs";
import { debounce } from "../../common/lib/debounce";
import { CustomScrollIntoViewOptions } from "../common/dom-view";
import { closestElement } from "../common/lib/nodes";
import EPUBView, { SpreadMode } from "./epub-view";
import { PersistentRange } from "../common/lib/range";

export interface Flow {
	readonly startView: SectionView | null;

	readonly startRange: Range | null;

	readonly startCFI: EpubCFI | null;

	readonly startCFIOffsetY: number | null;

	readonly startRangeIsBeforeFirstMapping: boolean;

	readonly endView: SectionView | null;

	readonly visibleViews: SectionView[];

	scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: CustomScrollIntoViewOptions): void;

	canNavigateToPreviousPage(): boolean;

	canNavigateToNextPage(): boolean;

	navigateToPreviousPage(): void;

	navigateToNextPage(): void;

	navigateToFirstPage(): void;

	navigateToLastPage(): void;

	invalidate: ReturnType<typeof debounce<() => void>>;

	setScale(scale: number): void;

	setSpreadMode(spreadMode: SpreadMode): void;

	destroy(): void;
}

abstract class AbstractFlow implements Flow {
	protected _view: EPUBView;

	protected _cachedStartView: SectionView | null = null;

	protected _cachedStartRange: PersistentRange | null = null;

	protected _cachedStartCFI: EpubCFI | null = null;

	protected _cachedStartCFIOffsetY: number | null = null;

	protected _cachedEndView: SectionView | null = null;

	protected _iframe: HTMLIFrameElement;

	protected _iframeWindow: Window & typeof globalThis;

	protected _iframeDocument: Document;

	protected _scale = 1;

	protected _onUpdateViewState: () => void;

	protected _onUpdateViewStats: () => void;

	protected _onViewUpdate: () => void;

	protected constructor(options: Options) {
		this._view = options.view;
		this._iframe = options.iframe;
		this._iframeWindow = options.iframe.contentWindow! as Window & typeof globalThis;
		this._iframeDocument = options.iframe.contentDocument!;
		this._scale = options.view.scale;
		this._onUpdateViewState = options.onUpdateViewState;
		this._onUpdateViewStats = options.onUpdateViewStats;
		this._onViewUpdate = options.onViewUpdate;

		let intersectionObserver = new IntersectionObserver(() => this.invalidate(), {
			threshold: [0, 1]
		});
		for (let range of this._view.pageMapping.tree.keys()) {
			let elem = closestElement(range.startContainer);
			if (elem) {
				intersectionObserver.observe(elem);
			}
		}
	}

	get startView(): SectionView | null {
		if (!this._cachedStartView) {
			this.update();
		}
		return this._cachedStartView;
	}

	get startRange(): Range | null {
		if (!this._cachedStartRange) {
			this.update();
		}
		return this._cachedStartRange?.toRange() ?? null;
	}

	get startCFI(): EpubCFI | null {
		if (!this._cachedStartCFI) {
			this.update();
		}
		return this._cachedStartCFI;
	}

	get startCFIOffsetY(): number | null {
		if (this._cachedStartCFIOffsetY === null) {
			this.update();
		}
		return this._cachedStartCFIOffsetY;
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

	get endView(): SectionView | null {
		if (!this._cachedEndView) {
			this.update();
		}
		return this._cachedEndView;
	}

	get visibleViews(): SectionView[] {
		if (!this._cachedStartView || !this._cachedEndView) {
			this.update();
		}
		if (!this._cachedStartView || !this._cachedEndView) {
			return [];
		}
		let startIdx = this._view.views.indexOf(this._cachedStartView);
		let endIdx = this._view.views.indexOf(this._cachedEndView);
		return this._view.views.slice(startIdx, endIdx + 1);
	}

	abstract scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: CustomScrollIntoViewOptions): void;

	abstract canNavigateToNextPage(): boolean;

	abstract canNavigateToPreviousPage(): boolean;

	abstract navigateToNextPage(): void;

	abstract navigateToPreviousPage(): void;

	abstract navigateToFirstPage(): void;

	abstract navigateToLastPage(): void;

	invalidate = debounce(
		() => {
			this._cachedStartRange = null;
			this._cachedStartCFIOffsetY = null;
			this._cachedStartCFI = null;
			this.update();
			this._onUpdateViewState();
			this._onUpdateViewStats();
		},
		200
	);

	protected abstract update(): void;

	setScale(scale: number) {
		this._scale = scale;
	}

	abstract setSpreadMode(spreadMode: SpreadMode): void;

	abstract destroy(): void;
}

interface Options {
	view: EPUBView;
	iframe: HTMLIFrameElement;
	onUpdateViewState: () => void;
	onUpdateViewStats: () => void;
	onViewUpdate: () => void;
}

export class ScrolledFlow extends AbstractFlow {
	static readonly SCROLL_PADDING_UNSCALED = 35;

	constructor(options: Options) {
		super(options);

		this._iframe.classList.add('flow-mode-scrolled');
		this._iframeDocument.body.classList.add('flow-mode-scrolled');

		for (let view of this._view.views) {
			view.mount();
		}
	}

	destroy(): void {
		this._iframe.classList.remove('flow-mode-scrolled');
		this._iframeDocument.body.classList.remove('flow-mode-scrolled');
	}

	scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: CustomScrollIntoViewOptions): void {
		let rect = (target instanceof PersistentRange ? target.toRange() : target).getBoundingClientRect();

		if (options?.ifNeeded && (rect.top >= 0 && rect.bottom < this._iframe.clientHeight)) {
			return;
		}

		// Disable smooth scrolling when target is too far away
		if (options?.behavior == 'smooth'
				&& Math.abs(rect.top + rect.bottom / 2) > this._iframe.clientHeight * 2) {
			options.behavior = 'auto';
		}

		if ('nodeType' in target) {
			target.scrollIntoView(options);
			this.invalidate();
			return;
		}

		let x = rect.x + rect.width / 2;
		let y = rect.y;
		if (options && options.block == 'center') {
			y += rect.height / 2;
			y -= this._iframe.clientHeight / 2;
		}
		if (options && options.offsetY !== undefined) {
			y -= options.offsetY;
		}
		this._iframeWindow.scrollBy({
			...options,
			left: x,
			top: y,
		});
		this.invalidate();
	}

	get scrollPadding() {
		return ScrolledFlow.SCROLL_PADDING_UNSCALED * this._scale;
	}

	canNavigateToPreviousPage() {
		return this._iframeWindow.scrollY >= this._iframe.clientHeight
			- this.scrollPadding;
	}

	canNavigateToNextPage() {
		return this._iframeWindow.scrollY <= this._iframeDocument.documentElement.scrollHeight
			- this._iframe.clientHeight * 2
			+ this.scrollPadding;
	}

	navigateToPreviousPage() {
		if (!this.canNavigateToPreviousPage()) {
			return;
		}
		this._iframeWindow.scrollBy({ top: -this._iframe.clientHeight + this.scrollPadding });
		this._onViewUpdate();
	}

	navigateToNextPage() {
		if (!this.canNavigateToNextPage()) {
			return;
		}
		this._iframeWindow.scrollBy({ top: this._iframe.clientHeight - this.scrollPadding });
		this._onViewUpdate();
	}

	navigateToFirstPage(): void {
		this._iframeWindow.scrollTo({ top: 0 });
		this._onViewUpdate();
	}

	navigateToLastPage(): void {
		this._iframeWindow.scrollTo({ top: this._iframeDocument.documentElement.scrollHeight });
		this._onViewUpdate();
	}

	update() {
		let foundStart = false;
		for (let view of this._view.views) {
			if (!view.mounted) {
				continue;
			}
			// Avoid calling getBoundingClientRect() because that would force a layout, which is expensive
			let visible = view.container.offsetTop < this._iframeWindow.scrollY + this._iframe.clientHeight
				&& view.container.offsetTop + view.container.offsetHeight >= this._iframeWindow.scrollY;
			if (!foundStart) {
				if (!visible) {
					continue;
				}
				this._cachedStartView = view;
				let startRange = view.getFirstVisibleRange(
					false,
					false
				);
				let startCFIRange = view.getFirstVisibleRange(
					false,
					true
				);
				if (startRange) {
					// Navigating to page N might put us on a line containing the boundary between page N-1 and page N
					// somewhere in its middle. We want the page number field to show N in that case, not N-1.
					// We collapse the range to its end so that, for the purpose of comparing with page
					// number-delineating ranges, it looks like we're scrolled down a little further than we actually
					// are - to the end of the uppermost element or text node.
					// TODO: Make sure this doesn't break anything involving images / block elements / long text
					startRange.collapse(false);
					this._cachedStartRange = new PersistentRange(startRange);
				}
				if (startCFIRange) {
					// But CFIs should be calculated based on the start of the range, so collapse to the start
					startCFIRange.collapse(true);
					this._cachedStartCFI = new EpubCFI(startCFIRange, view.section.cfiBase);
					this._cachedStartCFIOffsetY = startCFIRange.getBoundingClientRect().top;
				}
				if (startRange && startCFIRange) {
					foundStart = true;
				}
			}
			else if (!visible) {
				this._cachedEndView = view;
				break;
			}
		}
	}

	setSpreadMode() {
		// No-op
	}
}

export class PaginatedFlow extends AbstractFlow {
	private _sectionsContainer: HTMLElement;

	private _touchStartID: number | null = null;

	private _touchStartX = 0;

	private _currentSectionIndex!: number;

	constructor(options: Options) {
		super(options);
		this._sectionsContainer = this._iframeDocument.body.querySelector(':scope > .sections')! as HTMLElement;

		this._iframeDocument.addEventListener('keydown', this._handleKeyDown, { capture: true });
		this._iframeDocument.addEventListener('pointerdown', this._handlePointerDown);
		this._iframeDocument.addEventListener('pointermove', this._handlePointerMove);
		this._iframeDocument.addEventListener('pointerup', this._handlePointerUp);
		this._iframeDocument.addEventListener('wheel', this._handleWheel, { passive: false });
		this._iframe.classList.add('flow-mode-paginated');
		this._iframeDocument.body.classList.add('flow-mode-paginated');
	}

	destroy(): void {
		this._iframeDocument.removeEventListener('keydown', this._handleKeyDown, { capture: true });
		this._iframeDocument.removeEventListener('pointerdown', this._handlePointerDown);
		this._iframeDocument.removeEventListener('pointermove', this._handlePointerMove);
		this._iframeDocument.removeEventListener('pointerup', this._handlePointerUp);
		this._iframeDocument.removeEventListener('wheel', this._handleWheel);
		this._iframe.classList.remove('flow-mode-paginated');
		this._iframeDocument.body.classList.remove('flow-mode-paginated');
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
		this._sectionsContainer.scrollTo({ left: 0, top: 0 });
		if (oldIndex === undefined) {
			for (let view of this._view.views) {
				view.unmount();
			}
		}
		else {
			this._view.views[oldIndex].unmount();
		}

		let view = this._view.views[index];
		view.mount();
		this._onViewUpdate();
	}

	scrollIntoView(target: Range | PersistentRange | HTMLElement, options?: CustomScrollIntoViewOptions): void {
		let index = EPUBView.getContainingSectionIndex(target);
		if (index === null) {
			return;
		}
		this.currentSectionIndex = index;
		// Otherwise, center the target horizontally
		let rect = (target instanceof PersistentRange ? target.toRange() : target).getBoundingClientRect();
		let x = rect.x + this._sectionsContainer.scrollLeft;
		if (options?.block === 'center') {
			x += rect.width / 2;
		}
		let gap = parseFloat(getComputedStyle(this._sectionsContainer).columnGap);
		let spreadWidth = this._sectionsContainer.offsetWidth + gap;
		this._sectionsContainer.scrollTo({
			left: Math.floor(x / spreadWidth) * spreadWidth,
			top: 0
		});
		this._onViewUpdate();
	}

	canNavigateToPreviousPage(): boolean {
		if (this.canNavigateToPreviousSection()) {
			return true;
		}
		return this._sectionsContainer.scrollLeft > 0;
	}

	canNavigateToNextPage(): boolean {
		if (this.canNavigateToNextSection()) {
			return true;
		}
		return this._sectionsContainer.scrollLeft < this._sectionsContainer.scrollWidth - this._sectionsContainer.offsetWidth;
	}

	atStartOfSection(): boolean {
		return this._sectionsContainer.scrollLeft == 0;
	}

	atEndOfSection(): boolean {
		return this._sectionsContainer.scrollLeft == this._sectionsContainer.scrollWidth - this._sectionsContainer.offsetWidth;
	}

	canNavigateToPreviousSection(): boolean {
		return this.currentSectionIndex > 0;
	}

	canNavigateToNextSection(): boolean {
		return this.currentSectionIndex < this._view.views.length - 1;
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
		if (this.atStartOfSection()) {
			this.navigateToPreviousSection();
			this._sectionsContainer.scrollTo({ left: this._sectionsContainer.scrollWidth, top: 0 });
			this._onViewUpdate();
			return;
		}
		let gap = parseFloat(getComputedStyle(this._sectionsContainer).columnGap);
		this._sectionsContainer.scrollBy({
			left: -this._sectionsContainer.offsetWidth - gap,
			behavior: 'auto' // TODO 'smooth' once annotation positioning is fixed
		});
		this._onViewUpdate();
	}

	navigateToNextPage(): void {
		if (this.atEndOfSection()) {
			this.navigateToNextSection();
			return;
		}
		let gap = parseFloat(getComputedStyle(this._sectionsContainer).columnGap);
		this._sectionsContainer.scrollBy({
			left: this._sectionsContainer.offsetWidth + gap,
			behavior: 'auto' // TODO 'smooth' once annotation positioning is fixed
		});
		this._onViewUpdate();
	}

	navigateToFirstPage(): void {
		this.currentSectionIndex = this._view.views[0].section.index;
		this._sectionsContainer.scrollTo({ left: 0, top: 0 });
		this._onViewUpdate();
	}

	navigateToLastPage(): void {
		this.currentSectionIndex = this._view.views[this._view.views.length - 1].section.index;
		this._sectionsContainer.scrollTo({ left: this._sectionsContainer.scrollWidth, top: 0 });
		this._onViewUpdate();
	}

	private _handleKeyDown = (event: KeyboardEvent) => {
		let { key, shiftKey } = event;
		// Left/right arrows are handled in EPUBView
		if (!shiftKey) {
			if (key == 'ArrowUp') {
				this.navigateToPreviousPage();
				event.preventDefault();
				return;
			}
			if (key == 'ArrowDown') {
				this.navigateToNextPage();
				event.preventDefault();
				return;
			}
			if (key == 'PageUp') {
				this.navigateToPreviousPage();
				event.preventDefault();
				return;
			}
			if (key == 'PageDown') {
				this.navigateToNextPage();
				event.preventDefault();
				return;
			}
			if (key == 'Home') {
				this.navigateToFirstPage();
				event.preventDefault();
				return;
			}
			if (key == 'End') {
				this.navigateToLastPage();
				event.preventDefault();
				return;
			}
		}
		if (key == ' ') {
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
		if (this._touchStartID !== null || event.pointerType !== 'touch') {
			return;
		}
		this._touchStartID = event.pointerId;
		this._touchStartX = event.clientX;
	};

	private _handlePointerMove = (event: PointerEvent) => {
		if (this._touchStartID === null || event.pointerId !== this._touchStartID) {
			return;
		}
		let swipeAmount = (event.clientX - this._touchStartX) / 100;
		// If on the first/last page, clamp the CSS variable so the indicator doesn't expand all the way
		if (swipeAmount < 0 && !this.canNavigateToNextPage()) {
			swipeAmount = Math.max(swipeAmount, -0.6);
		}
		else if (swipeAmount > 0 && !this.canNavigateToPreviousPage()) {
			swipeAmount = Math.min(swipeAmount, 0.6);
		}
		this._iframeDocument.body.classList.add('swiping');
		this._iframeDocument.documentElement.style.setProperty('--swipe-amount', swipeAmount.toString());
	};

	private _handlePointerUp = (event: PointerEvent) => {
		if (this._touchStartID === null || event.pointerId !== this._touchStartID) {
			return;
		}
		event.preventDefault();
		this._iframeDocument.body.classList.remove('swiping');
		this._iframeDocument.documentElement.style.setProperty('--swipe-amount', '0');
		this._touchStartID = null;

		// Switch pages after swiping 100px
		let swipeAmount = (event.clientX - this._touchStartX) / 100;
		if (swipeAmount <= -1) {
			this.navigateToNextPage();
		}
		if (swipeAmount >= 1) {
			this.navigateToPreviousPage();
		}
	};

	private _handleWheel = debounce((event: WheelEvent) => {
		let tableParent = (event.target as Element).closest('table, .table-like');
		if (tableParent && tableParent.clientHeight < tableParent.scrollHeight) {
			return;
		}
		if (event.deltaY < 0) {
			this.navigateToPreviousPage();
			event.preventDefault();
		}
		else if (event.deltaY > 0) {
			this.navigateToNextPage();
			event.preventDefault();
		}
	}, 100);

	update() {
		let foundStart = false;
		for (let view of this._view.views.values()) {
			if (!view.mounted) {
				continue;
			}
			// Avoid calling getBoundingClientRect() because that would force a layout, which is expensive
			let visible = view.container.offsetLeft < this._iframeWindow.scrollX + this._iframe.clientWidth
				&& view.container.offsetLeft + view.container.offsetWidth >= this._iframeWindow.scrollX;
			if (!foundStart) {
				if (!visible) {
					continue;
				}
				this._cachedStartView = view;
				let startRange = view.getFirstVisibleRange(
					true,
					false
				);
				let startCFIRange = view.getFirstVisibleRange(
					true,
					true
				);
				if (startRange) {
					startRange.collapse(true);
					this._cachedStartRange = new PersistentRange(startRange);
				}
				if (startCFIRange) {
					startCFIRange.collapse(true);
					this._cachedStartCFI = new EpubCFI(startCFIRange, view.section.cfiBase);
					this._cachedStartCFIOffsetY = 0;
				}
				if (startRange && startCFIRange) {
					foundStart = true;
				}
			}
			else if (!visible) {
				this._cachedEndView = view;
				break;
			}
		}
	}

	setSpreadMode(spreadMode: SpreadMode) {
		this._sectionsContainer.classList.toggle('spread-mode-none', spreadMode === SpreadMode.None);
		this._sectionsContainer.classList.toggle('spread-mode-odd', spreadMode === SpreadMode.Odd);
	}
}
