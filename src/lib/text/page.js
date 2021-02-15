let isNum = (c) => c >= '0' && c <= '9';

function getSurroundedNumber(chs, ch) {
	let idx = chs.indexOf(ch);

	while (
		idx > 0 && isNum(chs[idx - 1].c) &&
		Math.abs(chs[idx].rect[0] - chs[idx - 1].rect[2]) < chs[idx].rect[2] - chs[idx].rect[0] &&
		Math.abs(chs[idx - 1].rect[1] - chs[idx].rect[1]) < 2
		) {
		idx--;
	}

	let str = chs[idx].c;

	while (
		idx < chs.length - 1 && isNum(chs[idx + 1].c) &&
		Math.abs(chs[idx + 1].rect[0] - chs[idx].rect[2]) < chs[idx + 1].rect[2] - chs[idx + 1].rect[0] &&
		Math.abs(chs[idx].rect[1] - chs[idx + 1].rect[1]) < 2
		) {
		idx++;
		str += chs[idx].c;
	}

	return parseInt(str);
}

function getSurroundedNumberAtPos(chs, x, y) {
	for (let ch of chs) {
		let { x: x2, y: y2 } = getRectCenter(ch.rect);
		if (isNum(ch.c) && Math.abs(x - x2) < 10 && Math.abs(y - y2) < 5) {
			return getSurroundedNumber(chs, ch);
		}
	}
	return null;
}

function getRectCenter(rect) {
	return {
		x: rect[0] + (rect[2] - rect[0]) / 2,
		y: rect[1] + (rect[3] - rect[1]) / 2
	}
}

function filterNums(chs, pageHeight) {
	return chs.filter(x => x.c >= '0' && x.c <= '9' && (x.rect[3] < pageHeight * 1 / 5 || x.rect[1] > pageHeight * 3 / 5));
}

export async function getPageLabelPoints(pageIndex, chs1, chs2, chs3, chs4, pageHeight) {
	let chsNum1 = filterNums(chs1, pageHeight);
	let chsNum2 = filterNums(chs2, pageHeight);
	let chsNum3 = filterNums(chs3, pageHeight);
	let chsNum4 = filterNums(chs4, pageHeight);

	for (let ch1 of chsNum1) {
		for (let ch3 of chsNum3) {
			let { x: x1, y: y1 } = getRectCenter(ch1.rect);
			let { x: x2, y: y2 } = getRectCenter(ch3.rect);
			if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
				let num1 = getSurroundedNumber(chs1, ch1);
				let num3 = getSurroundedNumber(chs3, ch3);
				if (num1 && num1 + 2 === num3) {
					let pos1 = { x: x1, y: y1, num: num1, idx: pageIndex };

					let extractedNum2 = getSurroundedNumberAtPos(chs2, x1, y1);
					if (num1 + 1 === extractedNum2) {
						return [pos1];
					}

					for (let ch2 of chsNum2) {
						for (let ch4 of chsNum4) {
							let { x: x1, y: y1 } = getRectCenter(ch2.rect);
							let { x: x2, y: y2 } = getRectCenter(ch4.rect);
							if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
								let num2 = getSurroundedNumber(chs2, ch2);
								let num4 = getSurroundedNumber(chs4, ch4);
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

export async function getPageLabel(pageIndex, chsPrev, chsCur, chsNext, points) {
	let numPrev, numCur, numNext;

	let getNum = (chsNext, points) =>
		points.length > 0 && getSurroundedNumberAtPos(chsNext, points[0].x, points[0].y) ||
		points.length > 1 && getSurroundedNumberAtPos(chsNext, points[1].x, points[1].y);

	if (chsPrev) {
		numPrev = getNum(chsPrev, points);
	}

	numCur = getNum(chsCur, points);

	if (chsNext) {
		numNext = getNum(chsNext, points);
	}

	if (numCur && (numCur - 1 === numPrev || numCur + 1 === numNext)) {
		return numCur.toString();
	}

	if (pageIndex < points[0].idx) {
		return (points[0].num - (points[0].idx - pageIndex)).toString();
	}
}
