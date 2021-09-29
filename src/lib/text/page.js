let isNum = c => c >= '0' && c <= '9';

function getSurroundedNumber(chs, idx) {
	while (
		idx > 0 && isNum(chs[idx - 1].c)
		&& Math.abs(chs[idx].rect[0] - chs[idx - 1].rect[2]) < chs[idx].rect[2] - chs[idx].rect[0]
		&& Math.abs(chs[idx - 1].rect[1] - chs[idx].rect[1]) < 2
		) {
		idx--;
	}

	let str = chs[idx].c;

	while (
		idx < chs.length - 1 && isNum(chs[idx + 1].c)
		&& Math.abs(chs[idx + 1].rect[0] - chs[idx].rect[2]) < chs[idx + 1].rect[2] - chs[idx + 1].rect[0]
		&& Math.abs(chs[idx].rect[1] - chs[idx + 1].rect[1]) < 2
		) {
		idx++;
		str += chs[idx].c;
	}

	return parseInt(str);
}

function getSurroundedNumberAtPos(chs, x, y) {
	for (let i = 0; i < chs.length; i++) {
		let ch = chs[i];
		let { x: x2, y: y2 } = getRectCenter(ch.rect);
		if (isNum(ch.c) && Math.abs(x - x2) < 10 && Math.abs(y - y2) < 5) {
			return getSurroundedNumber(chs, i);
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

function filterNums(chs, pageHeight) {
	return chs.filter(x => x.c >= '0' && x.c <= '9' && (x.rect[3] < pageHeight * 1 / 5 || x.rect[1] > pageHeight * 3 / 5));
}

export function getPageLabelPoints(pageIndex, chs1, chs2, chs3, chs4, pageHeight) {
	let chsNum1 = filterNums(chs1, pageHeight);
	let chsNum2 = filterNums(chs2, pageHeight);
	let chsNum3 = filterNums(chs3, pageHeight);
	let chsNum4 = filterNums(chs4, pageHeight);

	for (let c1 = 0; c1 < chsNum1.length; c1++) {
		let ch1 = chsNum1[c1];
		for (let c3 = 0; c3 < chsNum3.length; c3++) {
			let ch3 = chsNum3[c3];
			let { x: x1, y: y1 } = getRectCenter(ch1.rect);
			let { x: x2, y: y2 } = getRectCenter(ch3.rect);
			if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
				let num1 = getSurroundedNumber(chsNum1, c1);
				let num3 = getSurroundedNumber(chsNum3, c3);
				if (num1 && num1 + 2 === num3) {
					let pos1 = { x: x1, y: y1, num: num1, idx: pageIndex };

					let extractedNum2 = getSurroundedNumberAtPos(chs2, x1, y1);
					if (num1 + 1 === extractedNum2) {
						return [pos1];
					}

					for (let c2 = 0; c2 < chsNum2.length; c2++) {
						let ch2 = chsNum2[c2];
						for (let c4 = 0; c4 < chsNum4.length; c4++) {
							let ch4 = chsNum4[c4];
							let { x: x1, y: y1 } = getRectCenter(ch2.rect);
							let { x: x2, y: y2 } = getRectCenter(ch4.rect);
							if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
								let num2 = getSurroundedNumber(chsNum2, c2);
								let num4 = getSurroundedNumber(chsNum4, c4);
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

export function getPageLabel(pageIndex, chsPrev, chsCur, chsNext, points) {
	let numPrev, numCur, numNext;

	// TODO: Instead of trying to extract from two positions, try to
	//  guess the right position by determining whether the page is even or odd

	// TODO: Take into account font parameters when comparing extracted numbers
	let getNum = (chsNext, points) => points.length > 0 && getSurroundedNumberAtPos(chsNext, points[0].x, points[0].y)
		|| points.length > 1 && getSurroundedNumberAtPos(chsNext, points[1].x, points[1].y);

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

	return null;
}
