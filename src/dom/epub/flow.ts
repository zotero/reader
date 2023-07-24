import SectionView from "./section-view";
import { EpubCFI } from "epubjs";
import { debounce } from "../../common/lib/debounce";
import { CustomScrollIntoViewOptions } from "../common/dom-view";
import PageMapping from "./lib/page-mapping";

export interface Flow {
	readonly startView: SectionView | null;

	readonly startRange: Range | null;

	readonly startCFI: EpubCFI | null;

	readonly startCFIOffsetY: number | null;

	readonly startRangeIsBeforeFirstMapping: boolean;

	readonly endView: SectionView | null;

	readonly visibleViews: SectionView[];

	scrollIntoView(target: Range | HTMLElement, options?: CustomScrollIntoViewOptions): void;

	canNavigateToPreviousPage(): boolean;

	canNavigateToNextPage(): boolean;

	navigateToPreviousPage(): void;

	navigateToNextPage(): void;

	navigateToFirstPage(): void;

	navigateToLastPage(): void;

	invalidate: ReturnType<typeof debounce<() => void>>;

	setScale(scale: number): void;

	destroy(): void;
}

abstract class AbstractFlow implements Flow {
	protected _cachedStartView: SectionView | null = null;

	protected _cachedStartRange: Range | null = null;

	protected _cachedStartCFI: EpubCFI | null = null;

	protected _cachedStartCFIOffsetY: number | null = null;

	protected _cachedEndView: SectionView | null = null;

	protected _sectionViews: SectionView[];

	protected _pageMapping: PageMapping;

	protected _iframe: HTMLIFrameElement;

	protected _iframeWindow: Window & typeof globalThis;

	protected _iframeDocument: Document;

	protected _scale = 1;

	protected _onUpdateViewState: () => void;

	protected _onUpdateViewStats: () => void;

	protected _onViewUpdate: () => void;

	constructor(options: Options) {
		this._sectionViews = options.sectionViews;
		this._pageMapping = options.pageMapping;
		this._iframe = options.iframe;
		this._iframeWindow = options.iframe.contentWindow! as Window & typeof globalThis;
		this._iframeDocument = options.iframe.contentDocument!;
		this._scale = options.scale;
		this._onUpdateViewState = options.onUpdateViewState;
		this._onUpdateViewStats = options.onUpdateViewStats;
		this._onViewUpdate = options.onViewUpdate;
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
		return this._cachedStartRange;
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
		let firstMappedRange = this._pageMapping.firstRange;
		if (!firstMappedRange) {
			return false;
		}
		return this.startRange.compareBoundaryPoints(Range.START_TO_START, firstMappedRange) < 0;
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
		let startIdx = this._sectionViews.indexOf(this._cachedStartView);
		let endIdx = this._sectionViews.indexOf(this._cachedEndView);
		return this._sectionViews.slice(startIdx, endIdx + 1);
	}

	abstract scrollIntoView(target: Range | HTMLElement, options?: CustomScrollIntoViewOptions): void;

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
		50
	);

	protected abstract update(): void;

	setScale(scale: number) {
		this._scale = scale;
	}

	abstract destroy(): void;
}

interface Options {
	sectionViews: SectionView[]
	pageMapping: PageMapping;
	iframe: HTMLIFrameElement;
	scale: number;
	onUpdateViewState: () => void;
	onUpdateViewStats: () => void;
	onViewUpdate: () => void;
}

export class ScrolledFlow extends AbstractFlow {
	scrollIntoView(target: Range | HTMLElement, options?: CustomScrollIntoViewOptions): void {
		let rect = target.getBoundingClientRect();

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

	canNavigateToPreviousPage() {
		return this._iframeWindow.scrollY >= this._iframe.clientHeight;
	}

	canNavigateToNextPage() {
		return this._iframeWindow.scrollY < this._iframeDocument.documentElement.scrollHeight - this._iframe.clientHeight;
	}

	navigateToPreviousPage() {
		if (!this.canNavigateToPreviousPage()) {
			return;
		}
		this._iframeWindow.scrollBy({ top: -this._iframe.clientHeight + 35 * this._scale });
		this._onUpdateViewState();
		this._onUpdateViewStats();
	}

	navigateToNextPage() {
		if (!this.canNavigateToNextPage()) {
			return;
		}
		this._iframeWindow.scrollBy({ top: this._iframe.clientHeight - 35 * this._scale });
		this._onUpdateViewState();
		this._onUpdateViewStats();
	}

	navigateToFirstPage(): void {
		this._iframeWindow.scrollTo({ top: 0 });
	}

	navigateToLastPage(): void {
		this._iframeWindow.scrollTo({ top: this._iframeDocument.documentElement.scrollHeight });
	}

	update() {
		let foundStart = false;
		for (let view of this._sectionViews.values()) {
			let rect = view.container.getBoundingClientRect();
			let visible = rect.top <= this._iframe.clientHeight && rect.bottom >= 0;
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
					this._cachedStartRange = startRange;
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

	destroy(): void {
		// Nothing to do
	}
}

export class PaginatedFlow extends AbstractFlow {
	private _sectionsContainer: HTMLElement;

	private _touchStartID: number | null = null;

	private _touchStartX = 0;

	constructor(options: Options) {
		super(options);
		this._sectionsContainer = this._iframeDocument.body.querySelector(':scope > .sections')! as HTMLElement;
		this._iframeDocument.addEventListener('keydown', this._handleKeyDown, { capture: true });
		this._iframeDocument.body.addEventListener('touchstart', this._handleTouchStart);
		this._iframeDocument.body.addEventListener('touchmove', this._handleTouchMove);
		this._iframeDocument.body.addEventListener('touchend', this._handleTouchEnd);
	}

	scrollIntoView(target: Range | HTMLElement): void {
		let rect = target.getBoundingClientRect();
		let x = rect.x + rect.width / 2 + this._sectionsContainer.scrollLeft;
		let spreadWidth = this._sectionsContainer.offsetWidth + 60;
		this._sectionsContainer.scrollTo({ left: Math.floor(x / spreadWidth) * spreadWidth });
		this._onViewUpdate();
	}

	canNavigateToPreviousPage(): boolean {
		return this._sectionsContainer.scrollLeft > 0;
	}

	canNavigateToNextPage(): boolean {
		return this._sectionsContainer.scrollLeft < this._sectionsContainer.scrollWidth - this._sectionsContainer.offsetWidth;
	}

	navigateToPreviousPage(): void {
		this._sectionsContainer.scrollBy({
			left: -this._sectionsContainer.offsetWidth - 60,
			behavior: 'auto' // TODO 'smooth' once annotation positioning is fixed
		});
		this._onViewUpdate();
	}

	navigateToNextPage(): void {
		this._sectionsContainer.scrollBy({
			left: this._sectionsContainer.offsetWidth + 60,
			behavior: 'auto' // TODO 'smooth' once annotation positioning is fixed
		});
		this._onViewUpdate();
	}

	navigateToFirstPage(): void {
		this._sectionsContainer.scrollTo({ left: 0 });
		this._onViewUpdate();
	}

	navigateToLastPage(): void {
		this._sectionsContainer.scrollTo({ left: this._sectionsContainer.scrollWidth });
		this._onViewUpdate();
	}

	private _handleKeyDown = (event: KeyboardEvent) => {
		let { key } = event;
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
		}
	};

	private _handleTouchStart = (event: TouchEvent) => {
		if (this._touchStartID !== null) {
			return;
		}
		this._touchStartID = event.changedTouches[0].identifier;
		this._touchStartX = event.changedTouches[0].clientX;
	};

	private _handleTouchMove = (event: TouchEvent) => {
		if (this._touchStartID === null) {
			return;
		}
		let touch = Array.from(event.changedTouches).find(touch => touch.identifier === this._touchStartID);
		if (!touch) {
			return;
		}
		event.preventDefault();
		let swipeAmount = (touch.clientX - this._touchStartX) / 100;
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

	private _handleTouchEnd = (event: TouchEvent) => {
		if (this._touchStartID === null) {
			return;
		}
		let touch = Array.from(event.changedTouches).find(touch => touch.identifier === this._touchStartID);
		if (!touch) {
			return;
		}
		event.preventDefault();
		this._iframeDocument.body.classList.remove('swiping');
		this._iframeDocument.documentElement.style.setProperty('--swipe-amount', '0');
		this._touchStartID = null;

		// Switch pages after swiping 100px
		let swipeAmount = (touch.clientX - this._touchStartX) / 100;
		if (swipeAmount <= -1) {
			this.navigateToNextPage();
		}
		if (swipeAmount >= 1) {
			this.navigateToPreviousPage();
		}
	};

	update() {
		let foundStart = false;
		for (let view of this._sectionViews.values()) {
			let rect = view.container.getBoundingClientRect();
			let visible = rect.left <= this._iframe.clientWidth && rect.right >= 0;
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
					this._cachedStartRange = startRange;
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

	destroy(): void {
		this._iframeDocument.body.removeEventListener('touchstart', this._handleTouchStart);
		this._iframeDocument.body.removeEventListener('touchmove', this._handleTouchMove);
		this._iframeDocument.body.removeEventListener('touchend', this._handleTouchEnd);
	}
}
