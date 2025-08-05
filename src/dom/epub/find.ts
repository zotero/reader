import DefaultFindProcessor, {
	FindAnnotation,
	FindProcessor,
	FindResult, ResultArg
} from "../common/lib/find";
import EPUBView from "./epub-view";
import SectionRenderer from "./section-renderer";
import { FindState } from "../../common/types";
import { PersistentRange } from "../common/lib/range";

export class EPUBFindProcessor implements FindProcessor {
	readonly view: EPUBView;

	readonly findState: FindState;

	private _processors: DefaultFindProcessor[] = [];

	private _processorPromises: Promise<DefaultFindProcessor>[] = [];

	private _selectedProcessor: DefaultFindProcessor | null = null;

	private _totalResults = 0;

	private _cancelled = false;

	private readonly _onSetFindState?: (result: ResultArg) => void;

	constructor(options: {
		view: EPUBView,
		findState: FindState,
		onSetFindState?: (result: ResultArg) => void,
	}) {
		this.view = options.view;
		this.findState = options.findState;
		this._onSetFindState = options.onSetFindState;
	}

	async run(startRange?: Range | PersistentRange, onFirstResult?: () => void) {
		this._cancelled = false;
		let startIndex = this.view.flow.startSection?.index
			?? 0;
		for (let i = startIndex; i < startIndex + this.view.renderers.length; i++) {
			let view = this.view.renderers[i % this.view.renderers.length];
			let processor = await this._getOrCreateProcessor(
				view,
				this._selectedProcessor ? undefined : startRange
			);
			if (this._cancelled) return;
			if (this._selectedProcessor === processor) {
				onFirstResult?.();
			}
		}
	}

	cancel() {
		for (let processor of this._processors) {
			processor?.cancel();
		}
		this._cancelled = true;
	}

	async prev(): Promise<FindResult | null> {
		if (this._selectedProcessor) {
			if (this._selectedProcessor.prev(false)) {
				this.updateFindState();
				return this._selectedProcessor.current;
			}
			this.updateFindState();
			this._selectedProcessor.position = null;
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) - 1 : -1;
		if (nextIndex < 0) {
			nextIndex += this.view.renderers.length;
		}
		this._selectedProcessor = await this._getOrCreateProcessor(this.view.renderers[nextIndex]);
		this._selectedProcessor.position = null;
		let stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				let result = this._selectedProcessor.prev(false);
				this.updateFindState();
				return result;
			}

			nextIndex--;
			if (nextIndex < 0) {
				nextIndex += this.view.renderers.length;
			}
			this._selectedProcessor = await this._getOrCreateProcessor(this.view.renderers[nextIndex]);
		}
		while (this._selectedProcessor !== stop);

		return null;
	}

	async next(): Promise<FindResult | null> {
		if (this._selectedProcessor) {
			if (this._selectedProcessor.next(false)) {
				this.updateFindState();
				return this._selectedProcessor.current;
			}
			this.updateFindState();
			this._selectedProcessor.position = null;
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) + 1 : 0;
		nextIndex %= this.view.renderers.length;
		this._selectedProcessor = await this._getOrCreateProcessor(this.view.renderers[nextIndex]);
		this._selectedProcessor.position = null;
		let stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				let result = this._selectedProcessor.next(false);
				this.updateFindState();
				return result;
			}

			nextIndex++;
			nextIndex %= this.view.renderers.length;
			this._selectedProcessor = await this._getOrCreateProcessor(this.view.renderers[nextIndex]);
		}
		while (this._selectedProcessor !== stop);

		return null;
	}

	async setPosition(index: number) {
		let result: FindResult | null = null;
		let currentIndex = 0;
		for (let processorPromise of this._processorPromises) {
			let processor = await processorPromise;
			let found = false;
			for (let [i, currentResult] of processor.getResults().entries()) {
				if (currentIndex == index) {
					processor.position = i;
					result = currentResult;
					found = true;
				}
				currentIndex++;
			}
			if (!found) {
				processor.position = null;
			}
		}
		return result;
	}

	getAnnotations(): FindAnnotation[] {
		let highlights = [];
		for (let [i, processor] of this._processors.entries()) {
			if (!processor || !this.view.renderers[i]?.mounted) continue;
			processor.findState.highlightAll = this.findState.highlightAll;
			for (let highlight of processor.getAnnotations()) {
				highlights.push(highlight);
			}
		}
		return highlights;
	}

	private _getOrCreateProcessor(renderer: SectionRenderer, startRange?: Range | PersistentRange): Promise<DefaultFindProcessor> {
		let index = renderer.section.index;
		if (this._processorPromises[index] !== undefined) {
			return this._processorPromises[index];
		}
		return this._processorPromises[index] = (async () => {
			if (this._processors[index] !== undefined) {
				return this._processors[index];
			}
			let processor = new DefaultFindProcessor({
				findState: this.findState,
				annotationKeyPrefix: 'section' + index,
			});
			await processor.run(
				renderer.searchContext,
				startRange
			);
			this._processors[index] = processor;
			if (!this._selectedProcessor && processor.initialPosition !== null) {
				this._selectedProcessor = processor;
			}
			this._totalResults += processor.getResults().length;
			this.updateFindState();
			return processor;
		})();
	}

	updateFindState() {
		if (this._cancelled) return;
		if (this._onSetFindState) {
			let index = 0;
			let foundSelected = false;
			let snippets = [];
			let range: PersistentRange | undefined;
			for (let processor of this._processors) {
				if (!processor) {
					continue;
				}
				if (this._selectedProcessor) {
					if (this._selectedProcessor == processor) {
						let position = processor.position ?? 0;
						index += position;
						foundSelected = true;
						// TODO: Expose this in a nicer way
						range = processor.getAnnotations()[position]?.range;
					}
					else if (!foundSelected) {
						index += processor.getResults().length;
					}
				}
				snippets.push(...processor.getSnippets());
			}
			this._onSetFindState({
				total: this._totalResults,
				index,
				snippets,
				range,
			});
		}
	}
}
