import { DisplayedAnnotation } from "./components/overlay/annotation-overlay";
import { executeSearch } from "./lib/dom-text-search";
import { getAllTextNodes } from "./lib/nodes";

export interface FindProcessor {
	getAnnotations(): DisplayedAnnotation[];

	prev(): FindResult | null;

	next(): FindResult | null;
}

class DefaultFindProcessor implements FindProcessor {
	readonly query: string;

	highlightAll: boolean;

	readonly caseSensitive: boolean;

	readonly entireWord: boolean;

	private readonly _buf: FindResult[];

	private _pos = -1;

	constructor(options: {
		container: Element,
		startRange?: Range,
		query: string,
		highlightAll: boolean,
		caseSensitive: boolean,
		entireWord: boolean
	}) {
		this.query = options.query;
		this.highlightAll = options.highlightAll;
		this.caseSensitive = options.caseSensitive;
		this.entireWord = options.entireWord;
		
		this._buf = [];
		
		this._run(options.container, options.startRange);
	}

	private _run(container: Element, startRange?: Range) {
		const ranges = executeSearch(
			getAllTextNodes(container),
			this.query,
			{
				caseSensitive: this.caseSensitive,
				entireWord: this.entireWord
			}
		);
		for (const range of ranges) {
			const result: FindResult = {
				range,
				highlight: {
					type: 'highlight',
					color: 'rgba(180, 0, 170, 1)',
					text: '',
					hasComment: false,
					range,
				}
			};
			if (this._pos == -1 && startRange) {
				if (range.compareBoundaryPoints(Range.START_TO_START, startRange) >= 0) {
					this._pos = this._buf.length;
				}
			}
			this._buf.push(result);
		}
	}
	
	prev(loop = true): FindResult | null {
		this._pos--;
		if (loop) {
			this._pos %= this._buf.length;
			if (this._pos < 0) {
				this._pos = this._buf.length - 1;
			}
		}
		return this.current;
	}
	
	next(loop = true): FindResult | null {
		this._pos++;
		if (loop) {
			this._pos %= this._buf.length;
		}
		return this.current;
	}
	
	reset(toEnd: boolean) {
		this._pos = toEnd ? this._buf.length : -1;
	}
	
	get current(): FindResult | null {
		if (this._pos < 0 || this._pos >= this._buf.length) {
			return null;
		}
		return this._buf[this._pos];
	}
	
	getResults(): FindResult[] {
		return this._buf;
	}

	getAnnotations(): DisplayedAnnotation[] {
		const selected = this._pos >= 0 && this._pos < this._buf.length ? this._buf[this._pos] : null;
		const highlights: DisplayedAnnotation[] = [];
		if (this.highlightAll) {
			for (const result of this._buf) {
				if (selected === result) {
					highlights.push({
						...result.highlight,
						color: 'rgba(0, 100, 0, 1)'
					});
				}
				else {
					highlights.push(result.highlight);
				}
			}
		}
		else if (selected) {
			highlights.push({
				...selected.highlight,
				color: 'rgba(0, 100, 0, 1)'
			});
		}
		return highlights;
	}
}

export type FindResult = {
	range: Range;
	highlight: DisplayedAnnotation;
}

export default DefaultFindProcessor;
