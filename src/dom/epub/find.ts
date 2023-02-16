import {
	Book,
	EpubCFI,
} from "epubjs";
import Section from "epubjs/types/section";
import { kmpSearch } from "../common/lib/kmp-search";
import { getAllTextNodes } from "../common/lib/nodes";
import FindProcessor from "../common/find";
import { DisplayedAnnotation } from "../common/components/overlay/annotation-overlay";
import EPUBView from "./epub-view";

export class EPUBFindProcessor extends FindProcessor {
	readonly book: Book;
	
	readonly view: EPUBView;

	readonly section: Section;

	private _cfi: EpubCFI;

	private readonly _buf: string[];

	private _pos: number;

	constructor(options: {
		book: Book,
		view: EPUBView,
		startCFI: EpubCFI | null,
		section: Section,
		query: string,
		highlightAll: boolean,
		caseSensitive: boolean,
		entireWord: boolean
	}) {
		super(options);

		this.book = options.book;
		this.view = options.view;
		this.section = options.section;

		this._cfi = new EpubCFI();
		this._buf = [];
		this._pos = -1;

		this._run(options.startCFI);
	}

	next(): { done: false, cfi: string } | { done: true, nextProcessor: Promise<EPUBFindProcessor> } {
		if (this._pos >= this._buf.length - 1) {
			const nextSectionIdx = (this.section.index + 1) % this.book.spine.length;
			const nextSection = this.book.spine.get(nextSectionIdx);
			const nextProcessor = nextSection.load(this.book.load.bind(this.book))
				.then(() => new EPUBFindProcessor({
					book: this.book,
					view: this.view,
					startCFI: null,
					section: nextSection,
					query: this.query,
					highlightAll: this.highlightAll,
					caseSensitive: this.caseSensitive,
					entireWord: this.entireWord
				}));
			return { done: true, nextProcessor };
		}
		return { done: false, cfi: this._buf[++this._pos] };
	}

	prev(): { done: false, cfi: string } | { done: true, nextProcessor: Promise<EPUBFindProcessor> } {
		if (this._pos == -1) {
			this._pos = this._buf.length;
		}
		if (this._pos < 1) {
			let nextSectionIdx = this.section.index - 1;
			if (nextSectionIdx < 0) {
				nextSectionIdx += this.book.spine.length;
			}
			const nextSection = this.book.spine.get(nextSectionIdx);
			const nextProcessor = nextSection.load(this.book.load.bind(this.book))
				.then(() => new EPUBFindProcessor({
					book: this.book,
					view: this.view,
					startCFI: null,
					section: nextSection,
					query: this.query,
					highlightAll: this.highlightAll,
					caseSensitive: this.caseSensitive,
					entireWord: this.entireWord
				}));
			return { done: true, nextProcessor };
		}
		return { done: false, cfi: this._buf[--this._pos] };
	}

	override getSectionAnnotations(section: number) {
		if (section != this.section.index) {
			return [];
		}
		
		const highlights: DisplayedAnnotation[] = [];
		const selectedCFI = this._buf[this._pos];
		if (this.highlightAll) {
			for (const cfi of this._buf) {
				const range = this.view.getRange(cfi);
				if (!range) {
					continue;
				}
				highlights.push({
					type: 'highlight',
					color: cfi == selectedCFI ? 'rgba(0, 100, 0, 1)' : 'rgba(180, 0, 170, 1)',
					text: '',
					hasComment: false,
					range,
				});
			}
		}
		else {
			const range = this.view.getRange(selectedCFI);
			if (range) {
				highlights.push({
					type: 'highlight',
					color: 'rgba(0, 100, 0, 1)',
					text: '',
					hasComment: false,
					range,
				});
			}
		}
		return highlights;
	}

	private _run(startCFI: EpubCFI | null) {
		if (this._buf.length) {
			return;
		}

		const results = kmpSearch(
			getAllTextNodes(this.section.contents),
			this.query,
			{
				caseSensitive: this.caseSensitive,
				entireWord: this.entireWord
			}
		);
		let i = 0;
		let pos = -1;
		for (const range of results) {
			const cfi = this.section.cfiFromRange(range);
			if (pos == -1 && startCFI && this._cfi.compare(cfi, startCFI) >= 0) {
				pos = i - 1;
			}
			this._buf.push(cfi);
			i++;
		}
		this._pos = pos;
	}
}
