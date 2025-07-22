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
	if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
		let rects = position.nextPageRects;
		return [
			Math.min(...rects.map(x => x[0])),
			Math.min(...rects.map(x => x[1])),
			Math.max(...rects.map(x => x[2])),
			Math.max(...rects.map(x => x[3]))
		];
	}
	if (position.rects && (position.pageIndex === pageIndex || pageIndex === undefined)) {
		let rects = position.rects;
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

export function distanceBetweenRects(rect1, rect2) {
	const [x1A, y1A, x2A, y2A] = rect1;
	const [x1B, y1B, x2B, y2B] = rect2;
	// Calculate the horizontal distance (dx, dy) between the two rectangles
	// If rectangles overlap horizontally, dx, dy is set to 0
	const dx = Math.max(x1A, x1B) > Math.min(x2A, x2B) ? Math.max(x1A, x1B) - Math.min(x2A, x2B) : 0;
	const dy = Math.max(y1A, y1B) > Math.min(y2A, y2B) ? Math.max(y1A, y1B) - Math.min(y2A, y2B) : 0;
	return Math.hypot(dx, dy);
}

export function getTransformFromRects(rect1, rect2) {
	const x1 = rect1[0];
	const y1 = rect1[1];
	const x2 = rect1[2];
	const y2 = rect1[3];

	const x1Prime = rect2[0];
	const y1Prime = rect2[1];
	const x2Prime = rect2[2];
	const y2Prime = rect2[3];

	// Calculate scaling factors
	const scaleX = (x2Prime - x1Prime) / (x2 - x1);
	const scaleY = (y2Prime - y1Prime) / (y2 - y1);

	// Calculate translation factors
	const translateX = x1Prime - x1 * scaleX;
	const translateY = y1Prime - y1 * scaleY;

	// Create the transformation matrix for PDF
	const matrix = [
		scaleX, 0,
		0, scaleY,
		translateX, translateY
	];

	return matrix;
}

export function normalizeDegrees(degrees) {
	return ((degrees % 360) + 360) % 360;
}

export function getRotationDegrees(m) {
	let [a, b] = m;
	// Calculate the rotation in radians
	let theta = -Math.atan2(b, a);
	// Convert to degrees
	let degrees = theta * (180 / Math.PI);
	return normalizeDegrees(degrees);
}

export function hexToRgb(hex) {
	let r = parseInt(hex.slice(1, 3), 16),
		g = parseInt(hex.slice(3, 5), 16),
		b = parseInt(hex.slice(5, 7), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

export function rgbToHex(r, g, b) {
	return "#" + [r, g, b].map(x => {
		let hex = x.toString(16);
		return hex.length === 1 ? "0" + hex : hex;
	}).join('');
}

export function darkenHex(hex, percent) {
	let [r, g, b] = hexToRgb(hex).match(/\d+/g).map(Number);
	r = Math.max(0, r * (1 - percent / 100));
	g = Math.max(0, g * (1 - percent / 100));
	b = Math.max(0, b * (1 - percent / 100));
	return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
}

export function getRectsAreaSize(rects) {
	let areaSize = 0;
	for (let rect of rects) {
		areaSize += (rect[2] - rect[0]) * (rect[3] - rect[1]);
	}
	return areaSize;
}

export function getClosestObject(currentObjectRect, otherObjects, side) {
	let closestObject = null;
	let closestObjectDistance = null;

	for (let object of otherObjects) {
		let objectRect = object.rect;
		if (side === 'left') {
			if (currentObjectRect[0] >= objectRect[2]) {
				let r1 = [currentObjectRect[0], currentObjectRect[1], currentObjectRect[0], currentObjectRect[3]];
				let r2 = [objectRect[2], objectRect[1], objectRect[2], objectRect[3]];
				let distance = distanceBetweenRects(r1, r2);
				if (distance >= 0 && (!closestObject || closestObjectDistance > distance)) {
					closestObject = object;
					closestObjectDistance = distance;
				}
			}
		}
		else if (side === 'right') {
			if (objectRect[0] >= currentObjectRect[2]) {
				let r1 = [currentObjectRect[2], currentObjectRect[1], currentObjectRect[2], currentObjectRect[3]];
				let r2 = [objectRect[0], objectRect[1], objectRect[0], objectRect[3]];
				let distance = distanceBetweenRects(r1, r2);
				if (distance >= 0 && (!closestObject || closestObjectDistance > distance)) {
					closestObject = object;
					closestObjectDistance = distance;
				}
			}
		}
		else if (side === 'top') {
			if (objectRect[3] <= currentObjectRect[1]) {
				let r1 = [currentObjectRect[0], currentObjectRect[1], currentObjectRect[2], currentObjectRect[1]];
				let r2 = [objectRect[0], objectRect[3], objectRect[2], objectRect[3]];
				let distance = distanceBetweenRects(r1, r2);
				if (distance >= 0 && (!closestObject || closestObjectDistance > distance)) {
					closestObject = object;
					closestObjectDistance = distance;
				}
			}
		}
		else if (side === 'bottom') {
			if (currentObjectRect[3] <= objectRect[1]) {
				let r1 = [currentObjectRect[0], currentObjectRect[3], currentObjectRect[2], currentObjectRect[3]];
				let r2 = [objectRect[0], objectRect[1], objectRect[2], objectRect[1]];
				let distance = distanceBetweenRects(r1, r2);
				if (distance >= 0 && (!closestObject || closestObjectDistance > distance)) {
					closestObject = object;
					closestObjectDistance = distance;
				}
			}
		}
	}

	if (!closestObject) {
		for (let object of otherObjects) {
			let objectRect = object.rect;
			if (quickIntersectRect(currentObjectRect, objectRect) || !side) {
				let distance = distanceBetweenRects(currentObjectRect, objectRect);
				if ((!closestObject || closestObjectDistance > distance)) {
					closestObject = object;
					closestObjectDistance = distance;
				}
			}
		}
	}

	return closestObject;
}

export function getRangeRects(chars, offsetStart, offsetEnd) {
	let rects = [];
	let start = offsetStart;
	for (let i = start; i <= offsetEnd; i++) {
		let char = chars[i];
		if (char.lineBreakAfter || i === offsetEnd) {
			let firstChar = chars[start];
			let lastChar = char;
			let rect = [
				firstChar.rect[0],
				firstChar.inlineRect[1],
				lastChar.rect[2],
				firstChar.inlineRect[3],
			];
			rects.push(rect);
			start = i + 1;
		}
	}
	return rects;
}

export function getOutlinePath(outline, pageIndex) {
	let bestMatch = {
		path: null,
		pageIndex: -Infinity
	};

	function helper(items, path) {
		for (let i = 0; i < items.length; i++) {
			let item = items[i];
			let currentPath = path.concat(i);

			// Check if the item's pageIndex is less than or equal to the target pageIndex
			if (item.location?.position?.pageIndex <= pageIndex) {
				// Update bestMatch if this item has a higher pageIndex than the current best
				if (item.location?.position?.pageIndex > bestMatch.pageIndex) {
					bestMatch = {
						path: currentPath,
						pageIndex: item.location?.position?.pageIndex
					};
				}
			}

			// Recursively search child items if they exist
			if (item.items && item.items.length > 0) {
				helper(item.items, currentPath);
			}
		}
	}

	// Start the recursive search from the top level
	helper(outline, []);

	return bestMatch.path;
}

export function roundPositionValues(position) {
	let roundedPosition = { ...position };

	if (roundedPosition.rects) {
		roundedPosition.rects = roundedPosition.rects.map(
			rect => rect.map(value => Math.round(value * 1e3) / 1e3)
		);
	}

	if (roundedPosition.nextPageRects) {
		roundedPosition.nextPageRects = roundedPosition.nextPageRects.map(
			rect => rect.map(value => Math.round(value * 1e3) / 1e3)
		);
	}

	if (roundedPosition.paths) {
		roundedPosition.paths = roundedPosition.paths.map(path =>
			path.map(value => Math.round(value * 1e3) / 1e3)
		);
	}

	if (roundedPosition.width !== undefined) {
		roundedPosition.width = Math.round(roundedPosition.width * 1e3) / 1e3;
	}

	return roundedPosition;
}
