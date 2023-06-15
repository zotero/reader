import { getPositionBoundingRect } from './lib/utilities';

function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
	let left = bx2 < ax1;
	let right = ax2 < bx1;
	let bottom = by2 < ay1;
	let top = ay2 < by1;

	if (top && left) {
		return Math.hypot(ax1 - bx2, ay2 - by1);
	}
	else if (left && bottom) {
		return Math.hypot(ax1 - bx2, ay1 - by2);
	}
	else if (bottom && right) {
		return Math.hypot(ax2 - bx1, ay1 - by2);
	}
	else if (right && top) {
		return Math.hypot(ax2 - bx1, ay2 - by1);
	}
	else if (left) {
		return ax1 - bx2;
	}
	else if (right) {
		return bx1 - ax2;
	}
	else if (bottom) {
		return ay1 - by2;
	}
	else if (top) {
		return by1 - ay2;
	}

	return 0;
}

function getClosestOffset(chars, rect) {
	let dist = Infinity;
	let idx = 0;
	for (let i = 0; i < chars.length; i++) {
		let ch = chars[i];
		let distance = rectsDist(ch.rect, rect);
		if (distance < dist) {
			dist = distance;
			idx = i;
		}
	}
	return idx;
}


function quickIntersectRect(r1, r2) {
	return !(r2[0] > r1[2]
		|| r2[2] < r1[0]
		|| r2[1] > r1[3]
		|| r2[3] < r1[1]);
}

function getCenterRect(r) {
	return [
		r[0] + (r[2] - r[0]) / 2,
		r[1] + (r[3] - r[1]) / 2,
		r[0] + (r[2] - r[0]) / 2,
		r[1] + (r[3] - r[1]) / 2
	];
}

function isRTL() {
	return false;
}

function isDash() {
	return true;
}

function getRangeBySelection({ structuredText, anchor, head, reverse }) {
	let chars = flattenChars(structuredText);
	// Note: Offsets can be between 0 and chars.length (the cursor can after the last char)
	if (!chars.length) {
		return null;
	}
	let anchorOffset = reverse ? chars.length : 0;
	let headOffset = reverse ? 0 : chars.length;
	let x1, y1, x2, y2;
	if (Number.isInteger(anchor)) {
		anchorOffset = anchor;
		anchorOffset = anchorOffset < 0 ? 0 : anchorOffset;
		anchorOffset = anchorOffset > chars.length ? chars.length : anchorOffset;
	}
	else if (Array.isArray(anchor)) {
		[x1, y1] = anchor;
		anchorOffset = getClosestOffset(chars, [x1, y1, x1, y1]);
	}
	if (Number.isInteger(head)) {
		headOffset = head;
		headOffset = headOffset < 0 ? 0 : headOffset;
		headOffset = headOffset > chars.length ? chars.length : headOffset;
	}
	else if (Array.isArray(head)) {
		[x2, y2] = head;
		headOffset = getClosestOffset(chars, [x2, y2, x2, y2]);
	}
	if (Array.isArray(anchor)) {
		let { rotation, rect, c } = chars[anchorOffset];
		let rtl = isRTL(c);
		if (rtl && (
				!rotation && x1 < rect[0] + (rect[2] - rect[0]) / 2
			)
			|| !rtl && (
				!rotation && x1 > rect[0] + (rect[2] - rect[0]) / 2
				|| rotation === 90 && y1 > rect[1] + (rect[3] - rect[1]) / 2
				|| rotation === 180 && x1 < rect[0] + (rect[2] - rect[0]) / 2
				|| rotation === 270 && y1 < rect[1] + (rect[3] - rect[1]) / 2
			)
		) {
			anchorOffset++;
		}
	}
	if (Array.isArray(head)) {
		let { rotation, rect, c } = chars[headOffset];
		let rtl = isRTL(c);
		if (rtl && (
				!rotation && x2 < rect[0] + (rect[2] - rect[0]) / 2
			)
			|| !rtl && (
				!rotation && x2 > rect[0] + (rect[2] - rect[0]) / 2
				|| rotation === 90 && y2 > rect[1] + (rect[3] - rect[1]) / 2
				|| rotation === 180 && x2 < rect[0] + (rect[2] - rect[0]) / 2
				|| rotation === 270 && y2 < rect[1] + (rect[3] - rect[1]) / 2
			)
		) {
			headOffset++;
		}
	}

	return getRange(structuredText, anchorOffset, headOffset);
}

function getRangeByHighlight(structuredText, rects) {
	let chars = flattenChars(structuredText);
	if (!chars.length) {
		return null;
	}
	let anchorOffset = Infinity;
	for (let i = 0; i < chars.length; i++) {
		let char = chars[i];
		if (quickIntersectRect(getCenterRect(char.rect), rects[0])) {
			anchorOffset = i;
			break;
		}
	}
	let headOffset = 0;
	for (let i = chars.length - 1; i >= 0; i--) {
		let char = chars[i];
		if (quickIntersectRect(getCenterRect(char.rect), rects[rects.length - 1])) {
			headOffset = i;
			break;
		}
	}

	headOffset++;

	if (anchorOffset > headOffset) {
		return null;
	}

	let range = getRange(structuredText, anchorOffset, headOffset);
	range.offset = range.anchorOffset;
	range.from = range.anchorOffset;
	range.to = range.headOffset;
	// delete range.anchorOffset;
	// delete range.headOffset;
	return range;
}

function getLineSelectionRect(line, charFrom, charTo) {
	if (charFrom.rotation) {
		return [
			line.rect[0],
			Math.min(charFrom.rect[1], charTo.rect[1]),
			line.rect[2],
			Math.max(charFrom.rect[3], charTo.rect[3])
		];
	}
	else {
		return [
			Math.min(charFrom.rect[0], charTo.rect[0]),
			line.rect[1],
			Math.max(charFrom.rect[2], charTo.rect[2]),
			line.rect[3]
		];
	}
}

function getRange(structuredText, anchorOffset, headOffset) {
	let charStart;
	let charEnd;
	if (anchorOffset < headOffset) {
		charStart = anchorOffset;
		charEnd = headOffset - 1;
	}
	else if (anchorOffset > headOffset) {
		charStart = headOffset;
		charEnd = anchorOffset - 1;
	}
	else {
		return { collapsed: true, anchorOffset, headOffset, rects: [], text: '' };
	}

	// Get text
	let text = '';
	let extracting = false;

	let { paragraphs } = structuredText;

	let n = 0;

	loop1: for (let paragraph of paragraphs) {
		for (let line of paragraph.lines) {
			for (let word of line.words) {
				for (let char of word.chars) {
					if (n === charStart) {
						extracting = true;
					}
					if (extracting) {
						text += char.c;
					}
					if (n === charEnd) {
						break loop1;
					}
					n++;
				}
				if (extracting && word.spaceAfter) {
					text += ' ';
				}
			}
		}
	}
	text = text.trim();
	// Get rects
	extracting = false;
	let rects = [];
	n = 0;
	loop2: for (let paragraph of paragraphs) {
		for (let line of paragraph.lines) {
			let charFrom = null;
			let charTo = null;
			for (let word of line.words) {
				for (let char of word.chars) {
					if (n === charStart || extracting && !charFrom) {
						charFrom = char;
						extracting = true;
					}
					if (extracting) {
						charTo = char;
						if (n === charEnd) {
							rects.push(getLineSelectionRect(line, charFrom, charTo));
							break loop2;
						}
					}
					n++;
				}
			}
			if (extracting && charFrom && charTo) {
				rects.push(getLineSelectionRect(line, charFrom, charTo));
				charFrom = null;
			}
		}
	}

	rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
	return { anchorOffset, headOffset, rects, text };
}

function getNextLineClosestOffset(structuredText, offset) {
	let indexes = getIndexesByCharOffset(structuredText, offset);
	let currentLine = structuredText.paragraphs[indexes.pIndex].lines[indexes.lIndex];
	let currentChar = currentLine.words[indexes.wIndex].chars[indexes.cIndex];

	// Check if there's a next line
	if (indexes.lIndex + 1 >= structuredText.paragraphs[indexes.pIndex].lines.length) {
		return null; // There is no next line
	}

	let nextLine = structuredText.paragraphs[indexes.pIndex].lines[indexes.lIndex + 1];
	let closestChar = null;
	let closestDistance = Infinity;
	let offsetStart = offset - indexes.cIndex; // Offset at the start of the next line
	let closestOffset = 0;

	nextLine.words.forEach((word, wordIndex) => {
		word.chars.forEach((char, charIndex) => {
			let distance = Math.abs(char.rect[0] - currentChar.rect[0]);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestChar = char;
				closestOffset = offsetStart + word.chars.slice(0, wordIndex).reduce((total, word) => total + word.chars.length, 0) + charIndex;
			}
		});
		offsetStart += word.chars.length;
	});

	return closestOffset;
}

function getPrevLineClosestOffset(structuredText, offset) {
	let indexes = getIndexesByCharOffset(structuredText, offset);
	let currentLine = structuredText.paragraphs[indexes.pIndex].lines[indexes.lIndex];
	let currentChar = currentLine.words[indexes.wIndex].chars[indexes.cIndex];

	// Check if there's a previous line
	if (indexes.lIndex - 1 < 0) {
		return null; // There is no previous line
	}

	let prevLine = structuredText.paragraphs[indexes.pIndex].lines[indexes.lIndex - 1];
	let closestChar = null;
	let closestDistance = Infinity;
	let offsetStart = offset - indexes.cIndex; // Offset at the start of the previous line
	let closestOffset = 0;

	prevLine.words.forEach((word, wordIndex) => {
		word.chars.forEach((char, charIndex) => {
			let distance = Math.abs(char.rect[0] - currentChar.rect[0]);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestChar = char;
				closestOffset = offsetStart - word.chars.slice(0, wordIndex).reduce((total, word) => total + word.chars.length, 0) - charIndex;
			}
		});
		offsetStart -= word.chars.length;
	});

	return closestOffset;
}

function getClosestWord(structuredText, rect) {
	let closestWord = null;
	let closestDistance = Infinity;
	let offsetStart = 0;
	let offsetEnd = 0;

	structuredText.paragraphs.forEach(paragraph => {
		paragraph.lines.forEach(line => {
			line.words.forEach(word => {
				let distance = rectsDist(rect, word.rect);
				if (distance < closestDistance) {
					closestDistance = distance;
					closestWord = word;

					offsetEnd = offsetStart + word.chars.length;
				}
				offsetStart += word.chars.length;
			});
		});
	});

	return {
		anchorOffset: offsetEnd - closestWord.chars.length,
		headOffset: offsetEnd
	};
}

function getClosestLine(structuredText, rect) {
	let closestLine = null;
	let closestDistance = Infinity;
	let offsetStart = 0;
	let offsetEnd = 0;

	structuredText.paragraphs.forEach(paragraph => {
		paragraph.lines.forEach(line => {
			let lineLength = line.words.reduce((total, word) => {
				return total + word.chars.length;
			}, 0);

			let distance = rectsDist(rect, line.rect);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestLine = line;
				offsetEnd = offsetStart + lineLength;
			}
			offsetStart += lineLength;
		});
	});

	return {
		line: closestLine,
		anchorOffset: offsetEnd - closestLine.words.reduce((total, word) => {
			return total + word.chars.length;
		}, 0),
		headOffset: offsetEnd
	};
}

function getFlattenedCharsByIndex(pdfPages, pageIndex) {
	let structuredText = pdfPages[pageIndex].structuredText;
	return flattenChars(structuredText);
}

export function flattenChars(structuredText) {
	let flatCharsArray = [];
	for (let paragraph of structuredText.paragraphs) {
		for (let line of paragraph.lines) {
			for (let word of line.words) {
				for (let charObj of word.chars) {
					flatCharsArray.push(charObj);
				}
			}
		}
	}
	return flatCharsArray;
}

function getIndexesByCharOffset(structuredText, targetOffset) {
	let currentOffset = 0;

	for (let pIndex = 0; pIndex < structuredText.paragraphs.length; pIndex++) {
		let paragraph = structuredText.paragraphs[pIndex];
		for (let lIndex = 0; lIndex < paragraph.lines.length; lIndex++) {
			let line = paragraph.lines[lIndex];
			for (let wIndex = 0; wIndex < line.words.length; wIndex++) {
				let word = line.words[wIndex];
				for (let cIndex = 0; cIndex < word.chars.length; cIndex++) {
					if (currentOffset === targetOffset) {
						return { pIndex, lIndex, wIndex, cIndex };
					}
					currentOffset++;
				}
			}
		}
	}

	throw new Error('Target offset is out of range');
}

export function extractRange({ structuredText, pageIndex, anchor, head, reverse }) {
	let range = getRangeBySelection({ structuredText, anchor, head, reverse });
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

export function extractRangeByRects({ structuredText, pageIndex, rects }) {
	let range = getRangeByHighlight(structuredText, rects);
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

export function getSortIndex(pdfPages, position) {
	let { pageIndex } = position;
	let offset = 0;
	let top = 0;
	if (pdfPages[position.pageIndex]) {
		let chars = getFlattenedCharsByIndex(pdfPages, position.pageIndex);
		let viewBox = pdfPages[position.pageIndex].viewBox;
		let rect = getPositionBoundingRect(position);
		offset = chars.length && getClosestOffset(chars, rect) || 0;
		let pageHeight = viewBox[3] - viewBox[1];
		top = pageHeight - rect[3];
		if (top < 0) {
			top = 0;
		}
	}
	return [
		pageIndex.toString().slice(0, 5).padStart(5, '0'),
		offset.toString().slice(0, 6).padStart(6, '0'),
		Math.floor(top).toString().slice(0, 5).padStart(5, '0')
	].join('|');
}

export function getModifiedSelectionRanges(pdfPages, selectionRanges, modifier) {
	if (!selectionRanges.length) {
		return [];
	}

	let range = selectionRanges.find(x => x.anchor);
	let anchor = {
		pageIndex: range.position.pageIndex,
		offset: range.anchorOffset
	};

	range = selectionRanges.find(x => x.head);
	let head = {
		pageIndex: range.position.pageIndex,
		offset: range.headOffset
	};

	if (!pdfPages[head.pageIndex]) {
		return [];
	}

	if (modifier === 'left') {
		head.offset--;
	}
	else if (modifier === 'right') {
		head.offset++;
	}
	else if (modifier === 'up') {
		let structuredText = pdfPages[head.pageIndex].structuredText;
		head.offset = getPrevLineClosestOffset(structuredText, head.pageIndex, head.offset);
		if (head.offset === null) {
			return [];
		}
	}
	else if (modifier === 'down') {
		let structuredText = pdfPages[head.pageIndex].structuredText;
		head.offset = getNextLineClosestOffset(structuredText, head.pageIndex, head.offset);
		if (head.offset === null) {
			return [];
		}
	}
	else if (typeof modifier === 'object') {
		let position = modifier;
		head = position;
	}
	return getSelectionRanges(pdfPages, anchor, head);
}

export function getWordSelectionRanges(pdfPages, anchorPosition, headPosition) {
	if (!pdfPages[anchorPosition.pageIndex]) {
		return [];
	}
	let structuredText = pdfPages[anchorPosition.pageIndex].structuredText;
	let anchorWord = getClosestWord(structuredText, anchorPosition.rects[0]);
	structuredText = pdfPages[headPosition.pageIndex].structuredText;
	let headWord = getClosestWord(structuredText, headPosition.rects[0]);
	if (!anchorWord || !headWord) {
		return [];
	}
	let anchor = { pageIndex: anchorPosition.pageIndex };
	let head = { pageIndex: headPosition.pageIndex };
	if (anchorWord.anchorOffset < headWord.anchorOffset && anchor.pageIndex === head.pageIndex
		|| anchor.pageIndex < head.pageIndex) {
		anchor.offset = anchorWord.anchorOffset;
		head.offset = headWord.headOffset;
	}
	else {
		anchor.offset = anchorWord.headOffset;
		head.offset = headWord.anchorOffset;
	}
	return getSelectionRanges(pdfPages, anchor, head);
}

export function getLineSelectionRanges(pdfPages, anchorPosition, headPosition) {
	if (!pdfPages[anchorPosition.pageIndex]) {
		return [];
	}
	let structuredText = pdfPages[anchorPosition.pageIndex].structuredText;
	let anchorLine = getClosestLine(structuredText, anchorPosition.rects[0]);
	structuredText = pdfPages[headPosition.pageIndex].structuredText;
	let headLine = getClosestLine(structuredText, headPosition.rects[0]);
	if (!anchorLine || !headLine) {
		return [];
	}
	let anchor = { pageIndex: anchorPosition.pageIndex };
	let head = { pageIndex: headPosition.pageIndex };
	if (anchorLine.anchorOffset < headLine.anchorOffset && anchor.pageIndex === head.pageIndex
		|| anchor.pageIndex < head.pageIndex) {
		anchor.offset = anchorLine.anchorOffset;
		head.offset = headLine.headOffset;
	}
	else {
		anchor.offset = anchorLine.headOffset;
		head.offset = headLine.anchorOffset;
	}
	return getSelectionRanges(pdfPages, anchor, head);
}

export function getSelectionRanges(pdfPages, anchor, head) {
	let selectionRanges = [];
	let fromPageIndex = Math.min(anchor.pageIndex, head.pageIndex);
	let toPageIndex = Math.max(anchor.pageIndex, head.pageIndex);
	let reverse = anchor.pageIndex > head.pageIndex;
	for (let i = fromPageIndex; i <= toPageIndex; i++) {
		if (!pdfPages[i]) {
			continue;
		}
		let a, h;
		if (i === anchor.pageIndex) {
			a = anchor.offset !== undefined ? anchor.offset : [anchor.rects[0][0], anchor.rects[0][1]];
		}

		if (i === head.pageIndex) {
			h = head.offset !== undefined ? head.offset : [head.rects[0][0], head.rects[0][1]];
		}

		let structuredText = pdfPages[i].structuredText;
		let selectionRange = extractRange({
			structuredText,
			pageIndex: i,
			anchor: a,
			head: h,
			reverse
		});
		if (!selectionRange) {
			return [];
		}

		if (i === anchor.pageIndex) {
			selectionRange.anchor = true;
		}

		if (i === head.pageIndex) {
			selectionRange.head = true;
		}

		if (!selectionRange.collapsed) {
			// This currently gets sortIndex by position.rects, which is probably less precise than using an offset
			selectionRange.sortIndex = getSortIndex(pdfPages, selectionRange.position);
		}

		selectionRanges.push(selectionRange);
	}
	return selectionRanges;
}

export function getSelectionRangesByPosition(pdfPages, position) {
	if (!pdfPages[position.pageIndex]) {
		return [];
	}
	let structuredText = pdfPages[position.pageIndex].structuredText;
	let selectionRanges = [];
	let selectionRange = extractRangeByRects({
		structuredText,
		pageIndex: position.pageIndex,
		rects: position.rects
	});
	if (!selectionRange) {
		return [];
	}

	selectionRanges = [selectionRange];

	if (position.nextPageRects) {
		let structuredText = pdfPages[position.pageIndex + 1].structuredText;
		selectionRange = extractRangeByRects({
			structuredText,
			pageIndex: position.pageIndex + 1,
			rects: position.nextPageRects
		});
		if (selectionRange) {
			selectionRanges.push(selectionRange);
		}
	}

	if (selectionRanges.length === 2) {
		selectionRanges[0].anchor = true;
		selectionRanges[1].head = true;
	}
	else {
		selectionRanges[0].head = true;
		selectionRanges[0].anchor = true;
	}



	// if (!selectionRange.collapsed) {
	// 	// We can synchronously get page viewbox from page view, because it's already loaded when selecting
	// 	let pageHeight = PDFViewerApplication.pdfViewer.getPageView(selectionRange.position.pageIndex).viewport.viewBox[3];
	// 	let top = pageHeight - selectionRange.position.rects[0][3];
	// 	if (top < 0) {
	// 		top = 0;
	// 	}
	//
	// 	// TODO: Unify all annotations sort index calculation
	// 	let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
	// 	selectionRange.sortIndex = [
	// 		i.toString().slice(0, 5).padStart(5, '0'),
	// 		offset.toString().slice(0, 6).padStart(6, '0'),
	// 		Math.floor(top).toString().slice(0, 5).padStart(5, '0')
	// 	].join('|');
	// }

	return selectionRanges;
}

export function getReversedSelectionRanges(selectionRanges) {
	selectionRanges = JSON.parse(JSON.stringify(selectionRanges));
	if (selectionRanges.length === 2) {
		delete selectionRanges[0].anchor;
		delete selectionRanges[1].head;
		selectionRanges[0].head = true;
		selectionRanges[1].anchor = true;
	}

	let tmp = selectionRanges[0].anchorOffset;
	selectionRanges[0].anchorOffset = selectionRanges[0].headOffset;
	selectionRanges[0].headOffset = tmp;
	if (selectionRanges.length === 2) {
		let tmp = selectionRanges[1].anchorOffset;
		selectionRanges[1].anchorOffset = selectionRanges[1].headOffset;
		selectionRanges[1].headOffset = tmp;
	}
	return selectionRanges;
}

function getMostCommonValue(arr) {
	let counts = arr.reduce((a, b) => ({ ...a, [b]: (a[b] || 0) + 1 }), {});
	return +Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

export function getRectRotationOnText(structuredText, rect) {
	let chars = [];
	for (let paragraph of structuredText.paragraphs) {
		if (!quickIntersectRect(paragraph.rect, rect)) {
			continue;
		}
		for (let line of paragraph.lines) {
			if (!quickIntersectRect(line.rect, rect)) {
				continue;
			}
			for (let word of line.words) {
				if (!quickIntersectRect(word.rect, rect)) {
					continue;
				}
				for (let char of word.chars) {
					if (quickIntersectRect(getCenterRect(char.rect), rect)) {
						chars.push(char);
					}
				}
			}
		}
	}
	if (!chars.length) {
		return 0;
	}
	// Get the most common rotation
	return getMostCommonValue(chars.map(x => x.rotation));
}

// Based on https://stackoverflow.com/a/16100733

function getNodeOffset(container, offset) {
	let charIndex = 0;
	let charIndex2 = 0;
	let nodeStack = [container];
	let node;
	while (node = nodeStack.pop()) {
		if (node.nodeType === Node.TEXT_NODE) {
			charIndex = 0;
			for (let i = 0; i < node.length; i++) {
				if (node.nodeValue[i].trim()) {
					if (offset === charIndex2) {
						return { node, offset: charIndex };
					}
					charIndex2++;
				}
				charIndex++;
			}
		}
		else {
			let i = node.childNodes.length;
			while (i--) {
				nodeStack.push(node.childNodes[i]);
			}
		}
	}
}

export function setTextLayerSelection(win, selectionRanges) {
	// Anchor
	let selectionRange = selectionRanges[0];
	let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
	let container = win.document.querySelector(
		`[data-page-number="${selectionRange.position.pageIndex + 1}"] .textLayer`);
	let { node: startNode, offset: startOffset } = getNodeOffset(container, offset);

	// Head
	selectionRange = selectionRanges[selectionRanges.length - 1];
	offset = Math.max(selectionRange.anchorOffset, selectionRange.headOffset);
	container = win.document.querySelector(
		`[data-page-number="${selectionRange.position.pageIndex + 1}"] .textLayer`);
	let { node: endNode, offset: endOffset } = getNodeOffset(container, offset);

	let range = win.document.createRange();
	range.setStart(container, 0);
	range.collapse(true);
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);

	let selection = win.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}
