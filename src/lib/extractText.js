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
function computeWordSpacingThreshold(chs, vertical) {
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
			gap = vertical ? (ch2.rect[1] - ch.rect[3]) : (ch2.rect[0] - ch.rect[2]);
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

function isDash(c) {
	let re = /[\x2D\u058A\u05BE\u1400\u1806\u2010-\u2015\u2E17\u2E1A\u2E3A\u2E3B\u301C\u3030\u30A0\uFE31\uFE32\uFE58\uFE63\uFF0D]/;
	return re.test(c);
}

function filter(chs) {
	return chs.filter(ch => {
		ch.rotation = ch.rotation / 90;
		if (ch.rotation && ch.rotation % 1 !== 0) return false;
		if (ch.c === ' ') return false;
		return true;
	})
}

function overlaps(rect1, rect2) {
	let xo = Math.max(0, Math.min(rect1[2], rect2[2]) - Math.max(rect1[0], rect2[0]));
	let yo = Math.max(0, Math.min(rect1[3], rect2[3]) - Math.max(rect1[1], rect2[1]));
	return {xo, yo};
}

function getDirection(chs, c) {
	let ch1 = chs[c];
	let l = c - 1;
	let h = 0;
	let v = 0;
	while (l >= 0) {
		let ch2 = chs[l];
		let {xo, yo} = overlaps(ch1.rect, ch2.rect);
		if (xo || yo) {
			if (yo > xo) {
				h++;
			}
			else {
				v++;
			}
		}
		else {
			break;
		}
		l--;
	}
	
	let r = c + 1;
	while (r < chs.length) {
		let ch2 = chs[r];
		let {xo, yo} = overlaps(ch1.rect, ch2.rect);
		if (xo || yo) {
			if (yo > xo) {
				h++;
			}
			else {
				v++;
			}
		}
		else {
			break;
		}
		r++;
	}
	ch1.vertical = v >= h;
}

function getStructure(chs) {
	let lines = [];
	let line = {
		chs: []
	};
	
	let dir = null;
	for (let i = 0; i < chs.length; i++) {
		let ch = chs[i];
		let prevCh = line.chs[line.chs.length - 1];
		getDirection(chs, i);
		
		if (!line.chs.length) {
			line.chs.push(ch);
		}
		else {
			let newLine = false;
			
			if (!ch.vertical) {
				if (prevCh.rect[0] > ch.rect[0] + 5) {
					newLine = true;
				}
			}
			else if (ch.vertical) {
				if (prevCh.rect[1] > ch.rect[1]) {
					newLine = true;
				}
			}
			
			if (
				newLine ||
				prevCh.rotation !== ch.rotation ||
				prevCh.vertical !== ch.vertical ||
				Math.sqrt((prevCh.rect[0] - ch.rect[0]) ** 2 + (prevCh.rect[3] - ch.rect[1]) ** 2) > 5 * ch.fontSize
			) {
				line.vertical = line.chs[0].vertical;
				lines.push(line);
				line = {chs: [ch]};
			}
			else {
				line.chs.push(ch);
			}
		}
	}
	
	if (line.chs.length) {
		line.vertical = line.chs[0].vertical;
		lines.push(line);
	}
	
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
		let wordSp = computeWordSpacingThreshold(line.chs, line.rotation);
		let i = 0;
		while (i < line.chs.length) {
			let sp = wordSp - 1;
			let spaceAfter = false;
			let j;
			for (j = i + 1; j < line.chs.length; ++j) {
				let ch = line.chs[j - 1];
				let ch2 = line.chs[j];
				sp = line.vertical ? (ch2.rect[1] - ch.rect[3]) : (ch2.rect[0] - ch.rect[2]);
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

function getPoints(chs, rects) {
	let r;
	r = rects[0];
	let n = 0;
	
	let chStart = null;
	let chStartNum = Infinity;
	
	let chPrev = null;
	for (let ch of chs) {
		n++;
		let centerRect = [
			ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
			ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2,
			ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
			ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2,
		];
		if (quickIntersectRect(centerRect, r) && chStartNum > n) {
			chStart = ch;
			chStartNum = n;
		}
		chPrev = ch;
	}
	
	n = 0;
	r = rects.slice(-1)[0];
	let chEnd = null;
	let chEndNum = 0;
	
	chPrev = null;
	for (let i = 0; i < chs.length; i++) {
		let ch = chs[i];
		n++;
		let centerRect = [
			ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
			ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2,
			ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
			ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2,
		];
		
		if (quickIntersectRect(centerRect, r) && n > chEndNum) {
			chEnd = ch;
			chEndNum = n;
			chPrev = ch;
		}
	}
	
	if (chStartNum < chEndNum) {
		return {chStart, chEnd}
	}
	else {
		return null;
	}
}

exports.getRange = function (chs, rects) {
	if (!rects.length) return;
	chs = filter(chs);
	let lines = getStructure(chs);
	let chPoints = getPoints(chs, rects);
	if (!chPoints) return;
	let {chStart, chEnd} = chPoints;
	
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
	let lineChStart = null;
	let lineChEnd = null;
	for (let line of lines) {
		for (let j = 0; j < line.words.length; j++) {
			let word = line.words[j];
			for (let i = 0; i < word.chs.length; i++) {
				let ch = word.chs[i];
				
				if (ch === chStart || extracting && !lineChStart) {
					extracting = true;
					lineChStart = ch;
				}
				
				if (extracting) {
					lineChEnd = ch;
				}
				
				if (ch === chEnd) {
					extracting = false;
					let rect;
					if (line.vertical) {
						rect = [line.rect[0], Math.min(lineChStart.rect[1], lineChEnd.rect[1]), line.rect[2], Math.max(lineChStart.rect[3], lineChEnd.rect[3])];
					}
					else {
						rect = [Math.min(lineChStart.rect[0], lineChEnd.rect[0]), line.rect[1], Math.max(lineChStart.rect[2], lineChEnd.rect[2]), line.rect[3]];
					}
					
					allRects.push(rect);
				}
			}
		}
		
		if (extracting) {
			let rect;
			if (line.vertical) {
				rect = [line.rect[0], Math.min(lineChStart.rect[1], lineChEnd.rect[1]), line.rect[2], Math.max(lineChStart.rect[3], lineChEnd.rect[3])];
			}
			else {
				rect = [Math.min(lineChStart.rect[0], lineChEnd.rect[0]), line.rect[1], Math.max(lineChStart.rect[2], lineChEnd.rect[2]), line.rect[3]];
			}
			lineChStart = null;
			allRects.push(rect);
			rect = null;
		}
	}
	
	return {
	  offset: chs.indexOf(chStart),
		rects: allRects,
		text
	};
};
