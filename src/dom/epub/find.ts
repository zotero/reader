import DefaultFindProcessor, {
	FindAnnotation,
	FindProcessor,
	FindResult
} from "../common/find";
import EPUBView from "./epub-view";
import SectionView from "./section-view";
import { FindState } from "../../common/types";

export class EPUBFindProcessor implements FindProcessor {
	readonly view: EPUBView;

	readonly findState: FindState;

	private _processors: DefaultFindProcessor[] = [];

	private _selectedProcessor: DefaultFindProcessor | null = null;

	private _totalResults = 0;

	private readonly _onSetFindState?: (state?: FindState) => void;

	constructor(options: {
		view: EPUBView,
		startRange: Range,
		findState: FindState,
		onSetFindState?: (state?: FindState) => void,
	}) {
		this.view = options.view;
		this.findState = options.findState;
		this._onSetFindState = options.onSetFindState;

		// Process visible views first, and then the rest of the views if we haven't exceeded 999 results yet
		this._processViews(this.view.flow.visibleViews, options.startRange);
		this._processViews(this.view.views, undefined, 999);
	}

	prev(): FindResult | null {
		if (this._selectedProcessor) {
			this._selectedProcessor.prev(false);
			this._setFindState();
			if (this._selectedProcessor.current) {
				return this._selectedProcessor.current;
			}
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) - 1 : -1;
		if (nextIndex < 0) {
			nextIndex += this.view.views.length;
		}
		this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		let stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
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
			this._setFindState();
			if (this._selectedProcessor.current) {
				return this._selectedProcessor.current;
			}
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) + 1 : 0;
		nextIndex %= this.view.views.length;
		if (this._selectedProcessor) this._selectedProcessor.position = null;
		this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		let stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				let result = this._selectedProcessor.next(false);
				this._setFindState();
				return result;
			}

			nextIndex++;
			nextIndex %= this.view.views.length;
			this._selectedProcessor = this._getOrCreateProcessor(this.view.views[nextIndex]);
		}
		while (this._selectedProcessor !== stop);

		return null;
	}

	getAnnotations(): FindAnnotation[] {
		let highlights = [];
		for (let [i, processor] of this._processors.entries()) {
			if (!processor || !this.view.views[i]?.mounted) continue;
			processor.findState.highlightAll = this.findState.highlightAll;
			for (let highlight of processor.getAnnotations()) {
				highlights.push(highlight);
			}
		}
		return highlights;
	}

	handleViewUpdate() {
		this._processViews(this.view.flow.visibleViews);
	}

	private _processViews(views: SectionView[], startRange?: Range, maxResults?: number) {
		for (let view of views) {
			if (maxResults !== undefined && this._totalResults > maxResults) {
				break;
			}
			this._getOrCreateProcessor(view, startRange);
		}
	}

	private _getOrCreateProcessor(view: SectionView, startRange?: Range): DefaultFindProcessor {
		if (this._processors[view.section.index]) {
			return this._processors[view.section.index];
		}
		let processor = new DefaultFindProcessor({
			searchContext: view.searchContext,
			startRange,
			findState: { ...this.findState },
			annotationKeyPrefix: 'section' + view.section.index,
		});
		this._processors[view.section.index] = processor;
		if (!this._selectedProcessor && processor.initialPosition !== null) {
			this._selectedProcessor = processor;
		}
		this._totalResults += processor.getResults().length;
		this._setFindState();
		return processor;
	}

	private _setFindState() {
		if (this._onSetFindState) {
			let index = 0;
			let foundSelected = false;
			let snippets = [];
			for (let processor of this._processors) {
				if (!processor) {
					continue;
				}
				if (this._selectedProcessor == processor) {
					index += processor.position ?? 0;
					foundSelected = true;
				}
				else if (!foundSelected) {
					index += processor.getResults().length;
				}
				snippets.push(...processor.getSnippets());
			}
			this._onSetFindState({
				...this.findState,
				result: {
					total: this._totalResults,
					index,
					snippets,
				}
			});
		}
	}
}
