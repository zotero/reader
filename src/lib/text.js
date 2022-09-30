
// *** bidi.js starts here ***
// This is taken from PDF.js source https://github.com/mozilla/pdf.js/blob/9416b14e8b06a39a1a57f2baf22aebab2370edeb/src/core/bidi.js

/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Character types for symbols from 0000 to 00FF.
// Source: ftp://ftp.unicode.org/Public/UNIDATA/UnicodeData.txt
// prettier-ignore
const baseTypes = [
	"BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "S", "B", "S",
	"WS", "B", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN",
	"BN", "BN", "BN", "BN", "B", "B", "B", "S", "WS", "ON", "ON", "ET",
	"ET", "ET", "ON", "ON", "ON", "ON", "ON", "ES", "CS", "ES", "CS", "CS",
	"EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "CS", "ON",
	"ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "L", "L", "L", "ON", "ON", "ON", "ON", "ON", "ON", "L", "L", "L",
	"L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "L", "L", "L", "L", "L", "L", "L", "L", "ON", "ON", "ON", "ON",
	"BN", "BN", "BN", "BN", "BN", "BN", "B", "BN", "BN", "BN", "BN", "BN",
	"BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN",
	"BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "CS", "ON", "ET",
	"ET", "ET", "ET", "ON", "ON", "ON", "ON", "L", "ON", "ON", "BN", "ON",
	"ON", "ET", "ET", "EN", "EN", "ON", "L", "ON", "ON", "ON", "EN", "L",
	"ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "ON", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
	"L", "L", "L", "L", "L", "ON", "L", "L", "L", "L", "L", "L", "L", "L"
];

// Character types for symbols from 0600 to 06FF.
// Source: ftp://ftp.unicode.org/Public/UNIDATA/UnicodeData.txt
// Note that 061D does not exist in the Unicode standard (see
// http://unicode.org/charts/PDF/U0600.pdf), so we replace it with an
// empty string and issue a warning if we encounter this character. The
// empty string is required to properly index the items after it.
// prettier-ignore
const arabicTypes = [
	"AN", "AN", "AN", "AN", "AN", "AN", "ON", "ON", "AL", "ET", "ET", "AL",
	"CS", "AL", "ON", "ON", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM",
	"NSM", "NSM", "NSM", "NSM", "AL", "AL", "", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM",
	"NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM",
	"NSM", "NSM", "NSM", "NSM", "AN", "AN", "AN", "AN", "AN", "AN", "AN",
	"AN", "AN", "AN", "ET", "AN", "AN", "AL", "AL", "AL", "NSM", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
	"AL", "AL", "AL", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AN",
	"ON", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "NSM", "NSM",
	"ON", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "EN", "EN", "EN", "EN",
	"EN", "EN", "EN", "EN", "EN", "EN", "AL", "AL", "AL", "AL", "AL", "AL"
];

function isOdd(i) {
	return (i & 1) !== 0;
}

function isEven(i) {
	return (i & 1) === 0;
}

function findUnequal(arr, start, value) {
	let j, jj;
	for (j = start, jj = arr.length; j < jj; ++j) {
		if (arr[j] !== value) {
			return j;
		}
	}
	return j;
}

function setValues(arr, start, end, value) {
	for (let j = start; j < end; ++j) {
		arr[j] = value;
	}
}

function reverseValues(arr, start, end) {
	for (let i = start, j = end - 1; i < j; ++i, --j) {
		const temp = arr[i];
		arr[i] = arr[j];
		arr[j] = temp;
	}
}

function createBidiText(chars, isLTR, vertical = false) {
	let dir = "ltr";
	if (vertical) {
		dir = "ttb";
	}
	else if (!isLTR) {
		dir = "rtl";
	}
	return { chars, dir };
}

// These are used in bidi(), which is called frequently. We re-use them on
// each call to avoid unnecessary allocations.
const chars = [];
const types = [];

function bidi(chars, startLevel = -1, vertical = false) {
	let isLTR = true;
	const strLength = chars.length;
	if (strLength === 0 || vertical) {
		return createBidiText(chars, isLTR, vertical);
	}

	// Get types and fill arrays
	types.length = strLength;
	let numBidi = 0;

	let i, ii;
	for (i = 0; i < strLength; ++i) {

		const charCode = chars[i].c.charCodeAt(0);
		let charType = "L";
		if (charCode <= 0x00ff) {
			charType = baseTypes[charCode];
		}
		else if (0x0590 <= charCode && charCode <= 0x05f4) {
			charType = "R";
		}
		else if (0x0600 <= charCode && charCode <= 0x06ff) {
			charType = arabicTypes[charCode & 0xff];
			if (!charType) {
				console.log("Bidi: invalid Unicode character " + charCode.toString(16));
			}
		}
		else if (0x0700 <= charCode && charCode <= 0x08ac) {
			charType = "AL";
		}
		if (charType === "R" || charType === "AL" || charType === "AN") {
			numBidi++;
		}
		types[i] = charType;
	}

	// Detect the bidi method
	// - If there are no rtl characters then no bidi needed
	// - If less than 30% chars are rtl then string is primarily ltr,
	//   unless the string is very short.
	// - If more than 30% chars are rtl then string is primarily rtl
	if (numBidi === 0) {
		isLTR = true;
		return createBidiText(chars, isLTR);
	}

	if (startLevel === -1) {
		if (numBidi / strLength < 0.3 && strLength > 4) {
			isLTR = true;
			startLevel = 0;
		}
		else {
			isLTR = false;
			startLevel = 1;
		}
	}

	const levels = [];
	for (i = 0; i < strLength; ++i) {
		levels[i] = startLevel;
	}

	/*
	 X1-X10: skip most of this, since we are NOT doing the embeddings.
	 */
	const e = isOdd(startLevel) ? "R" : "L";
	const sor = e;
	const eor = sor;

	/*
	 W1. Examine each non-spacing mark (NSM) in the level run, and change the
	 type of the NSM to the type of the previous character. If the NSM is at the
	 start of the level run, it will get the type of sor.
	 */
	let lastType = sor;
	for (i = 0; i < strLength; ++i) {
		if (types[i] === "NSM") {
			types[i] = lastType;
		}
		else {
			lastType = types[i];
		}
	}

	/*
	 W2. Search backwards from each instance of a European number until the
	 first strong type (R, L, AL, or sor) is found.  If an AL is found, change
	 the type of the European number to Arabic number.
	 */
	lastType = sor;
	let t;
	for (i = 0; i < strLength; ++i) {
		t = types[i];
		if (t === "EN") {
			types[i] = lastType === "AL" ? "AN" : "EN";
		}
		else if (t === "R" || t === "L" || t === "AL") {
			lastType = t;
		}
	}

	/*
	 W3. Change all ALs to R.
	 */
	for (i = 0; i < strLength; ++i) {
		t = types[i];
		if (t === "AL") {
			types[i] = "R";
		}
	}

	/*
	 W4. A single European separator between two European numbers changes to a
	 European number. A single common separator between two numbers of the same
	 type changes to that type:
	 */
	for (i = 1; i < strLength - 1; ++i) {
		if (types[i] === "ES" && types[i - 1] === "EN" && types[i + 1] === "EN") {
			types[i] = "EN";
		}
		if (
			types[i] === "CS" &&
			(types[i - 1] === "EN" || types[i - 1] === "AN") &&
			types[i + 1] === types[i - 1]
		) {
			types[i] = types[i - 1];
		}
	}

	/*
	 W5. A sequence of European terminators adjacent to European numbers changes
	 to all European numbers:
	 */
	for (i = 0; i < strLength; ++i) {
		if (types[i] === "EN") {
			// do before
			for (let j = i - 1; j >= 0; --j) {
				if (types[j] !== "ET") {
					break;
				}
				types[j] = "EN";
			}
			// do after
			for (let j = i + 1; j < strLength; ++j) {
				if (types[j] !== "ET") {
					break;
				}
				types[j] = "EN";
			}
		}
	}

	/*
	 W6. Otherwise, separators and terminators change to Other Neutral:
	 */
	for (i = 0; i < strLength; ++i) {
		t = types[i];
		if (t === "WS" || t === "ES" || t === "ET" || t === "CS") {
			types[i] = "ON";
		}
	}

	/*
	 W7. Search backwards from each instance of a European number until the
	 first strong type (R, L, or sor) is found. If an L is found,  then change
	 the type of the European number to L.
	 */
	lastType = sor;
	for (i = 0; i < strLength; ++i) {
		t = types[i];
		if (t === "EN") {
			types[i] = lastType === "L" ? "L" : "EN";
		}
		else if (t === "R" || t === "L") {
			lastType = t;
		}
	}

	/*
	 N1. A sequence of neutrals takes the direction of the surrounding strong
	 text if the text on both sides has the same direction. European and Arabic
	 numbers are treated as though they were R. Start-of-level-run (sor) and
	 end-of-level-run (eor) are used at level run boundaries.
	 */
	for (i = 0; i < strLength; ++i) {
		if (types[i] === "ON") {
			const end = findUnequal(types, i + 1, "ON");
			let before = sor;
			if (i > 0) {
				before = types[i - 1];
			}

			let after = eor;
			if (end + 1 < strLength) {
				after = types[end + 1];
			}
			if (before !== "L") {
				before = "R";
			}
			if (after !== "L") {
				after = "R";
			}
			if (before === after) {
				setValues(types, i, end, before);
			}
			i = end - 1; // reset to end (-1 so next iteration is ok)
		}
	}

	/*
	 N2. Any remaining neutrals take the embedding direction.
	 */
	for (i = 0; i < strLength; ++i) {
		if (types[i] === "ON") {
			types[i] = e;
		}
	}

	/*
	 I1. For all characters with an even (left-to-right) embedding direction,
	 those of type R go up one level and those of type AN or EN go up two
	 levels.
	 I2. For all characters with an odd (right-to-left) embedding direction,
	 those of type L, EN or AN go up one level.
	 */
	for (i = 0; i < strLength; ++i) {
		t = types[i];
		if (isEven(levels[i])) {
			if (t === "R") {
				levels[i] += 1;
			}
			else if (t === "AN" || t === "EN") {
				levels[i] += 2;
			}
		}
		else {
			// isOdd
			if (t === "L" || t === "AN" || t === "EN") {
				levels[i] += 1;
			}
		}
	}

	/*
	 L1. On each line, reset the embedding level of the following characters to
	 the paragraph embedding level:

	 segment separators,
	 paragraph separators,
	 any sequence of whitespace characters preceding a segment separator or
	 paragraph separator, and any sequence of white space characters at the end
	 of the line.
	 */

	// don't bother as text is only single line

	/*
	 L2. From the highest level found in the text to the lowest odd level on
	 each line, reverse any contiguous sequence of characters that are at that
	 level or higher.
	 */

	// find highest level & lowest odd level
	let highestLevel = -1;
	let lowestOddLevel = 99;
	let level;
	for (i = 0, ii = levels.length; i < ii; ++i) {
		level = levels[i];
		if (highestLevel < level) {
			highestLevel = level;
		}
		if (lowestOddLevel > level && isOdd(level)) {
			lowestOddLevel = level;
		}
	}

	// now reverse between those limits
	for (level = highestLevel; level >= lowestOddLevel; --level) {
		// find segments to reverse
		let start = -1;
		for (i = 0, ii = levels.length; i < ii; ++i) {
			if (levels[i] < level) {
				if (start >= 0) {
					reverseValues(chars, start, i);
					start = -1;
				}
			}
			else if (start < 0) {
				start = i;
			}
		}
		if (start >= 0) {
			reverseValues(chars, start, levels.length);
		}
	}

	/*
	 L3. Combining marks applied to a right-to-left base character will at this
	 point precede their base character. If the rendering engine expects them to
	 follow the base characters in the final display process, then the ordering
	 of the marks and the base character must be reversed.
	 */

	// don't bother for now

	/*
	 L4. A character that possesses the mirrored property as specified by
	 Section 4.7, Mirrored, must be depicted by a mirrored glyph if the resolved
	 directionality of that character is R.
	 */

	// don't mirror as characters are already mirrored in the pdf

	// Finally, return string
	for (i = 0, ii = chars.length; i < ii; ++i) {
		const ch = chars[i];
		if (ch === "<" || ch === ">") {
			chars[i] = "";
		}
	}
	return createBidiText(chars, isLTR);
}

function isRTL(char) {
	const charCode = char.charCodeAt(0);
	let charType = "L";
	if (charCode <= 0x00ff) {
		charType = baseTypes[charCode];
	}
	else if (0x0590 <= charCode && charCode <= 0x05f4) {
		charType = "R";
	}
	else if (0x0600 <= charCode && charCode <= 0x06ff) {
		charType = arabicTypes[charCode & 0xff];
		if (!charType) {
			console.log("Bidi: invalid Unicode character " + charCode.toString(16));
		}
	}
	else if (0x0700 <= charCode && charCode <= 0x08ac) {
		charType = "AL";
	}
	if (charType === "R" || charType === "AL" || charType === "AN") {
		return true;
	}
	return false;
}

// *** bidi.js ends here ***

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

function getPageLabelPoints(pageIndex, chars1, chars2, chars3, chars4, pageHeight) {
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

function getPageLabel(pageIndex, charsPrev, charsCur, charsNext, points) {
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

function overlaps(rect1, rect2, rotation) {
	if ([0, 180].includes(rotation)) {
		return (rect1[1] <= rect2[1] && rect2[1] <= rect1[3]
			|| rect2[1] <= rect1[1] && rect1[1] <= rect2[3]);
	}
	return (
		rect1[0] <= rect2[0] && rect2[0] <= rect1[2]
		|| rect2[0] <= rect1[0] && rect1[0] <= rect2[2]
	);
}

function charHeight(char) {
	return (!char.rotation && char.rect[3] - char.rect[1]
		|| char.rotation === 90 && char.rect[2] - char.rect[0]
		|| char.rotation === 180 && char.rect[1] - char.rect[3]
		|| char.rotation === 270 && char.rect[0] - char.rect[2]);
}

function getLines(chars, reflowRTL) {
	if (!chars.length) {
		return [];
	}
	let lines = [];
	let line = {
		from: 0,
		to: 0,
		vertical: [90, 270].includes(chars[0].rotation),
		rect: chars[0].rect.slice(),
		str: ''
	};

	let hasRTL = false;
	for (let char of chars) {
		if (isRTL(char.c)) {
			hasRTL = true;
			break;
		}
	}

	for (let i = 1; i < chars.length; i++) {
		let char = chars[i];
		let prevChar = chars[i-1];
		if (
			// Caret jumps to the next line start
			!hasRTL && (
				!char.rotation && prevChar.rect[0] > char.rect[0]
				|| char.rotation === 90 && prevChar.rect[1] > char.rect[1]
				|| char.rotation === 180 && prevChar.rect[0] < char.rect[0]
				|| char.rotation === 270 && prevChar.rect[1] < char.rect[1]
			)
			|| hasRTL && char.baseline !== prevChar.baseline
			// Rotation changes
			|| prevChar.rotation !== char.rotation
			// Chars aren't in the same line
			|| !overlaps(prevChar.rect, char.rect, char.rotation)
			// Line's first char is more than 2x larger than the following char
			|| line.from === line.to && charHeight(prevChar) > charHeight(char) * 2
		) {
			lines.push(line);

			if (reflowRTL) {
				let lineChars = chars.slice(line.from, line.to + 1);
				lineChars.sort((a, b) => {
					return (a.rect[0] + (a.rect[2] - a.rect[0])/2) - (b.rect[0] + (b.rect[2] - b.rect[0])/2);
				});
				bidi(lineChars, -1, false);
				chars.splice(line.from, line.to - line.from + 1, ...lineChars);
			}

			line = { from: i, to: i, vertical: [90, 270].includes(char.rotation), rect: char.rect.slice(), str: '' };
		}
		else {
			line.to++;
			// Update line bounding rect
			line.rect[0] = Math.min(line.rect[0], char.rect[0]);
			line.rect[1] = Math.min(line.rect[1], char.rect[1]);
			line.rect[2] = Math.max(line.rect[2], char.rect[2]);
			line.rect[3] = Math.max(line.rect[3], char.rect[3]);
			line.str += char.c;
		}
	}
	// Push last line
	lines.push(line);

	for (let line of lines) {
		line.words = [];
		// TODO: Compute word spacing threshold from more characters than just the current line i.e. current paragraph
		//  or page or even multiple pages.
		let wordSp = computeWordSpacingThreshold(chars.slice(line.from, line.to + 1), line.vertical);
		for (let i = line.from; i <= line.to; i++) {
			let sp = wordSp - 1;
			let spaceAfter = false;
			let j;
			for (j = i + 1; j <= line.to; ++j) {
				let char = chars[j - 1];
				let char2 = chars[j];

				let rtl = char2.rect[2] < char.rect[2];
				sp = line.vertical ? (char2.rect[1] - char.rect[3]) : (rtl ? (char.rect[0] - char2.rect[2]) : (char2.rect[0] - char.rect[2]));
				if (sp > wordSp) {
					spaceAfter = true;
					break;
				}

				let punctuation = '?.,;!¡¿。、·(){}[]/$';
				if (punctuation.includes(char.c) || punctuation.includes(char2.c)) {
					break;
				}
			}
			line.words.push({ from: i, to: j - 1, spaceAfter });
			i = j - 1;
		}
	}
	return lines;
}

function extractLinks(lines, chars) {
	let spaceBefore = new Set();
	for (let line of lines) {
		for (let word of line.words) {
			if (word.spaceAfter) {
				spaceBefore.add(word.to + 1);
			}
		}
	}

	let sequences = [];
	let sequence = { from: 0, to: 0, lbp: [] };

	let urlBreakChars = ['&', '.', '#', '?', '/'];

	for (let i = 0; i < chars.length; i++) {
		let char = chars[i];
		let charBefore = chars[i - 1];

		if (spaceBefore.has(i)
			|| charBefore && (
				char.fontSize !== charBefore.fontSize
				|| char.fontName !== charBefore.fontName
				|| charBefore.rect[0] > char.rect[0] && (
					charBefore.rect[1] - char.rect[3] > (char.rect[3] - char.rect[1]) / 2
					|| !(urlBreakChars.includes(charBefore.c) || urlBreakChars.includes(char.c))
				)
			)
		) {
			sequences.push(sequence);
			sequence = { from: i, to: i };
		}
		else {
			sequence.to = i;
		}
	}

	if (sequence.from !== sequence.to) {
		sequences.push(sequence);
	}

	let links = [];

	let urlRegExp = new RegExp(/(https?:\/\/|www\.|10\.)[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/);
	let doiRegExp = new RegExp(/10(?:\.[0-9]{4,})?\/[^\s]*[^\s\.,]/);

	for (let sequence of sequences) {
		let text = '';
		for (let j = sequence.from; j <= sequence.to; j++) {
			let char = chars[j];
			text += char.c;
		}
		let match = text.match(urlRegExp);
		if (match) {
			let url = match[0];
			if (url.includes('@')) {
				continue;
			}
			url = url.replace(/[.)]*$/, '');
			let from = sequence.from + match.index;
			let to = from + url.length;
			links.push({ from, to, url });
		}
		match = text.match(doiRegExp);
		if (match) {
			let from = sequence.from + match.index;
			let to = from + match[0].length;
			let url = 'https://doi.org/' + encodeURIComponent(match[0]);
			links.push({ from, to, text: match[0], url });
			continue;
		}
	}
	return links;
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

function getRangeBySelection({ chars, anchor, head, reverse }) {
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
	delete range.anchorOffset;
	delete range.headOffset;
	return range;
}

function getLineselectionRect(line, charFrom, charTo) {
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
			for (let i = word.from; i <= word.to; i++) {
				let char = chars[i];
				let isLastChar = i === word.to;
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
			for (let i = word.from; i <= word.to; i++) {
				let char = chars[i];
				if (char === charStart || extracting && !charFrom) {
					extracting = true;
					charFrom = char;
				}
				if (extracting) {
					charTo = char;
					if (char === charEnd) {
						rects.push(getLineselectionRect(line, charFrom, charTo));
						break loop2;
					}
				}
			}
		}
		if (extracting) {
			rects.push(getLineselectionRect(line, charFrom, charTo));
			charFrom = null;
		}
	}
	rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
	return { anchorOffset, headOffset, rects, text };
}

function getNextLineClosestOffset(chars, offset) {
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
	let idx = lines.findIndex(line => line.from <= offset && offset >= line.to);
	if (idx < lines.length - 1) {
		let line = lines[idx + 1];
		let lineChars = chars.slice(line.from, line.to + 1);
		return line.from + getClosestOffset(lineChars, char.rect);
	}
	return chars.length;
}

function getPrevLineClosestOffset(chars, offset) {
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
	let idx = lines.findIndex(line => line.from <= offset && offset >= line.to);
	if (idx > 0) {
		let line = lines[idx - 1];
		let lineChars = chars.slice(line.from, line.to + 1);
		return line.from + getClosestOffset(lineChars, char.rect);
	}
	return 0;
}

function getClosestWord(chars, rect) {
	if (!chars.length) {
		return null;
	}
	let lines = getLines(chars);
	let offset = getClosestOffset(chars, rect);
	let line = lines.find(line => line.from <= offset && offset <= line.to);
	let word = line.words.find(word => word.from <= offset && offset <= word.to);
	return { anchorOffset: word.from, headOffset: word.to + 1 };
}

function getClosestLine(chars, rect) {
	if (!chars.length) {
		return null;
	}
	let lines = getLines(chars);
	let offset = getClosestOffset(chars, rect);
	let line = lines.find(line => line.from <= offset && offset <= line.to);
	return { anchorOffset: line.from, headOffset: line.to + 1 };
}

export {
	getLines,
	getClosestOffset,
	getPageLabelPoints,
	getPageLabel,
	getRangeBySelection,
	getNextLineClosestOffset,
	getPrevLineClosestOffset,
	getClosestWord,
	getClosestLine,
	extractLinks
};

// module.exports = {
// 	getLines,
// 	getClosestOffset,
// 	getPageLabelPoints,
// 	getPageLabel,
// 	getRangeByHighlight
// };
