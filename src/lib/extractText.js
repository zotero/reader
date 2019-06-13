// The code is adapted from Xpdf https://www.xpdfreader.com/opensource.html

// Inter-character spacing that varies by less than this multiple of
// font size is assumed to be equivalent.
let uniformSpacing = 0.07;

// Typical word spacing, as a fraction of font size.  This will be
// added to the minimum inter-character spacing, to account for wide
// character spacing.
let wordSpacing = 0.1;
// Compute the inter-word spacing threshold for a line of chars.
// Spaces greater than this threshold will be considered inter-word
// spaces.
function computeWordSpacingThreshold(chs, rot) {
	let ch, ch2;
	let avgFontSize;
	let minAdjGap, maxAdjGap, minSpGap, maxSpGap, minGap, maxGap, gap, gap2;
	let i;
	
	avgFontSize = 0;
	minGap = maxGap = 0;
	minAdjGap = minSpGap = 1;
	maxAdjGap = maxSpGap = 0;
	for (i = 0; i < chs.length; ++i) {
		ch = chs[i];
		avgFontSize += ch.fontSize;
		if (i < chs.length - 1) {
			ch2 = chs[i + 1];
			gap = (rot & 1) ? (ch2.rect[1] - ch.rect[3]) : (ch2.rect[0] - ch.rect[2]);
			if (ch.spaceAfter) {
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
			else {
				if (minAdjGap > maxAdjGap) {
					minAdjGap = maxAdjGap = gap;
				}
				else if (gap < minAdjGap) {
					minAdjGap = gap;
				}
				else if (gap > maxAdjGap) {
					maxAdjGap = gap;
				}
			}
			if (i == 0 || gap < minGap) {
				minGap = gap;
			}
			if (gap > maxGap) {
				maxGap = gap;
			}
		}
	}
	avgFontSize /= chs.length;
	if (minGap < 0) {
		minGap = 0;
	}
	
	// if spacing is nearly uniform (minGap is close to maxGap), use the
	// SpGap/AdjGap values if available, otherwise assume it's a single
	// word (technically it could be either "ABC" or "A B C", but it's
	// essentially impossible to tell)
	if (maxGap - minGap < uniformSpacing * avgFontSize) {
		if (minAdjGap <= maxAdjGap &&
			minSpGap <= maxSpGap &&
			minSpGap - maxAdjGap > 0.01) {
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
	else {
		if (minAdjGap <= maxAdjGap &&
			minSpGap <= maxSpGap &&
			minSpGap - maxAdjGap > uniformSpacing * avgFontSize) {
			gap = wordSpacing * avgFontSize;
			gap2 = 0.5 * (minSpGap - minGap);
			return minGap + (gap < gap2 ? gap : gap2);
		}
		else {
			return minGap + wordSpacing * avgFontSize;
		}
	}
}

// ***

// The code is from pdf.js

// Normalize rectangle rect=[x1, y1, x2, y2] so that (x1,y1) < (x2,y2)
// For coordinate systems whose origin lies in the bottom-left, this
// means normalization to (BL,TR) ordering. For systems with origin in the
// top-left, this means (TL,BR) ordering.
function Util_normalizeRect(rect) {
	var r = rect.slice(0); // clone rect
	if (rect[0] > rect[2]) {
		r[0] = rect[2];
		r[2] = rect[0];
	}
	if (rect[1] > rect[3]) {
		r[1] = rect[3];
		r[3] = rect[1];
	}
	return r;
}

// Returns a rectangle [x1, y1, x2, y2] corresponding to the
// intersection of rect1 and rect2. If no intersection, returns 'false'
// The rectangle coordinates of rect1, rect2 should be [x1, y1, x2, y2]
function Util_intersect(rect1, rect2) {
	function compare(a, b) {
		return a - b;
	}
	
	// Order points along the axes
	var orderedX = [rect1[0], rect1[2], rect2[0], rect2[2]].sort(compare),
		orderedY = [rect1[1], rect1[3], rect2[1], rect2[3]].sort(compare),
		result = [];
	
	rect1 = Util_normalizeRect(rect1);
	rect2 = Util_normalizeRect(rect2);
	
	// X: first and second points belong to different rectangles?
	if ((orderedX[0] === rect1[0] && orderedX[1] === rect2[0]) ||
		(orderedX[0] === rect2[0] && orderedX[1] === rect1[0])) {
		// Intersection must be between second and third points
		result[0] = orderedX[1];
		result[2] = orderedX[2];
	}
	else {
		return false;
	}
	
	// Y: first and second points belong to different rectangles?
	if ((orderedY[0] === rect1[1] && orderedY[1] === rect2[1]) ||
		(orderedY[0] === rect2[1] && orderedY[1] === rect1[1])) {
		// Intersection must be between second and third points
		result[1] = orderedY[1];
		result[3] = orderedY[2];
	}
	else {
		return false;
	}
	
	return result;
}

// ***

function quickIntersectRect(r1, r2) {
	return !(r2[0] > r1[2] ||
		r2[2] < r1[0] ||
		r2[1] > r1[3] ||
		r2[3] < r1[1]);
}

function overlaps(ch1, ch2, rotation) {
	if (rotation === 0) {
		if (
			ch1.rect[1] <= ch2.rect[1] && ch2.rect[1] <= ch1.rect[3] ||
			ch2.rect[1] <= ch1.rect[1] && ch1.rect[1] <= ch2.rect[3]
		) {
			return true;
		}
	}
	else {
		if (
			ch1.rect[0] <= ch2.rect[0] && ch2.rect[0] <= ch1.rect[2] ||
			ch2.rect[0] <= ch1.rect[0] && ch1.rect[0] <= ch2.rect[2]
		) {
			return true;
		}
	}
	return false;
}

function isDash(c) {
	let re = /[\x2D\u058A\u05BE\u1400\u1806\u2010-\u2015\u2E17\u2E1A\u2E3A\u2E3B\u301C\u3030\u30A0\uFE31\uFE32\uFE58\uFE63\uFF0D]/;
	return re.test(c);
}

function getStructure(chs) {
	let lines = [];
	let line = {
		chs: []
	};
	for (let ch of chs) {
		let prevCh = line.chs[line.chs.length - 1];
		if (ch.rotation && ch.rotation % 90 !== 0) continue;
		if (ch.c === ' ') {
			if (line.length) {
				line[line.length - 1].spaceAfter = true;
			}
			continue
		}
		
		if (!line.chs.length) {
			line.chs.push(ch);
		}
		else {
			
			let newLine = false;
			
			if (!ch.rotation) {
				if (prevCh.rect[0] > ch.rect[0]) {
					newLine = true;
				}
			}
			else if (ch.rotation === 90) {
				if (prevCh.rect[1] > ch.rect[1]) {
					newLine = true;
				}
			}
			else if (ch.rotation === 270) {
				if (prevCh.rect[1] < ch.rect[1]) {
					newLine = true;
				}
			}
			if (ch.rotation === 180) {
				if (prevCh.rect[0] < ch.rect[0]) {
					newLine = true;
				}
			}
			
			if (
				newLine ||
				prevCh.rotation !== ch.rotation ||
				!overlaps(prevCh, ch, ch.rotation)
			) {
				lines.push(line);
				line = {chs: [ch]};
			}
			else {
				line.chs.push(ch);
			}
		}
	}
	
	if (line.chs.length) lines.push(line);
	
	for (let line of lines) {
		line.rect = line.chs[0].rect.slice();
		for (let ch of line.chs) {
			line.rect[0] = Math.min(line.rect[0], ch.rect[0]);
			line.rect[1] = Math.min(line.rect[1], ch.rect[1]);
			line.rect[2] = Math.max(line.rect[2], ch.rect[2]);
			line.rect[3] = Math.max(line.rect[3], ch.rect[3]);
		}
	}
	
	for (let line of lines) {
		line.words = [];
		
		let rot;
		let rotation = line.chs[0].rotation;
		if (!rotation) {
			rot = 0;
		}
		else if (rotation === 90) {
			rot = 1;
		}
		else if (rotation === 180) {
			rot = 2;
		}
		else if (rotation === 270) {
			rot = 3;
		}
		
		let wordSp = computeWordSpacingThreshold(line.chs, rot);
		
		let i = 0;
		while (i < line.chs.length) {
			let sp = wordSp - 1;
			let spaceAfter = false;
			let j;
			for (j = i + 1; j < line.chs.length; ++j) {
				let ch = line.chs[j - 1];
				let ch2 = line.chs[j];
				sp = (rot & 1) ? (ch2.rect[1] - ch.rect[3]) : (ch2.rect[0] - ch.rect[2]);
				if (sp > wordSp) {
					spaceAfter = true;
					break;
				}
			}
			
			let word = {
				line,
				chs: line.chs.slice(i, j),
				spaceAfter
			};
			
			for (let ch of word.chs) {
				ch.word = word;
			}
			
			line.words.push(word);
			i = j;
		}
	}
	
	return lines;
}

exports.extractText = function (chs, rects) {
	let text = '';
	let lines = getStructure(chs);
	for (let line of lines) {
		let found = false;
		for (let rect of rects) {
			if (quickIntersectRect(line.rect, rect)) {
				found = true;
				break;
			}
		}
		if (!found) continue;
		for (let j = 0; j < line.words.length; j++) {
			let word = line.words[j];
			for (let i = 0; i < word.chs.length; i++) {
				let ch = word.chs[i];
				let chsq = Math.abs(ch.rect[0] - ch.rect[2]) * Math.abs(ch.rect[1] - ch.rect[3]);
				for (let rect of rects) {
					let ir = Util_intersect(rect, ch.rect);
					let irsq = Math.abs(ir[0] - ir[2]) * Math.abs(ir[1] - ir[3]);
					if (ir && irsq >= chsq / 3) {
						if (j === line.words.length - 1 && i === word.chs.length - 1) {
							if (isDash(ch.c)) {
								continue;
							}
						}
						text += ch.c;
						if (i === word.chs.length - 1 && word.spaceAfter) {
							text += ' ';
						}
						if (j === line.words.length - 1 && i === word.chs.length - 1 && text.slice(-1) !== ' ') {
							text += ' ';
						}
					}
				}
			}
		}
	}
	
	text = text.trim();
	return text || null;
};

exports.getRange = function (chs, rects) {
	if (!rects.length) return;
	
	let r = rects[0];
	let startPoint = [r[0], r[1] + (r[3] - r[1]) / 2];
	
	r = rects.slice(-1)[0];
	
	let endPoint = [r[2], r[1] + (r[3] - r[1]) / 2];
	
	let lines = getStructure(chs);
	
	let chStart = null;
	let chStartDist;
	for (let line of lines) {
		for (let word of line.words) {
			for (let ch of line.chs) {
				if (!chStart || Math.abs(ch.rect[0] - startPoint[0]) <= chStartDist && ch.rect[1] < startPoint[1] && startPoint[1] < ch.rect[3]) {
					chStart = ch;
					chStartDist = Math.abs(ch.rect[0] - startPoint[0]);
				}
			}
		}
	}
	
	let chStartFound = false;
	
	let chEnd = null;
	let chEndDist;
	for (let line of lines) {
		for (let word of line.words) {
			for (let ch of line.chs) {
				if (ch === chStart) chStartFound = true;
				if (!chEnd || Math.abs(ch.rect[2] - endPoint[0]) <= chEndDist && ch.rect[1] < endPoint[1] && endPoint[1] < ch.rect[3]) {
					chEnd = ch;
					chEndDist = Math.abs(ch.rect[2] - endPoint[0]);
				}
			}
		}
	}
	
	if (!chStartFound) return null;
	
	let text = '';
	let extracting = false;
	for (let line of lines) {
		for (let j = 0; j < line.words.length; j++) {
			let word = line.words[j];
			for (let i = 0; i < word.chs.length; i++) {
				let ch = word.chs[i];
				
				if (ch === chStart) {
					extracting = true;
				}
				
				if (!extracting) continue;
				
				if (j === line.words.length - 1 && i === word.chs.length - 1) {
					if (isDash(ch.c)) {
						continue;
					}
				}
				
				text += ch.c;
				
				if (i === word.chs.length - 1 && word.spaceAfter) {
					text += ' ';
				}
				
				if (j === line.words.length - 1 && i === word.chs.length - 1 && text.slice(-1) !== ' ') {
					text += ' ';
				}
				
				if (ch === chEnd) {
					extracting = false;
				}
			}
		}
	}
	
	let allRects = [];
	extracting = false;
	let rect = null;
	for (let line of lines) {
		if (extracting) {
			rect = [line.rect[0], line.rect[1], 0, line.rect[3]];
		}
		
		for (let j = 0; j < line.words.length; j++) {
			let word = line.words[j];
			for (let i = 0; i < word.chs.length; i++) {
				let ch = word.chs[i];
				
				if (ch === chStart) {
					extracting = true;
					rect = [ch.rect[0], line.rect[1], 0, line.rect[3]];
				}
				
				if (ch === chEnd) {
					extracting = false;
					if (rect) {
						rect[2] = ch.rect[2];
						allRects.push(rect);
						rect = null;
					}
				}
			}
		}
		if (rect) {
			rect[2] = line.rect[2];
			allRects.push(rect);
			rect = null;
		}
	}
	
	return {
		rects: allRects,
		text
	};
};
