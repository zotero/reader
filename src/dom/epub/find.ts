import DefaultFindProcessor, {
	FindProcessor,
	FindResult
} from "../common/find";
import { DisplayedAnnotation } from "../common/components/overlay/annotation-overlay";
import EPUBView from "./epub-view";
import SectionView from "./section-view";

export class EPUBFindProcessor implements FindProcessor {
	readonly view: EPUBView;

	readonly query: string;

	highlightAll: boolean;

	readonly caseSensitive: boolean;

	readonly entireWord: boolean;
	
	private _processors: DefaultFindProcessor[] = [];
	
	private _selectedProcessor: DefaultFindProcessor | null = null;

	constructor(options: {
		view: EPUBView,
		startRange: Range,
		query: string,
		highlightAll: boolean,
		caseSensitive: boolean,
		entireWord: boolean
	}) {
		this.view = options.view;
		this.query = options.query;
		this.highlightAll = options.highlightAll;
		this.caseSensitive = options.caseSensitive;
		this.entireWord = options.entireWord;

		this._processViews(this.view.visibleViews, options.startRange);
	}

	prev(): FindResult | null {
		if (this._selectedProcessor) {
			this._selectedProcessor.prev(false);
			if (this._selectedProcessor.current) {
				return this._selectedProcessor.current;
			}
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) - 1 : -1;
		if (nextIndex < 0) {
			nextIndex += this.view.views.length;
		}
		this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		const stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				this._selectedProcessor.reset(true);
				return this._selectedProcessor.prev(false);
			}
			
			nextIndex--;
			if (nextIndex < 0) {
				nextIndex += this.view.views.length;
			}
			this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		}
		while (this._selectedProcessor !== stop);
		
		return null;
	}

	next(): FindResult | null {
		if (this._selectedProcessor) {
			this._selectedProcessor.next(false);
			if (this._selectedProcessor.current) {
				return this._selectedProcessor.current;
			}
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) + 1 : 0;
		nextIndex %= this.view.views.length;
		this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		const stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				this._selectedProcessor.reset(false);
				return this._selectedProcessor.next(false);
			}

			nextIndex++;
			nextIndex %= this.view.views.length;
			this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		}
		while (this._selectedProcessor !== stop);

		return null;
	}

	getAnnotations(): DisplayedAnnotation[] {
		const highlights = [];
		for (const processor of this._processors.values()) {
			if (!processor) continue;
			processor.highlightAll = this.highlightAll;
			for (const highlight of processor.getAnnotations()) {
				highlights.push(highlight);
			}
		}
		return highlights;
	}

	onScroll() {
		this._processViews(this.view.visibleViews);
	}

	_processViews(views: SectionView[], startRange?: Range | undefined) {
		for (const view of views) {
			this._getOrCreateProcessor(view, startRange);
		}
	}

	private _getOrCreateProcessor(view: SectionView, startRange?: Range): DefaultFindProcessor {
		if (this._processors[view.section.index]) {
			return this._processors[view.section.index];
		}
		const processor = new DefaultFindProcessor({
			container: view.container,
			startRange,
			query: this.query,
			highlightAll: this.highlightAll,
			caseSensitive: this.caseSensitive,
			entireWord: this.entireWord,
		});
		this._processors[view.section.index] = processor;
		if (processor.current) {
			this._selectedProcessor = processor;
		}
		return processor;
	}
}
