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

function _getClosestOffset(chars, rect) {
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

let isNum = c => c >= '0' && c <= '9';

function getSurroundedNumber(chars, idx) {
	while (
		idx > 0 && isNum(chars[idx - 1].c)
		&& Math.abs(chars[idx].rect[0] - chars[idx - 1].rect[2]) < chars[idx].rect[2] - chars[idx].rect[0]
		&& Math.abs(chars[idx - 1].rect[1] - chars[idx].rect[1]) < 2
		) {
		idx--;
	}

	let str = chars[idx].c;

	while (
		idx < chars.length - 1 && isNum(chars[idx + 1].c)
		&& Math.abs(chars[idx + 1].rect[0] - chars[idx].rect[2]) < chars[idx + 1].rect[2] - chars[idx + 1].rect[0]
		&& Math.abs(chars[idx].rect[1] - chars[idx + 1].rect[1]) < 2
		) {
		idx++;
		str += chars[idx].c;
	}

	return parseInt(str);
}

function getSurroundedNumberAtPos(chars, x, y) {
	for (let i = 0; i < chars.length; i++) {
		let ch = chars[i];
		let { x: x2, y: y2 } = getRectCenter(ch.rect);
		if (isNum(ch.c) && Math.abs(x - x2) < 10 && Math.abs(y - y2) < 5) {
			return getSurroundedNumber(chars, i);
		}
	}
	return null;
}

function getRectCenter(rect) {
	return {
		x: rect[0] + (rect[2] - rect[0]) / 2,
		y: rect[1] + (rect[3] - rect[1]) / 2
	};
}

function filterNums(chars, pageHeight) {
	return chars.filter(x => x.c >= '0' && x.c <= '9' && (x.rect[3] < pageHeight * 1 / 5 || x.rect[1] > pageHeight * 4 / 5));
}

function _getPageLabelPoints(pageIndex, chars1, chars2, chars3, chars4, pageHeight) {
	let charsNum1 = filterNums(chars1, pageHeight);
	let charsNum2 = filterNums(chars2, pageHeight);
	let charsNum3 = filterNums(chars3, pageHeight);
	let charsNum4 = filterNums(chars4, pageHeight);

	// Cut off the logic if one of the pages has too many digits
	if ([charsNum1, charsNum2, charsNum3, charsNum4].find(x => x.length > 500)) {
		return null;
	}

	for (let c1 = 0; c1 < charsNum1.length; c1++) {
		let ch1 = charsNum1[c1];
		for (let c3 = 0; c3 < charsNum3.length; c3++) {
			let ch3 = charsNum3[c3];
			let { x: x1, y: y1 } = getRectCenter(ch1.rect);
			let { x: x2, y: y2 } = getRectCenter(ch3.rect);
			if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
				let num1 = getSurroundedNumber(charsNum1, c1);
				let num3 = getSurroundedNumber(charsNum3, c3);
				if (num1 && num1 + 2 === num3) {
					let pos1 = { x: x1, y: y1, num: num1, idx: pageIndex };

					let extractedNum2 = getSurroundedNumberAtPos(chars2, x1, y1);
					if (num1 + 1 === extractedNum2) {
						return [pos1];
					}

					for (let c2 = 0; c2 < charsNum2.length; c2++) {
						let ch2 = charsNum2[c2];
						for (let c4 = 0; c4 < charsNum4.length; c4++) {
							let ch4 = charsNum4[c4];
							let { x: x1, y: y1 } = getRectCenter(ch2.rect);
							let { x: x2, y: y2 } = getRectCenter(ch4.rect);
							if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
								let num2 = getSurroundedNumber(charsNum2, c2);
								let num4 = getSurroundedNumber(charsNum4, c4);
								if (num1 + 1 === num2 && num2 + 2 === num4) {
									let pos2 = { x: x1, y: y1, num: num2, idx: pageIndex + 2 };
									return [pos1, pos2];
								}
							}
						}
					}
				}
			}
		}
	}

	return null;
}

function _getPageLabel(pageIndex, charsPrev, charsCur, charsNext, points) {
	let numPrev, numCur, numNext;

	// TODO: Instead of trying to extract from two positions, try to
	//  guess the right position by determining whether the page is even or odd

	// TODO: Take into account font parameters when comparing extracted numbers
	let getNum = (charsNext, points) => points.length > 0 && getSurroundedNumberAtPos(charsNext, points[0].x, points[0].y)
		|| points.length > 1 && getSurroundedNumberAtPos(charsNext, points[1].x, points[1].y);

	if (charsPrev) {
		numPrev = getNum(charsPrev, points);
	}

	numCur = getNum(charsCur, points);

	if (charsNext) {
		numNext = getNum(charsNext, points);
	}

	if (numCur && (numCur - 1 === numPrev || numCur + 1 === numNext)) {
		return numCur.toString();
	}

	if (pageIndex < points[0].idx) {
		return (points[0].num - (points[0].idx - pageIndex)).toString();
	}

	return null;
}

// The function is adapted from Xpdf https://www.xpdfreader.com/opensource.html
// Original copyright: 1996-2019 Glyph & Cog, LLC.
function computeWordSpacingThreshold(chars, vertical) {
	// Inter-character spacing that varies by less than this multiple of
	// font size is assumed to be equivalent.
	const uniformSpacing = 0.07;
	// Typical word spacing, as a fraction of font size.  This will be
	// added to the minimum inter-character spacing, to account for wide
	// character spacing.
	const wordSpacing = 0.1;
	// Compute the inter-word spacing threshold for a line of chars.
	// Spaces greater than this threshold will be considered inter-word
	// spaces.

	let char, char2;
	let avgFontSize;
	let minAdjGap, maxAdjGap, minSpGap, maxSpGap, minGap, maxGap, gap, gap2;
	let i;

	avgFontSize = 0;
	minGap = maxGap = 0;
	minAdjGap = minSpGap = 1;
	maxAdjGap = maxSpGap = 0;
	for (i = 0; i < chars.length; ++i) {
		char = chars[i];
		avgFontSize += char.fontSize;
		if (i < chars.length - 1) {
			char2 = chars[i + 1];
			gap = vertical ? (char2.rect[1] - char.rect[3]) : (char2.rect[0] - char.rect[2]);
			if (char.spaceAfter) {
				if (minSpGap > maxSpGap) {
					minSpGap = maxSpGap = gap;
				}
				else if (gap < minSpGap) {
					minSpGap = gap;
				}
				else if (gap > maxSpGap) {
					maxSpGap = gap;
				}
			}
			else if (minAdjGap > maxAdjGap) {
				minAdjGap = maxAdjGap = gap;
			}
			else if (gap < minAdjGap) {
				minAdjGap = gap;
			}
			else if (gap > maxAdjGap) {
				maxAdjGap = gap;
			}
			if (i == 0 || gap < minGap) {
				minGap = gap;
			}
			if (gap > maxGap) {
				maxGap = gap;
			}
		}
	}
	avgFontSize /= chars.length;
	if (minGap < 0) {
		minGap = 0;
	}

	// if spacing is nearly uniform (minGap is close to maxGap), use the
	// SpGap/AdjGap values if available, otherwise assume it's a single
	// word (technically it could be either "ABC" or "A B C", but it's
	// essentially impossible to tell)
	if (maxGap - minGap < uniformSpacing * avgFontSize) {
		if (minAdjGap <= maxAdjGap
			&& minSpGap <= maxSpGap
			&& minSpGap - maxAdjGap > 0.01) {
			return 0.5 * (maxAdjGap + minSpGap);
		}
		else {
			return maxGap + 1;
		}

		// if there is some variation in spacing, but it's small, assume
		// there are some inter-word spaces
	}
	else if (maxGap - minGap < wordSpacing * avgFontSize) {
		return 0.5 * (minGap + maxGap);

		// if there is a large variation in spacing, use the SpGap/AdjGap
		// values if they look reasonable, otherwise, assume a reasonable
		// threshold for inter-word spacing (we can't use something like
		// 0.5*(minGap+maxGap) here because there can be outliers at the
		// high end)
	}
	else if (minAdjGap <= maxAdjGap
		&& minSpGap <= maxSpGap
		&& minSpGap - maxAdjGap > uniformSpacing * avgFontSize) {
		gap = wordSpacing * avgFontSize;
		gap2 = 0.5 * (minSpGap - minGap);
		return minGap + (gap < gap2 ? gap : gap2);
	}
	else {
		return minGap + wordSpacing * avgFontSize;
	}
}

function overlaps(char1, char2) {
	if ([0, 180].includes(char1.rotation)) {
		return (char1.rect[1] <= char2.rect[1] && char2.rect[1] <= char1.rect[3]
			|| char2.rect[1] <= char1.rect[1] && char1.rect[1] <= char2.rect[3]);
	}
	return (
		char1.rect[0] <= char2.rect[0] && char2.rect[0] <= char1.rect[2]
		|| char2.rect[0] <= char1.rect[0] && char1.rect[0] <= char2.rect[2]
	);
}

function charHeight(char) {
	return (!char.rotation && char.rect[3] - char.rect[1]
		|| char.rotation === 90 && char.rect[2] - char.rect[0]
		|| char.rotation === 180 && char.rect[1] - char.rect[3]
		|| char.rotation === 270 && char.rect[0] - char.rect[2]);
}

function getLines(chars) {
	let lines = [];
	let line = {
		offset: 0,
		chars: [chars[0]],
		vertical: [90, 270].includes(chars[0].rotation)
	};
	for (let i = 1; i < chars.length; i++) {
		let char = chars[i];
		let prevChar = line.chars[line.chars.length - 1];
		if (
			// Caret jumps to the next line start
			!char.rotation && prevChar.rect[0] > char.rect[0]
			|| char.rotation === 90 && prevChar.rect[1] > char.rect[1]
			|| char.rotation === 180 && prevChar.rect[0] < char.rect[0]
			|| char.rotation === 270 && prevChar.rect[1] < char.rect[1]
			// Rotation changes
			|| prevChar.rotation !== char.rotation
			// Chars aren't in the same line
			|| !overlaps(prevChar, char)
			// Line's first char is more than 2x larger than the following char
			|| line.chars.length === 1 && charHeight(prevChar) > charHeight(char) * 2
		) {
			lines.push(line);
			line = { offset: i, chars: [char], vertical: [90, 270].includes(char.rotation) };
		}
		else {
			line.chars.push(char);
		}
	}
	// Push last line
	if (line.chars.length) {
		lines.push(line);
	}
	// Calculate line bounding rect
	for (let line of lines) {
		line.rect = line.chars[0].rect.slice();
		for (let char of line.chars) {
			line.rect[0] = Math.min(line.rect[0], char.rect[0]);
			line.rect[1] = Math.min(line.rect[1], char.rect[1]);
			line.rect[2] = Math.max(line.rect[2], char.rect[2]);
			line.rect[3] = Math.max(line.rect[3], char.rect[3]);
		}
	}
	for (let line of lines) {
		line.words = [];
		let wordSp = computeWordSpacingThreshold(line.chars, line.vertical);
		let i = 0;
		while (i < line.chars.length) {
			let sp = wordSp - 1;
			let spaceAfter = false;
			let j;
			for (j = i + 1; j < line.chars.length; ++j) {
				let char = line.chars[j - 1];
				let char2 = line.chars[j];
				sp = line.vertical ? (char2.rect[1] - char.rect[3]) : (char2.rect[0] - char.rect[2]);
				if (sp > wordSp) {
					spaceAfter = true;
					break;
				}
			}
			line.words.push({ offset: line.offset + i, chars: line.chars.slice(i, j), spaceAfter });
			i = j;
		}
	}
	return lines;
}

function isDash(c) {
	let re = /[\x2D\u058A\u05BE\u1400\u1806\u2010-\u2015\u2E17\u2E1A\u2E3A\u2E3B\u301C\u3030\u30A0\uFE31\uFE32\uFE58\uFE63\uFF0D]/;
	return re.test(c);
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

function _getRangeBySelection({ chars, anchor, head, reverse }) {
	// Note: Offsets can be between 0 and chars.length (the cursor can after the last char)
	if (!chars.length) {
		return null;
	}
	let anchorOffset = reverse ? chars.length - 1 : 0;
	let headOffset = reverse ? 0 : chars.length - 1;
	let x1, y1, x2, y2;
	if (Number.isInteger(anchor)) {
		anchorOffset = anchor;
		anchorOffset = anchorOffset < 0 ? 0 : anchorOffset;
		anchorOffset = anchorOffset > chars.length ? chars.length : anchorOffset;
	}
	else if (Array.isArray(anchor)) {
		[x1, y1] = anchor;
		anchorOffset = _getClosestOffset(chars, [x1, y1, x1, y1]);
	}
	if (Number.isInteger(head)) {
		headOffset = head;
		headOffset = headOffset < 0 ? 0 : headOffset;
		headOffset = headOffset > chars.length ? chars.length : headOffset;
	}
	else if (Array.isArray(head)) {
		[x2, y2] = head;
		headOffset = _getClosestOffset(chars, [x2, y2, x2, y2]);
	}
	if (Array.isArray(anchor)) {
		let { rotation, rect } = chars[anchorOffset];
		if (!rotation && x1 > rect[0] + (rect[2] - rect[0]) / 2
			|| rotation === 90 && y1 > rect[1] + (rect[3] - rect[1]) / 2
			|| rotation === 180 && x1 < rect[0] + (rect[2] - rect[0]) / 2
			|| rotation === 270 && y1 < rect[1] + (rect[3] - rect[1]) / 2) {
			anchorOffset++;
		}
	}
	if (Array.isArray(head)) {
		let { rotation, rect } = chars[headOffset];
		if (!rotation && x2 > rect[0] + (rect[2] - rect[0]) / 2
			|| rotation === 90 && y2 > rect[1] + (rect[3] - rect[1]) / 2
			|| rotation === 180 && x2 < rect[0] + (rect[2] - rect[0]) / 2
			|| rotation === 270 && y2 < rect[1] + (rect[3] - rect[1]) / 2) {
			headOffset++;
		}
	}

	return getRange(chars, anchorOffset, headOffset);
}

function _getRangeByHighlight(chars, rects) {
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
	delete range.anchorOffset;
	delete range.headOffset;
	return range;
}

function getLineSelectionRect(line, charFrom, charTo) {
	if (line.vertical) {
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

function getRange(chars, anchorOffset, headOffset) {
	let lines = getLines(chars);
	let charStart;
	let charEnd;
	if (anchorOffset < headOffset) {
		charStart = chars[anchorOffset];
		charEnd = chars[headOffset - 1];
	}
	else if (anchorOffset > headOffset) {
		charStart = chars[headOffset];
		charEnd = chars[anchorOffset - 1];
	}
	else {
		return { collapsed: true, anchorOffset, headOffset, rects: [], text: '' };
	}

	// Get text
	let text = '';
	let extracting = false;

	loop1: for (let line of lines) {
		for (let word of line.words) {
			let isLastWord = word === line.words[line.words.length - 1];
			for (let char of word.chars) {
				let isLastChar = char === word.chars[word.chars.length - 1];
				if (char === charStart) {
					extracting = true;
				}
				if (!extracting || isLastWord && isLastChar && isDash(char.c) && char !== charEnd) {
					continue;
				}
				text += char.c;
				if (isLastChar
					&& (word.spaceAfter || isLastWord)
					&& text[text.length - 1] !== ' ') {
					text += ' ';
				}
				if (char === charEnd) {
					break loop1;
				}
			}
		}
	}
	text = text.trim();
	// Get rects
	extracting = false;
	let rects = [];
	loop2: for (let line of lines) {
		let charFrom = null;
		let charTo = null;
		for (let word of line.words) {
			for (let char of word.chars) {
				if (char === charStart || extracting && !charFrom) {
					extracting = true;
					charFrom = char;
				}
				if (extracting) {
					charTo = char;
					if (char === charEnd) {
						rects.push(getLineSelectionRect(line, charFrom, charTo));
						break loop2;
					}
				}
			}
		}
		if (extracting) {
			rects.push(getLineSelectionRect(line, charFrom, charTo));
			charFrom = null;
		}
	}
	rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
	return { anchorOffset, headOffset, rects, text };
}

function _getNextLineClosestOffset(chars, offset) {
	if (!chars.length) {
		return null;
	}
	if (offset < 0) {
		offset = 0;
	}
	else if (offset >= chars.length) {
		offset = chars.length - 1;
	}
	let lines = getLines(chars);
	let char = chars[offset];
	let idx = lines.findIndex(line => line.chars.includes(char));
	if (idx < lines.length - 1) {
		let line = lines[idx + 1];
		return line.offset + getClosestOffset(line.chars, char.rect);
	}
	return chars.length;
}

function _getPrevLineClosestOffset(chars, offset) {
	if (!chars.length) {
		return null;
	}
	if (offset < 0) {
		offset = 0;
	}
	else if (offset >= chars.length) {
		offset = chars.length - 1;
	}
	let lines = getLines(chars);
	let char = chars[offset];
	let idx = lines.findIndex(line => line.chars.includes(char));
	if (idx > 0) {
		let line = lines[idx - 1];
		return line.offset + _getClosestOffset(line.chars, char.rect);
	}
	return 0;
}

function _getClosestWord(chars, rect) {
	if (!chars.length) {
		return null;
	}
	let lines = getLines(chars);
	let offset = _getClosestOffset(chars, rect);
	let char = chars[offset];
	let line = lines.find(line => line.chars.includes(char));
	let word = line.words.find(word => word.chars.includes(char));
	return { anchorOffset: word.offset, headOffset: word.offset + word.chars.length };
}

function _getClosestLine(chars, rect) {
	if (!chars.length) {
		return null;
	}
	let lines = getLines(chars);
	let offset = _getClosestOffset(chars, rect);
	let char = chars[offset];
	let line = lines.find(line => line.chars.includes(char));
	return { anchorOffset: line.offset, headOffset: line.offset + line.chars.length };
}

export let getClosestOffset = _getClosestOffset;
export let getPageLabelPoints = _getPageLabelPoints;
export let getPageLabel = _getPageLabel;
export let getRangeBySelection = _getRangeBySelection;
export let getNextLineClosestOffset = _getNextLineClosestOffset;
export let getPrevLineClosestOffset = _getPrevLineClosestOffset;
export let getClosestWord = _getClosestWord;
export let getClosestLine = _getClosestLine;

// module.exports = {
// 	getClosestOffset: _getClosestOffset,
// 	getPageLabelPoints: _getPageLabelPoints,
// 	getPageLabel: _getPageLabel,
// 	getRangeByHighlight: _getRangeByHighlight
// };
