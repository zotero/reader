function pointsDist([x1, y1], [x2, y2]) {
	return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
	let left = bx2 < ax1;
	let right = ax2 < bx1;
	let bottom = by2 < ay1;
	let top = ay2 < by1;

	if (top && left) {
		return pointsDist([ax1, ay2], [bx2, by1]);
	}
	else if (left && bottom) {
		return pointsDist([ax1, ay1], [bx2, by2]);
	}
	else if (bottom && right) {
		return pointsDist([ax2, ay1], [bx1, by2]);
	}
	else if (right && top) {
		return pointsDist([ax2, ay2], [bx1, by1]);
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

export function getClosestOffset(chs, rect) {
	let minDist = Infinity;
	let minDistChIndex = 0;
	for (let i = 0; i < chs.length; i++) {
		let ch = chs[i];
		let distance = rectsDist(ch.rect, rect);
		if (distance < minDist) {
			minDist = distance;
			minDistChIndex = i;
		}
	}
	return minDistChIndex;
}

// module.exports = {
// 	getClosestOffset
// };
