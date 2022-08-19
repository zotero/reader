'use strict';

import {
	getClosestOffset,
	getPageLabelPoints,
	getPageLabel,
	getRangeBySelection,
	getNextLineClosestOffset,
	getPrevLineClosestOffset,
	getClosestWord,
	getClosestLine,
	getLines,
	extractLinks
} from './text';

export class Extractor {
	constructor(pdfViewer, getAnnotations) {
		this.pdfViewer = pdfViewer;
		this.getAnnotations = getAnnotations;
		this.charsCache = {};
		this.pageLabelsCache = {};
		this.pageLabelPointsCache = undefined;
		this.pageLinks = {};
	}

	async getPageChars(pageIndex) {
		if (this.charsCache[pageIndex]) {
			return this.charsCache[pageIndex];
		}

		let page = await this.pdfViewer.pdfDocument.getPage(pageIndex + 1);
		let textContent = await page.getTextContent();

		let chars = [];
		for (let item of textContent.items) {
			for (let char of item.chars) {
				// Note: Rotation is rounded in PDF.js
				if (char.rotation % 90 === 0
					&& char.c !== ' '
					// Sometimes char can map to null and break strings
					&& char.c.charCodeAt(0)
				) {
					chars.push(char);
				}
			}
		}

		// Reverse RTL lines
		let lines = getLines(chars, true);
		let links = extractLinks(lines, chars);
		this.pageLinks[pageIndex] = links;
		this.charsCache[pageIndex] = chars;
		for (let link of links) {
			let range = this.extractRange({
				pageIndex,
				anchor: link.from,
				head: link.to
			});
			link.position = range.position;
		}
		return chars;
	}

	getPageCharsSync(pageIndex) {
		let chars = this.charsCache[pageIndex];
		return chars && chars.length ? chars : null;
	}

	getNextLineClosestOffset(pageIndex, offset) {
		let chars = this.getPageCharsSync(pageIndex);
		return chars && getNextLineClosestOffset(chars, offset);
	}

	getPrevLineClosestOffset(pageIndex, offset) {
		let chars = this.getPageCharsSync(pageIndex);
		return chars && getPrevLineClosestOffset(chars, offset);
	}

	getClosestWord(position) {
		let chars = this.getPageCharsSync(position.pageIndex);
		return chars && getClosestWord(chars, position.rects[0]);
	}

	getClosestLine(position) {
		let chars = this.getPageCharsSync(position.pageIndex);
		return chars && getClosestLine(chars, position.rects[0]);
	}

	extractRange({ pageIndex, anchor, head, reverse }) {
		let chars = this.getPageCharsSync(pageIndex);
		if (!chars) {
			return null;
		}
		let range = getRangeBySelection({ chars, anchor, head, reverse });
		if (!range) {
			return null;
		}

		range.position = {
			pageIndex,
			rects: range.rects
		};
		delete range.rects;
		return range;
	}

	async getSortIndex(position) {
		let chars = await this.getPageChars(position.pageIndex);
		let page = position.pageIndex;
		let offset = chars.length && getClosestOffset(chars, position.rects[0]) || 0;
		let pageHeight = (await this.pdfViewer.pdfDocument.getPage(position.pageIndex + 1)).view[3];
		let top = pageHeight - position.rects[0][3];
		if (top < 0) {
			top = 0;
		}

		return [
			page.toString().slice(0, 5).padStart(5, '0'),
			offset.toString().slice(0, 6).padStart(6, '0'),
			Math.floor(top).toString().slice(0, 5).padStart(5, '0')
		].join('|');
	}

	async extractPageLabelPoints() {
		if (this.pageLabelPointsCache !== undefined) {
			return this.pageLabelPointsCache;
		}
		for (let i = 0; i < 5 && i + 3 < this.pdfViewer.pdfDocument.numPages; i++) {
			let pageHeight = (await this.pdfViewer.pdfDocument.getPage(i + 1)).view[3];
			let chars1 = await this.getPageChars(i);
			let chars2 = await this.getPageChars(i + 1);
			let chars3 = await this.getPageChars(i + 2);
			let chars4 = await this.getPageChars(i + 3);
			let res = getPageLabelPoints(i, chars1, chars2, chars3, chars4, pageHeight);
			if (res) {
				this.pageLabelPointsCache = res;
				return res;
			}
		}

		this.pageLabelPointsCache = null;
		return null;
	}

	async extractPageLabel(pageIndex) {
		let points = await this.extractPageLabelPoints();
		if (!points) {
			return null;
		}

		let charsPrev, charsCur, charsNext;
		if (pageIndex > 0) {
			charsPrev = await this.getPageChars(pageIndex - 1);
		}
		charsCur = await this.getPageChars(pageIndex);

		if (pageIndex < this.pdfViewer.pdfDocument.numPages - 1) {
			charsNext = await this.getPageChars(pageIndex + 1);
		}

		return getPageLabel(pageIndex, charsPrev, charsCur, charsNext, points);
	}

	clearLabelsCache() {
		this.pageLabelsCache = {};
	}

	async getPageLabel(pageIndex, usePrevAnnotation) {
		if (!usePrevAnnotation && this.pageLabelsCache[pageIndex]) {
			return this.pageLabelsCache[pageIndex];
		}

		let extractedPageLabel = await this.extractPageLabel(pageIndex);
		let assignedPageLabel;
		let pageLabels = this.pdfViewer._pageLabels;
		if (pageLabels && pageLabels[pageIndex]) {
			assignedPageLabel = pageLabels[pageIndex];
		}

		let pageLabel = (pageIndex + 1).toString();

		if (extractedPageLabel) {
			pageLabel = extractedPageLabel;
		}
		else if (assignedPageLabel) {
			pageLabel = assignedPageLabel;
		}

		if (usePrevAnnotation) {
			let annotations = this.getAnnotations().reverse();
			for (let annotation of annotations) {
				// Ignore read-only annotation because user can't fix its page label
				if (!annotation.readOnly
					&& annotation.pageLabel !== '-'
					&& annotation.position.pageIndex <= pageIndex) {
					if (parseInt(annotation.pageLabel) == annotation.pageLabel || (/[0-9]+[-\u2013][0-9]+/).test(annotation.pageLabel)) {
						pageLabel = (pageIndex + (parseInt(annotation.pageLabel) - annotation.position.pageIndex)).toString();
					}
					break;
				}
			}
		}
		else {
			this.pageLabelsCache[pageIndex] = pageLabel;
		}
		return pageLabel;
	}

	getCachedPageLabel(pageIndex) {
		if (this.pageLabelsCache[pageIndex]) {
			return this.pageLabelsCache[pageIndex];
		}
		return null;
	}

	async getPageIndexByLabel(pageLabel) {
		let numericPageLabel = parseInt(pageLabel);
		let points = await this.extractPageLabelPoints();
		if (points && numericPageLabel == pageLabel) {
			let targetPageIndex = points[0].idx + (numericPageLabel - points[0].num);
			if (targetPageIndex >= 0 && targetPageIndex < this.pdfViewer.pdfDocument.numPages) {
				let targetPageLabel = await this.extractPageLabel(targetPageIndex);
				if (targetPageLabel == pageLabel) {
					return targetPageIndex;
				}
			}
		}

		let pageLabels = this.pdfViewer._pageLabels;
		if (pageLabels) {
			let targetPageIndex = pageLabels.indexOf(pageLabel);
			if (targetPageIndex !== -1) {
				return targetPageIndex;
			}
		}

		if (numericPageLabel == pageLabel && numericPageLabel > 0) {
			return numericPageLabel - 1;
		}

		return null;
	}

	getPageLinks(pageIndex) {
		let links = this.pageLinks[pageIndex];
		if (!links) {
			return [];
		}
		return links;
	}
}
