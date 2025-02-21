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

function getRangeBySelection({ chars, anchor, head, reverse }) {
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

	return getRange(chars, anchorOffset, headOffset);
}

function getRangeByHighlight(chars, rects) {
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

	let range = getRange(chars, anchorOffset, headOffset);
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

function getRectsFromChars(chars) {
	let lineRects = [];
	let currentLineRect = null;
	for (let char of chars) {
		if (!currentLineRect) {
			currentLineRect = char.inlineRect.slice();
		}
		currentLineRect = [
			Math.min(currentLineRect[0], char.inlineRect[0]),
			Math.min(currentLineRect[1], char.inlineRect[1]),
			Math.max(currentLineRect[2], char.inlineRect[2]),
			Math.max(currentLineRect[3], char.inlineRect[3])
		];
		if (char.lineBreakAfter) {
			lineRects.push(currentLineRect);
			currentLineRect = null;
		}
	}
	if (currentLineRect) {
		lineRects.push(currentLineRect);
	}
	return lineRects;
}

function getTextFromChars(chars) {
	let text = [];
	for (let char of chars) {
		if (!char.ignorable) {
			text.push(char.c);
			if (char.spaceAfter || char.lineBreakAfter) {
				text.push(' ');
			}
		}
		// OCRed PDFs sometimes result in each line being a separate paragraph
		// while, normal PDFs only need this when paragraph is wrapped to another column
		if (!char.ignorable && char.paragraphBreakAfter) {
			text.push(' ');
		}
	}
	return text.join('').trim();
}

function getRange(chars, anchorOffset, headOffset) {
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

	let rangeChars = chars.slice(charStart, charEnd + 1);
	let text = getTextFromChars(rangeChars);
	let rects = getRectsFromChars(rangeChars);
	rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
	return { anchorOffset, headOffset, rects, text };
}

function getNextLineClosestOffset(chars, offset) {
	let currentLineEnd = chars.findIndex((x, idx) => idx >= offset && x.lineBreakAfter);
	if (currentLineEnd === -1 || currentLineEnd === chars.length - 1) {
		return chars.length;
	}
	let nextLineStart = currentLineEnd + 1;
	let nextLineEnd = chars.findIndex((x, idx) => idx >= nextLineStart && x.lineBreakAfter);
	let closestOffset = null;
	let closestDist = null;
	let currentChar = chars[offset];
	for (let i = nextLineStart; i <= nextLineEnd; i++) {
		let char = chars[i];
		if (closestDist === null || rectsDist(char.rect, currentChar.rect) < closestDist) {
			closestDist = rectsDist(char.rect, currentChar.rect);
			closestOffset = i;
		}
	}
	return closestOffset;
}

function getPrevLineClosestOffset(chars, offset) {
	if (offset === chars.length) {
		offset--;
	}
	let prevLineEnd = chars.findLastIndex((x, idx) => idx < offset && x.lineBreakAfter);
	if (prevLineEnd === -1) {
		return 0;
	}
	let prevLineStart = chars.findLastIndex((x, idx) => idx < prevLineEnd && x.lineBreakAfter);
	if (prevLineStart === -1) {
		prevLineStart = 0;
	}
	else {
		prevLineStart++;
	}
	let closestOffset = null;
	let closestDist = null;
	let currentChar = chars[offset];
	for (let i = prevLineStart; i <= prevLineEnd; i++) {
		let char = chars[i];
		if (closestDist === null || rectsDist(char.rect, currentChar.rect) < closestDist) {
			closestDist = rectsDist(char.rect, currentChar.rect);
			closestOffset = i;
		}
	}
	return closestOffset;
}

function getClosestWord(chars, rect) {
	let closestWordStart;
	let closestWordEnd;
	let closestWordDistance = null;
	let start = 0;
	for (let i = 0; i < chars.length; i++) {
		let char = chars[i];
		if (char.wordBreakAfter) {
			let end = i;
			let wordChars = chars.slice(start, end + 1);
			let wordRect = [
				Math.min(...wordChars.map(x => x.inlineRect[0])),
				Math.min(...wordChars.map(x => x.inlineRect[1])),
				Math.max(...wordChars.map(x => x.inlineRect[2])),
				Math.max(...wordChars.map(x => x.inlineRect[3])),
			];
			let distance = rectsDist(rect, wordRect);
			if (closestWordDistance === null || distance < closestWordDistance) {
				closestWordDistance = distance;
				closestWordStart = start;
				closestWordEnd = end;
			}
			start = end + 1;
		}
	}
	return {
		anchorOffset: closestWordStart,
		headOffset: closestWordEnd + 1
	};
}

function getClosestLine(chars, rect) {
	let closestLineStart;
	let closestLineEnd;
	let closestLineDistance = null;
	let start = 0;
	for (let i = 0; i < chars.length; i++) {
		let char = chars[i];
		if (char.lineBreakAfter) {
			let end = i;
			let lineChars = chars.slice(start, end + 1);
			let lineRect = [
				Math.min(...lineChars.map(x => x.inlineRect[0])),
				Math.min(...lineChars.map(x => x.inlineRect[1])),
				Math.max(...lineChars.map(x => x.inlineRect[2])),
				Math.max(...lineChars.map(x => x.inlineRect[3])),
			];
			let distance = rectsDist(rect, lineRect);
			if (closestLineDistance === null || distance < closestLineDistance) {
				closestLineDistance = distance;
				closestLineStart = start;
				closestLineEnd = end;
			}
			start = end + 1;
		}
	}
	return {
		anchorOffset: closestLineStart,
		headOffset: closestLineEnd + 1
	};
}

export function extractRange({ chars, pageIndex, anchor, head, reverse }) {
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

export function extractRangeByRects({ chars, pageIndex, rects }) {
	let range = getRangeByHighlight(chars, rects);
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

function getTopMostRectFromPosition(position) {
	// Sort the rectangles based on their y2 value in descending order and return the first one
	return position?.rects?.slice().sort((a, b) => b[2] - a[2])[0];
}

export function getSortIndex(pdfPages, position) {
	let { pageIndex } = position;
	let offset = 0;
	let top = 0;
	if (pdfPages[position.pageIndex]) {
		let { chars } = pdfPages[position.pageIndex];
		let viewBox = pdfPages[position.pageIndex].viewBox;
		let rect = getTopMostRectFromPosition(position) || getPositionBoundingRect(position);
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
		if (head.offset === 0) {
			if (pdfPages[head.pageIndex - 1]) {
				let { chars } = pdfPages[head.pageIndex - 1];
				if (chars.length) {
					head.pageIndex--;
					head.offset = chars.length - 1;
				}
			}
		}
		else {
			head.offset--;
		}
	}
	else if (modifier === 'right') {
		let { chars } = pdfPages[head.pageIndex];
		if (head.offset === chars.length) {
			if (pdfPages[head.pageIndex + 1]) {
				let { chars } = pdfPages[head.pageIndex + 1];
				if (chars.length) {
					head.pageIndex++;
					head.offset = 1;
				}
			}
		}
		else {
			head.offset++;
		}
	}
	else if (modifier === 'up') {
		if (head.offset === 0) {
			if (pdfPages[head.pageIndex - 1]) {
				let { chars } = pdfPages[head.pageIndex - 1];
				if (chars.length) {
					head.pageIndex--;
					head.offset = chars.length - 1;
				}
			}
		}
		else {
			let { chars } = pdfPages[head.pageIndex];
			let offset = getPrevLineClosestOffset(chars, head.offset);
			if (offset !== null) {
				head.offset = offset;
			}
		}
	}
	else if (modifier === 'down') {
		let { chars } = pdfPages[head.pageIndex];
		if (head.offset === chars.length) {
			if (pdfPages[head.pageIndex + 1]) {
				let { chars } = pdfPages[head.pageIndex + 1];
				if (chars.length) {
					head.pageIndex++;
					head.offset = 1;
				}
			}
		}
		else {
			let offset = getNextLineClosestOffset(chars, head.offset);
			if (offset !== null) {
				head.offset = offset;
			}
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
	let { chars } = pdfPages[anchorPosition.pageIndex];
	let anchorWord = getClosestWord(chars, anchorPosition.rects[0]);
	chars = pdfPages[headPosition.pageIndex].chars;
	let headWord = getClosestWord(chars, headPosition.rects[0]);
	if (!anchorWord || !headWord) {
		return [];
	}
	let anchor = { pageIndex: anchorPosition.pageIndex };
	let head = { pageIndex: headPosition.pageIndex };
	if (anchorWord.anchorOffset <= headWord.anchorOffset && anchor.pageIndex === head.pageIndex
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
	let { chars } = pdfPages[anchorPosition.pageIndex];
	let anchorLine = getClosestLine(chars, anchorPosition.rects[0]);
	chars = pdfPages[headPosition.pageIndex].chars;
	let headLine = getClosestLine(chars, headPosition.rects[0]);
	if (!anchorLine || !headLine) {
		return [];
	}
	let anchor = { pageIndex: anchorPosition.pageIndex };
	let head = { pageIndex: headPosition.pageIndex };
	if (anchorLine.anchorOffset <= headLine.anchorOffset && anchor.pageIndex === head.pageIndex
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

// Extract character array from given selectionRanges and pdfPages
export function getCharsFromSelectionRanges(pdfPages, selectionRanges) {
	const charsArray = [];

	// Iterate over each selectionRange to directly access characters
	selectionRanges.forEach(selection => {
		const pageIndex = selection.position.pageIndex;
		const page = pdfPages[pageIndex];

		if (!page) return; // Skip if page is not available

		let { chars } = page;

		// Calculate character range based on anchor and head offsets
		const anchorOffset = selection.anchorOffset;
		const headOffset = selection.headOffset;
		const start = Math.min(anchorOffset, headOffset);
		const end = Math.max(anchorOffset, headOffset);

		// Retrieve characters from the calculated range
		charsArray.push(...chars.slice(start, end));
	});

	return charsArray;
}

function applySelectionRangeIsolation(pdfPages, selectionRanges) {
	if (!selectionRanges.length) {
		return [];
	}
	if (selectionRanges[0].collapsed === true) {
		return selectionRanges;
	}

	let chars = getCharsFromSelectionRanges(pdfPages, selectionRanges);
	let isolated;

	let start;
	if (selectionRanges[0].anchor) {
		if (selectionRanges[0].head) {
			start = selectionRanges[0].anchorOffset < selectionRanges[0].headOffset;
		}
		else {
			start = true;
		}
	}
	else {
		start = selectionRanges.at(-1).anchorOffset < selectionRanges.at(-1).headOffset;
	}

	if (start) {
		isolated = !!chars[0].isolated;
	}
	else {
		isolated = !!chars.at(-1).isolated;
	}

	if (isolated) {
		chars = chars.filter(x => x.isolated);
	}
	else {
		chars = chars.filter(x => !x.isolated);

	}

	if (chars.length === 0) return [];

	let reversed = selectionRanges[0].headOffset < selectionRanges[0].anchorOffset;

	selectionRanges = [];
	let currentRange = {
		pageIndex: chars[0].pageIndex,
		anchorOffset: chars[0].offset,
		headOffset: chars[0].offset
	};

	for (let i = 0; i < chars.length; i++) {
		const char = chars[i];

		if (char.pageIndex !== currentRange.pageIndex) {
			// Finish the current range and add it to the array
			selectionRanges.push(currentRange);

			// Start a new range
			currentRange = {
				pageIndex: char.pageIndex,
				anchorOffset: char.offset,
				headOffset: char.offset + 1
			};
		} else {
			// Extend the current range
			currentRange.headOffset = char.offset + 1;
		}
	}

	// Add the last range after the loop
	selectionRanges.push(currentRange);

	if (reversed) {
		for (let selectionRange of selectionRanges) {
			let tmp = selectionRange.anchorOffset;
			selectionRange.anchorOffset = selectionRange.headOffset;
			selectionRange.headOffset = tmp;
		}
	}

	if (selectionRanges.length === 1) {
		selectionRanges[0].anchor = true;
		selectionRanges[0].head = true;
	}
	else {
		if (start) {
			selectionRanges[0].anchor = true;
			selectionRanges.at(-1).head = true;
		}
		else {
			selectionRanges.at(-1).anchor = true;
			selectionRanges[0].head = true;
		}
	}

	for (let selectionRange of selectionRanges) {
		let { chars } = pdfPages[selectionRange.pageIndex];
		let from = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
		let to = Math.max(selectionRange.anchorOffset, selectionRange.headOffset);
		let rects = getRectsFromChars(chars.slice(from, to));
		selectionRange.position = {
			pageIndex: selectionRange.pageIndex,
			rects
		};
		selectionRange.sortIndex = getSortIndex(pdfPages, selectionRange.position);
		selectionRange.text = getTextFromChars(chars.slice(from, to));
		if (selectionRange.anchorOffset === selectionRange.headOffset) {
			selectionRange.collapsed = true;
		}
	}

	return selectionRanges;
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

		let { chars } = pdfPages[i];
		let selectionRange = extractRange({
			chars,
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
	return applySelectionRangeIsolation(pdfPages, selectionRanges);
}

export function getSelectionRangesByPosition(pdfPages, position) {
	if (!pdfPages[position.pageIndex]) {
		return [];
	}
	let { chars } = pdfPages[position.pageIndex];
	let selectionRanges = [];
	let selectionRange = extractRangeByRects({
		chars,
		pageIndex: position.pageIndex,
		rects: position.rects
	});
	if (!selectionRange) {
		return [];
	}

	selectionRanges = [selectionRange];

	if (position.nextPageRects) {
		let { chars } = pdfPages[position.pageIndex + 1];
		selectionRange = extractRangeByRects({
			chars,
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

export function getTextFromSelectionRanges(selectionRanges) {
	if (!selectionRanges.length || selectionRanges[0].collapsed) {
		return '';
	}
	return selectionRanges.map(x => x.text).join('\n');
}

function getMostCommonValue(arr) {
	let counts = arr.reduce((a, b) => ({ ...a, [b]: (a[b] || 0) + 1 }), {});
	return +Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

export function getRectRotationOnText(chars, rect) {
	let chars2 = [];
	for (let char of chars) {
		if (quickIntersectRect(getCenterRect(char.rect), rect)) {
			chars2.push(char);
		}
	}
	if (!chars2.length) {
		return 0;
	}
	// Get the most common rotation
	return getMostCommonValue(chars2.map(x => x.rotation));
}

// Based on https://stackoverflow.com/a/16100733

export function getNodeOffset(container, offset) {
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
			// Check for the last character
			if (offset === charIndex2) {
				return { node, offset: charIndex };
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
