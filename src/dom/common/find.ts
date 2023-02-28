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

	private _pos: number | null = null;
	
	private _initialPos: number | null = null;

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
		
		const ranges = executeSearch(
			getAllTextNodes(options.container),
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
			if (this._initialPos === null && options.startRange) {
				if (range.compareBoundaryPoints(Range.START_TO_START, options.startRange) >= 0) {
					this._initialPos = this._buf.length;
				}
			}
			this._buf.push(result);
		}
		this._setFindState();
	}
	
	prev(loop = true): FindResult | null {
		if (this._pos === null) {
			if (this._initialPos === null) {
				this._pos = this._buf.length - 1;
			}
			else {
				this._pos = this._initialPos;
				this._initialPos = null;
			}
		}
		else {
			this._pos--;
			if (loop) {
				this._pos %= this._buf.length;
				if (this._pos < 0) {
					this._pos = this._buf.length - 1;
				}
			}
		}
		this._setFindState();
		return this.current;
	}
	
	next(loop = true): FindResult | null {
		if (this._pos === null) {
			if (this._initialPos === null) {
				this._pos = 0;
			}
			else {
				this._pos = this._initialPos;
				this._initialPos = null;
			}
		}
		else {
			this._pos++;
			if (loop) {
				this._pos %= this._buf.length;
			}
		}
		this._setFindState();
		return this.current;
	}
	
	get position(): number | null {
		return this._pos;
	}
	
	set position(value) {
		this._pos = value;
		this._setFindState();
	}
	
	get initialPosition(): number | null {
		return this._initialPos;
	}
	
	get current(): FindResult | null {
		if (this._pos === null || this._pos < 0 || this._pos >= this._buf.length) {
			return null;
		}
		return this._buf[this._pos];
	}
	
	getResults(): FindResult[] {
		return this._buf;
	}

	getAnnotations(): DisplayedAnnotation[] {
		const selected
			= (this._pos !== null && this._pos >= 0 && this._pos < this._buf.length)
				? this._buf[this._pos]
				: null;
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
	
	getSnippets(): string[] {
		return this._buf.map(({ range }) => {
			range = range.cloneRange();
			let snippet = range.toString();
			if (range.startOffset > 0) {
				const textBeforeRange = range.startContainer.nodeValue!.substring(0, range.startOffset);
				const beforeContext = textBeforeRange.match(/\b([\w\W]){1,20}$/);
				if (beforeContext) {
					snippet = beforeContext[0].trimStart() + snippet;
					if (beforeContext[0] != textBeforeRange) {
						snippet = '…' + snippet;
					}
				}
			}
			if (range.endOffset < range.startContainer.nodeValue!.length) {
				const textAfterRange = range.startContainer.nodeValue!.substring(range.endOffset);
				const afterContext = textAfterRange.match(/^([\w\W]){1,20}\b/);
				if (afterContext) {
					snippet += afterContext[0].trimEnd();
					if (afterContext[0] != textAfterRange) {
						snippet += '…';
					}
				}
			}
			return snippet;
		});
	}
	
	private _setFindState() {
		if (this._onSetFindState) {
			this._onSetFindState({
				...this.findState,
				result: {
					total: this._buf.length,
					index: this._pos === null ? 0 : this._pos,
					snippets: this.getSnippets(),
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
