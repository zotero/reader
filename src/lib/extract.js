'use strict';

import { extractRange } from './text/range';
import { getClosestOffset } from './text/offset';
import { getPageLabelPoints, getPageLabel } from './text/page';

export class Extractor {
	constructor(pdfViewer) {
		this.pdfViewer = pdfViewer;
		this.chsCache = {};
		this.pageLabelsCache = {};
		this.pageLabelPointsCache = undefined;
	}

	async getPageChs(pageIndex) {
		if (this.chsCache[pageIndex]) {
			return this.chsCache[pageIndex];
		}

		let page = await this.pdfViewer.pdfDocument.getPage(pageIndex + 1);
		let textContent = await page.getTextContent();

		let chs = [];
		for (let item of textContent.items) {
			for (let ch of item.chars) {
				chs.push(ch);
			}
		}

		this.chsCache[pageIndex] = chs;
		return chs;
	}

	async extractRange(position) {
		let chs = await this.getPageChs(position.pageIndex);
		if (!chs.length) {
			return;
		}
		let range = extractRange(chs, position.rects, true);
		if (!range) {
			return;
		}
		return {
			position: {
				pageIndex: position.pageIndex,
				rects: range.rects
			},
			text: range.text,
			offset: range.offset
		};
	}

	async getSortIndex(position) {
		let chs = await this.getPageChs(position.pageIndex);
		let page = position.pageIndex;
		let offset = chs.length && getClosestOffset(chs, position.rects[0]) || 0;
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
			let chs1 = await this.getPageChs(i);
			let chs2 = await this.getPageChs(i + 1);
			let chs3 = await this.getPageChs(i + 2);
			let chs4 = await this.getPageChs(i + 3);
			let res = getPageLabelPoints(i, chs1, chs2, chs3, chs4, pageHeight);
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

		let chsPrev, chsCur, chsNext;
		if (pageIndex > 0) {
			chsPrev = await this.getPageChs(pageIndex - 1);
		}
		chsCur = await this.getPageChs(pageIndex);

		if (pageIndex < this.pdfViewer.pdfDocument.numPages - 1) {
			chsNext = await this.getPageChs(pageIndex + 1);
		}

		let pageLabel = getPageLabel(pageIndex, chsPrev, chsCur, chsNext, points);

		if (pageLabel) {
			return pageLabel;
		}

		return null;
	}

	async getPageLabel(pageIndex) {
		if (this.pageLabelsCache[pageIndex]) {
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

		this.pageLabelsCache[pageIndex] = pageLabel;
		return pageLabel;
	}

	getCachedPageLabel(pageIndex) {
		if (this.pageLabelsCache[pageIndex]) {
			return this.pageLabelsCache[pageIndex];
		}
		return null;
	}
}
