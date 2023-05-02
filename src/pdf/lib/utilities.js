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
		if (position.rotation) {
			let rect = rects[0];
			let tm = getRotationTransform(rect, position.rotation);
			let p1 = applyTransform([rect[0], rect[1]], tm);
			let p2 = applyTransform([rect[2], rect[3]], tm);
			let p3 = applyTransform([rect[2], rect[1]], tm);
			let p4 = applyTransform([rect[0], rect[3]], tm);
			return [
				Math.min(p1[0], p2[0], p3[0], p4[0]),
				Math.min(p1[1], p2[1], p3[1], p4[1]),
				Math.max(p1[0], p2[0], p3[0], p4[0]),
				Math.max(p1[1], p2[1], p3[1], p4[1]),
			];
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

export function getPageIndexesFromAnnotations(annotations) {
	let pageIndexes = new Set();
	for (let annotation of annotations) {
		pageIndexes.add(annotation.position.pageIndex);
		if (annotation.position.nextPageRects) {
			pageIndexes.add(annotation.position.pageIndex + 1);
		}
	}
	return Array.from(pageIndexes).sort();
}

export function adjustRectHeightByRatio(rect, ratio, dir) {
	rect = rect.slice();
	let width = rect[2] - rect[0];
	let height = width / ratio;
	if (dir.includes('b')) {
		rect[1] = rect[3] - height;
	}
	else if (dir.includes('t')) {
		rect[3] = rect[1] + height;
	}
	return rect;
}

export function adjustRectWidthByRatio(rect, ratio, dir) {
	rect = rect.slice();
	let height = rect[3] - rect[1];
	let width = height * ratio;
	if (dir.includes('l')) {
		rect[0] = rect[2] - width;
	}
	else if (dir.includes('r')) {
		rect[2] = rect[0] + width;
	}
	return rect;
}

// Normalize rectangle rect=[x1, y1, x2, y2] so that (x1,y1) < (x2,y2)
// For coordinate systems whose origin lies in the bottom-left, this
// means normalization to (BL,TR) ordering. For systems with origin in the
// top-left, this means (TL,BR) ordering.
function normalizeRect(rect) {
	const r = rect.slice(0); // clone rect
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

// Applies the transform to the rectangle and finds the minimum axially
// aligned bounding box.
export function getAxialAlignedBoundingBox(r, m) {
	const p1 = applyTransform(r, m);
	const p2 = applyTransform(r.slice(2, 4), m);
	const p3 = applyTransform([r[0], r[3]], m);
	const p4 = applyTransform([r[2], r[1]], m);
	return [
		Math.min(p1[0], p2[0], p3[0], p4[0]),
		Math.min(p1[1], p2[1], p3[1], p4[1]),
		Math.max(p1[0], p2[0], p3[0], p4[0]),
		Math.max(p1[1], p2[1], p3[1], p4[1]),
	];
}

export function getRotationTransform(rect, degrees) {
	degrees = degrees * Math.PI / 180;
	let cosValue = Math.cos(degrees);
	let sinValue = Math.sin(degrees);
	let m = [cosValue, sinValue, -sinValue, cosValue, 0, 0];
	rect = normalizeRect(rect);
	let x1 = rect[0] + (rect[2] - rect[0]) / 2;
	let y1 = rect[1] + (rect[3] - rect[1]) / 2;
	let rect2 = getAxialAlignedBoundingBox(rect, m);
	let x2 = rect2[0] + (rect2[2] - rect2[0]) / 2;
	let y2 = rect2[1] + (rect2[3] - rect2[1]) / 2;
	let deltaX = x1 - x2;
	let deltaY = y1 - y2;
	m[4] = deltaX;
	m[5] = deltaY;
	return m;
}

export function getScaleTransform(rect1, rect2, m1, m2, dir) {
	let p1, p2;

	if (dir === 'tl') {
		p1 = [rect1[2], rect1[1]];
		p2 = [rect2[2], rect2[1]];
	}
	else if (dir === 'bl') {
		p1 = [rect1[2], rect1[3]];
		p2 = [rect2[2], rect2[3]];
	}
	else if (dir === 'br') {
		p1 = [rect1[0], rect1[3]];
		p2 = [rect2[0], rect2[3]];
	}
	else if (dir === 'tr') {
		p1 = [rect1[0], rect1[1]];
		p2 = [rect2[0], rect2[1]];
	}
	else if (dir === 't') {
		p1 = [rect1[2], rect1[1]];
		p2 = [rect2[2], rect2[1]];
	}
	else if (dir === 'b') {
		p1 = [rect1[0], rect1[3]];
		p2 = [rect2[0], rect2[3]];
	}
	else if (dir === 'l') {
		p1 = [rect1[2], rect1[1]];
		p2 = [rect2[2], rect2[1]];
	}
	else if (dir === 'r') {
		p1 = [rect1[0], rect1[3]];
		p2 = [rect2[0], rect2[3]];
	}

	p1 = applyTransform(p1, m1);
	p2 = applyTransform(p2, m2);

	let x = p2[0] - p1[0];
	let y = p2[1] - p1[1];

	return [1, 0, 0, 1, x, y];
}

export function scaleShape(cornerPoints, points, padding) {
	// Calculate the center of the shape
	let centerX = (cornerPoints[0][0] + cornerPoints[2][0]) / 2;
	let centerY = (cornerPoints[0][1] + cornerPoints[2][1]) / 2;

	// Calculate the direction vectors of the sides of the rectangle
	let dir1 = [cornerPoints[1][0] - cornerPoints[0][0], cornerPoints[1][1] - cornerPoints[0][1]];
	let dir2 = [cornerPoints[3][0] - cornerPoints[0][0], cornerPoints[3][1] - cornerPoints[0][1]];

	// Calculate the lengths of the sides
	let length1 = Math.sqrt(dir1[0] ** 2 + dir1[1] ** 2);
	let length2 = Math.sqrt(dir2[0] ** 2 + dir2[1] ** 2);

	// Normalize the direction vectors
	let dir1Normalized = [dir1[0] / length1, dir1[1] / length1];
	let dir2Normalized = [dir2[0] / length2, dir2[1] / length2];

	// Calculate the scaling factors
	let scaleFactor1 = (length1 + padding) / length1;
	let scaleFactor2 = (length2 + padding) / length2;

	let newPoints = points.map((point) => {
		// Calculate the vector from the center to the current point
		let vectorToPoint = [point[0] - centerX, point[1] - centerY];

		// Project the vectorToPoint onto the direction vectors to get the components along each side
		let proj1 = vectorToPoint[0] * dir1Normalized[0] + vectorToPoint[1] * dir1Normalized[1];
		let proj2 = vectorToPoint[0] * dir2Normalized[0] + vectorToPoint[1] * dir2Normalized[1];

		// Scale the components along each side and add them back together to get the scaled vector
		let scaledVector = [
			scaleFactor1 * proj1 * dir1Normalized[0] + scaleFactor2 * proj2 * dir2Normalized[0],
			scaleFactor1 * proj1 * dir1Normalized[1] + scaleFactor2 * proj2 * dir2Normalized[1]
		];

		// Calculate the new point by adding the scaled vector to the center
		return [centerX + scaledVector[0], centerY + scaledVector[1]];
	});

	return newPoints;
}

export function getBoundingBox(r, m) {
	let p1 = applyTransform(r, m);
	let p2 = applyTransform(r.slice(2, 4), m);
	return [p1[0], p1[1], p2[0], p2[1]];
}

export function inverseTransform(m) {
	const d = m[0] * m[3] - m[1] * m[2];
	return [
		m[3] / d,
		-m[1] / d,
		-m[2] / d,
		m[0] / d,
		(m[2] * m[5] - m[4] * m[3]) / d,
		(m[4] * m[1] - m[5] * m[0]) / d,
	];
}

export function calculateScale(r1, r2) {
	const r1Width = r1[2] - r1[0];
	const r1Height = r1[3] - r1[1];
	const r2Width = r2[2] - r2[0];
	const r2Height = r2[3] - r2[1];

	const r1AspectRatio = r1Width / r1Height;
	const r2AspectRatio = r2Width / r2Height;

	if (r1AspectRatio === r2AspectRatio) {
		return r2Width / r1Width;
	}

	const r1ScaledWidth = r2Height * r1AspectRatio;
	const r1ScaledHeight = r2Width / r1AspectRatio;

	if (r1ScaledWidth <= r2Width) {
		return r1ScaledWidth / r1Width;
	}

	return r1ScaledHeight / r1Height;
}

export function setCaretPosition(event) {
	// Get the x and y coordinates from the event
	const x = event.clientX;
	const y = event.clientY;

	// Get the document and window objects from the event target
	const targetDocument = event.target.ownerDocument;
	const targetWindow = targetDocument.defaultView;

	// Check if the browser supports document.caretPositionFromPoint
	if (targetDocument.caretPositionFromPoint) {
		// Get the caret position from the point
		const caretPos = targetDocument.caretPositionFromPoint(x, y);

		// Check if the caret position is valid
		if (caretPos) {
			// Create a new selection
			const selection = targetWindow.getSelection();
			selection.removeAllRanges();

			// Set the caret position
			const range = targetDocument.createRange();
			range.setStart(caretPos.offsetNode, caretPos.offset);
			range.collapse(true);
			selection.addRange(range);
		}
	} else if (targetDocument.caretRangeFromPoint) { // Check if the browser supports document.caretRangeFromPoint
		// Get the caret range from the point
		const caretRange = targetDocument.caretRangeFromPoint(x, y);

		// Check if the caret range is valid
		if (caretRange) {
			// Create a new selection
			const selection = targetWindow.getSelection();
			selection.removeAllRanges();

			// Set the caret range
			selection.addRange(caretRange);
		}
	} else {
		// Neither method is supported, add a fallback or display an error message
		console.error('Your browser does not support caret position from point.');
	}
}
