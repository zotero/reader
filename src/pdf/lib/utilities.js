export function fitRectIntoRect(rect, containingRect) {
	return [
		Math.max(rect[0], containingRect[0]),
		Math.max(rect[1], containingRect[1]),
		Math.min(rect[2], containingRect[2]),
		Math.min(rect[3], containingRect[3])
	];
}

export function getPositionBoundingRect(position, pageIndex) {
	// Use nextPageRects
	if (position.rects) {
		let rects = position.rects;
		if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
			rects = position.nextPageRects;
		}
		return [
			Math.min(...rects.map(x => x[0])),
			Math.min(...rects.map(x => x[1])),
			Math.max(...rects.map(x => x[2])),
			Math.max(...rects.map(x => x[3]))
		];
	}
	else if (position.paths) {
		let x = position.paths[0][0];
		let y = position.paths[0][1];
		let rect = [x, y, x, y];
		for (let path of position.paths) {
			for (let i = 0; i < path.length - 1; i += 2) {
				let x = path[i];
				let y = path[i + 1];
				rect[0] = Math.min(rect[0], x);
				rect[1] = Math.min(rect[1], y);
				rect[2] = Math.max(rect[2], x);
				rect[3] = Math.max(rect[3], y);
			}
		}
		return rect;
	}
}

export function positionsEqual(p1, p2) {
	if (Array.isArray(p1.rects) !== Array.isArray(p2.rects)
		|| Array.isArray(p1.paths) !== Array.isArray(p2.paths)) {
		return false;
	}

	if (p1.pageIndex !== p2.pageIndex) {
		return false;
	}

	if (p1.rects) {
		return JSON.stringify(p1.rects) === JSON.stringify(p2.rects);
	}
	else if (p1.paths) {
		return JSON.stringify(p1.paths) === JSON.stringify(p2.paths);
	}

	return false;
}

export function quickIntersectRect(r1, r2) {
	return !(
		r2[0] > r1[2]
		|| r2[2] < r1[0]
		|| r2[1] > r1[3]
		|| r2[3] < r1[1]
	);
}

export function intersectAnnotationWithPoint(selectionPosition, pointPosition) {
	let [x, y] = pointPosition.rects[0];
	if (selectionPosition.nextPageRects && selectionPosition.pageIndex + 1 === pointPosition.pageIndex) {
		for (let i = 0; i < selectionPosition.nextPageRects.length; i++) {
			let [r1, r2] = selectionPosition.nextPageRects.slice(i, i + 2);
			if (!(x > r1[2]
				|| x < r1[0]
				|| y > r1[3]
				|| y < r1[1])) {
				return true;
			}

			if (!r2) {
				continue;
			}

			if (x > r1[0] && x > r2[0]
				&& x < r1[2] && x < r2[2]
				&& y < r1[3] && y > r2[1]
				&& r1[1] - r2[3] < Math.min(r1[3] - r1[1], r2[3] - r2[1])) {
				return true;
			}
		}
	}
	else if (selectionPosition.pageIndex === pointPosition.pageIndex) {
		if (selectionPosition.rects) {
			for (let i = 0; i < selectionPosition.rects.length; i++) {
				let [r1, r2] = selectionPosition.rects.slice(i, i + 2);
				if (!(x > r1[2]
					|| x < r1[0]
					|| y > r1[3]
					|| y < r1[1])) {
					return true;
				}

				if (!r2) {
					continue;
				}

				if (x > r1[0] && x > r2[0]
					&& x < r1[2] && x < r2[2]
					&& y < r1[3] && y > r2[1]
					&& r1[1] - r2[3] < Math.min(r1[3] - r1[1], r2[3] - r2[1])) {
					return true;
				}
			}
		}
		else if (selectionPosition.paths) {
			let maxDistance = Math.max(7, selectionPosition.width);
			for (let path of selectionPosition.paths) {
				for (let i = 0; i < path.length - 1; i += 2) {
					let ax = path[i];
					let ay = path[i + 1];
					if (Math.hypot(ax - x, ay - y) < maxDistance) {
						return true;
					}
				}
			}
		}
	}
	return false;
}

// From PDF.js util.js
// Concatenates two transformation matrices together and returns the result.
export function transform(m1, m2) {
	return [
		m1[0] * m2[0] + m1[2] * m2[1],
		m1[1] * m2[0] + m1[3] * m2[1],
		m1[0] * m2[2] + m1[2] * m2[3],
		m1[1] * m2[2] + m1[3] * m2[3],
		m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
		m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
	];
}

// For 2d affine transforms
export function applyTransform(p, m) {
	const xt = p[0] * m[0] + p[1] * m[2] + m[4];
	const yt = p[0] * m[1] + p[1] * m[3] + m[5];
	return [xt, yt];
}

export function applyInverseTransform(p, m) {
	const d = m[0] * m[3] - m[1] * m[2];
	const xt = (p[0] * m[3] - p[1] * m[2] + m[2] * m[5] - m[4] * m[3]) / d;
	const yt = (-p[0] * m[1] + p[1] * m[0] + m[4] * m[1] - m[5] * m[0]) / d;
	return [xt, yt];
}
