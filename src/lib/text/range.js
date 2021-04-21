import { getLines } from './structure';
import { getClosestOffset } from './offset';

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

// Using non-normalized rect containing selection start and end points
function getRangeBySelectionRect(chs, r) {
	let startIndex = getClosestOffset(chs, [r[0], r[1], r[0], r[1]]);
	let endIndex = getClosestOffset(chs, [r[2], r[3], r[2], r[3]]);
	if (startIndex < endIndex) {
		return { chStart: chs[startIndex], chEnd: chs[endIndex] };
	}
	return { chStart: chs[endIndex], chEnd: chs[startIndex] };
}

function getCenterRect(r) {
	return [
		r[0] + (r[2] - r[0]) / 2,
		r[1] + (r[3] - r[1]) / 2,
		r[0] + (r[2] - r[0]) / 2,
		r[1] + (r[3] - r[1]) / 2
	];
}

function getRangeByHighlightRects(chs, rects) {
	let startIndex = Infinity;
	for (let i = 0; i < chs.length; i++) {
		let ch = chs[i];
		if (quickIntersectRect(getCenterRect(ch.rect), rects[0])) {
			startIndex = i;
			break;
		}
	}

	let endIndex = 0;
	for (let i = chs.length - 1; i >= 0; i--) {
		let ch = chs[i];
		if (quickIntersectRect(getCenterRect(ch.rect), rects[rects.length - 1])) {
			endIndex = i;
			break;
		}
	}

	if (startIndex < endIndex) {
		return { chStart: chs[startIndex], chEnd: chs[endIndex] };
	}
	else {
		return null;
	}
}

function filter(chs) {
	return chs.filter((ch) => {
		ch.rotation /= 90;
		if (ch.rotation && ch.rotation % 1 !== 0) return false;
		if (ch.c === ' ') return false;
		return true;
	});
}

export function extractRange(chs, rects, selection) {
	if (!rects.length) return;
	chs = filter(chs);
	let lines = getLines(chs);
	let chPoints;
	if (selection) {
		chPoints = getRangeBySelectionRect(chs, rects[0]);
	}
	else {
		chPoints = getRangeByHighlightRects(chs, rects);
	}

	if (!chPoints) return;
	let { chStart, chEnd } = chPoints;

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
					if (isDash(ch.c) && ch !== chEnd) {
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

	allRects = allRects.map(
		rect => rect.map(value => parseFloat(value.toFixed(3)))
	);

	text = text.trim();

	return {
		offset: chs.indexOf(chStart),
		rects: allRects,
		text
	};
}
