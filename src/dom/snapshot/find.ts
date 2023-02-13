import { kmpSearch } from "../common/lib/kmp-search";
import { getAllTextNodes } from "../common/lib/nodes";
import FindProcessor from "../common/find";
import { DisplayedAnnotation } from "../common/components/overlay/annotation-overlay";

export class SnapshotFindProcessor extends FindProcessor {
	readonly doc: Document;

	private readonly _buf: Range[];

	private _pos: number;

	constructor(options: {
		doc: Document,
		query: string,
		highlightAll: boolean,
		caseSensitive: boolean,
		entireWord: boolean
	}) {
		super(options);
		
		this.doc = options.doc;

		this._buf = [];
		this._pos = -1;

		this._run();
	}

	next(): Range | null {
		if (!this._buf.length) {
			return null;
		}

		this._pos = (this._pos + 1) % this._buf.length;
		return this._buf[this._pos];
	}

	prev(): Range | null {
		if (!this._buf.length) {
			return null;
		}

		this._pos = (this._pos - 1) % this._buf.length;
		if (this._pos < 0) {
			this._pos = this._buf.length - 1;
		}
		return this._buf[this._pos];
	}

	private _run() {
		if (this._buf.length) {
			return;
		}

		const results = kmpSearch(
			getAllTextNodes(this.doc.body),
			this.query,
			{
				caseSensitive: this.caseSensitive,
				entireWord: this.entireWord
			}
		);
		this._buf.push(...results);
	}

	override getSectionAnnotations() {
		const highlights: DisplayedAnnotation[] = [];
		const selectedRange = this._buf[this._pos];
		if (this.highlightAll) {
			for (const range of this._buf) {
				highlights.push({
					type: 'highlight',
					color: range == selectedRange ? 'rgba(0, 100, 0, 1)' : 'rgba(180, 0, 170, 1)',
					text: '',
					hasComment: false,
					range
				});
			}
		}
		else {
			highlights.push({
				type: 'highlight',
				color: 'rgba(0, 100, 0, 1)',
				text: '',
				hasComment: false,
				range: selectedRange
			});
		}
		return highlights;
	}
}
