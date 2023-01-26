
export class PDFManager {
	constructor(options) {
		this._outline = [];
		this._onUpdatePageLabels = options.onUpdatePageLabels;
		this._pages = {
			0: {
				pageIndex: 0,
				pageLabel: '5',
				chars: [],
				words: [],
				lines: [],
				paragraphs: [],
				overlays: [],
			}
		};

		this._init();
	}

	async _init() {
		let pageLabels = [];
		for(let i = 0; i < 1000; i++) {
			pageLabels[i] = (i + 1).toString() + 'a';
		}
		this._onUpdatePageLabels(pageLabels);
	}

	getPageLabels() {

	}

	getPageByLabel(pageLabel) {

	}

	rotatePages(pageIndexes) {

	}

	deletePages(pageIndexes) {

	}

	importAnnotations() {

	}

	exportAnnotations(annotations) {

	}
}
