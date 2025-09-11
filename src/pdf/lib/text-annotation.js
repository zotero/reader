import {
	applyTransform,
	transform,
	inverseTransform,
	getRotationTransform,
	getScaleTransform
} from './utilities';

function measureHeight(comment, width, fontSize) {
	let customAnnotation = document.createElement('textarea');
	comment = comment || 'A';
	customAnnotation.value = comment;
	// $font-family-sans-serif
	customAnnotation.style.fontFamily = window.computedFontFamily;
	customAnnotation.style.fontSize = fontSize + 'px';
	customAnnotation.style.wordBreak = 'break-word';
	customAnnotation.style.pointerEvents = 'none';
	customAnnotation.style.position = 'absolute';
	customAnnotation.style.top = '0';
	customAnnotation.style.left = '0';
	customAnnotation.style.overflow = 'hidden';
	customAnnotation.style.visibility = 'hidden';
	customAnnotation.style.height = fontSize + 'px';
	customAnnotation.style.width = width + 'px';
	customAnnotation.style.padding = 0;
	customAnnotation.style.margin = 0;
	customAnnotation.style.outline = 'none';
	customAnnotation.style.border = 'none';
	document.body.append(customAnnotation);
	customAnnotation.offsetWidth;
	let height = customAnnotation.scrollHeight;
	customAnnotation.remove();
	return height;
}

function measureWidth(comment, fontSize) {
	let customAnnotation = document.createElement('textarea');
	comment = comment || 'A';
	customAnnotation.value = comment;
	// $font-family-sans-serif
	customAnnotation.style.fontFamily = window.computedFontFamily;
	customAnnotation.style.fontSize = fontSize + 'px';
	customAnnotation.style.wordBreak = 'break-word';
	customAnnotation.style.pointerEvents = 'none';
	customAnnotation.style.position = 'absolute';
	customAnnotation.style.top = '0';
	customAnnotation.style.left = '0';
	customAnnotation.style.overflow = 'hidden';
	customAnnotation.style.visibility = 'hidden';
	customAnnotation.style.height = 0;
	customAnnotation.style.width = 0;
	customAnnotation.style.padding = 0;
	customAnnotation.style.margin = 0;
	customAnnotation.style.outline = 'none';
	customAnnotation.style.border = 'none';
	customAnnotation.style.whiteSpace = 'nowrap';
	document.body.append(customAnnotation);
	customAnnotation.offsetWidth;
	let width = customAnnotation.scrollWidth;
	customAnnotation.remove();
	return width + 1;
}

function updatePosition(position, width, height) {
	let p = JSON.parse(JSON.stringify(position));
	let r2 = p.rects[0];
	r2[2] = r2[0] + width;
	r2[3] = r2[1] + height;
	let r1 = position.rects[0];
	let m1 = getRotationTransform(r1, position.rotation);
	let m2 = getRotationTransform(r2, position.rotation);
	let mm = getScaleTransform(r1, r2, m1, m2, 'br');
	let mmm = transform(m2, mm);
	mmm = inverseTransform(mmm);
	r2 = [
		...applyTransform(r2, m2),
		...applyTransform(r2.slice(2), m2)
	];
	let rect = [
		...applyTransform(r2, mmm),
		...applyTransform(r2.slice(2), mmm)
	];
	p.rects[0] = rect;
	return p;
}

function getBoundingRect(position) {
	let rect = position.rects[0];
	// ── compute an axis-aligned bounding-box of the rotated rectangle ──
	let rm = getRotationTransform(rect, position.rotation);

	// rotate every corner individually
	let rotatedCorners = [
		applyTransform([rect[0], rect[1]], rm), // top-left
		applyTransform([rect[2], rect[1]], rm), // top-right
		applyTransform([rect[2], rect[3]], rm), // bottom-right
		applyTransform([rect[0], rect[3]], rm)  // bottom-left
	];

	// collect x / y values
	let xs = rotatedCorners.map(pt => pt[0]);
	let ys = rotatedCorners.map(pt => pt[1]);

	// axis-aligned bounding rect of the rotated rectangle
	return [
		Math.min(...xs), // left
		Math.min(...ys), // top
		Math.max(...xs), // right
		Math.max(...ys) // bottom
	];
}

export function adjustTextAnnotationPosition(annotation, pageRect, options = {}) {
	const BORDER_PADDING = 5;
	const DEFAULT_MAX_WIDTH = 300;
	let position = annotation.position;
	let rect = position.rects[0];

	let width;
	let enforceWidth = false;
	if (
		rect[3] - rect[1] >= 2 * position.fontSize
		|| !options.adjustSingleLineWidth
	) {
		enforceWidth = true;
		width = position.rects[0][2] - position.rects[0][0];
	}
	else {
		width = measureWidth(annotation.comment, position.fontSize);
	}
	let height = measureHeight(annotation.comment, width, position.fontSize);
	if (height < 2 * position.fontSize && !enforceWidth) {
		width = measureWidth(annotation.comment, position.fontSize);
		width += 5;
		if (width > DEFAULT_MAX_WIDTH && options.enableSingleLineMaxWidth) {
			width = DEFAULT_MAX_WIDTH;
			height = measureHeight(annotation.comment, DEFAULT_MAX_WIDTH, position.fontSize);
		}
	}

	let position2 = updatePosition(position, width, height);
	rect = position2.rects[0];

	let br = getBoundingRect(position2);

	let dp = [0, 0];
	if (Array.isArray(pageRect) && pageRect.length === 4) {
		let pageLeft = pageRect[0] + BORDER_PADDING;
		let pageTop = pageRect[1] + BORDER_PADDING;
		let pageRight = pageRect[2] - BORDER_PADDING;
		let pageBottom = pageRect[3] - BORDER_PADDING;
		let [brLeft, brTop, brRight, brBottom] = br;
		// Horizontal overflow
		if (brLeft < pageLeft) {
			// we are sticking out on the left → move right
			dp[0] = pageLeft - brLeft;
		}
		else if (brRight > pageRight) {
			// we are sticking out on the right → move left
			dp[0] = -(brRight - pageRight);
		}
		// Vertical overflow
		if (brTop < pageTop) {
			// sticking out on the top → move down
			dp[1] = pageTop - brTop;
		}
		else if (brBottom > pageBottom) {
			// sticking out on the bottom → move up
			dp[1] = -(brBottom - pageBottom);
		}
	}

	if (enforceWidth) {
		rect[0] += dp[0];
		rect[2] += dp[0];
		rect[1] += dp[1];
		rect[3] += dp[1];

		let p = JSON.parse(JSON.stringify(position));
		rect = rect.map(value => parseFloat(value.toFixed(3)));
		p.rects = [rect];
		return p;
	}
	else {
		width += dp[0];
		let height = measureHeight(annotation.comment, width, position.fontSize);
		let p = updatePosition(position, width, height);
		return p;
	}
}
