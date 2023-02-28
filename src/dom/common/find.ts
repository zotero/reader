import { DisplayedAnnotation } from "./components/overlay/annotation-overlay";
import { executeSearch } from "./lib/dom-text-search";
import { getAllTextNodes } from "./lib/nodes";
import { FindState } from "../../common/types";

export interface FindProcessor {
	getAnnotations(): DisplayedAnnotation[];

	prev(): FindResult | null;

	next(): FindResult | null;
}

class DefaultFindProcessor implements FindProcessor {
	readonly findState: FindState;

	private readonly _buf: FindResult[];

	private _pos = -1;

	private readonly _onSetFindState?: (state?: FindState) => void;

	constructor(options: {
		container: Element,
		startRange?: Range,
		findState: FindState,
		onSetFindState?: (state?: FindState) => void,
	}) {
		this.findState = options.findState;
		this._onSetFindState = options.onSetFindState;
		
		this._buf = [];
		
		this._run(options.container, options.startRange);
	}

	private _run(container: Element, startRange?: Range) {
		const ranges = executeSearch(
			getAllTextNodes(container),
			this.findState.query,
			{
				caseSensitive: this.findState.caseSensitive,
				entireWord: this.findState.entireWord
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
		this._setFindState();
	}
	
	prev(loop = true): FindResult | null {
		this._pos--;
		if (loop) {
			this._pos %= this._buf.length;
			if (this._pos < 0) {
				this._pos = this._buf.length - 1;
			}
		}
		this._setFindState();
		return this.current;
	}
	
	next(loop = true): FindResult | null {
		this._pos++;
		if (loop) {
			this._pos %= this._buf.length;
		}
		this._setFindState();
		return this.current;
	}
	
	reset(toEnd: boolean) {
		this._pos = toEnd ? this._buf.length : -1;
		this._setFindState();
	}
	
	get position(): number | null {
		return this._pos == -1 ? null : this._pos;
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

	getAnnotations(enableSelected = true): DisplayedAnnotation[] {
		const selected = enableSelected && this._pos >= 0 && this._pos < this._buf.length ? this._buf[this._pos] : null;
		const highlights: DisplayedAnnotation[] = [];
		if (this.findState.highlightAll) {
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
	
	private _setFindState() {
		if (this._onSetFindState) {
			this._onSetFindState({
				...this.findState,
				result: {
					total: this._buf.length,
					index: this._pos == -1 ? 0 : this._pos,
					snippets: []
				}
			});
		}
	}
}

export type FindResult = {
	range: Range;
	highlight: DisplayedAnnotation;
}

export default DefaultFindProcessor;
