const NEAREST_MARGIN = 10;
const VERTICAL_PADDING = 5;

export function getScrollTarget({
	rect,
	scrollLeft,
	scrollTop,
	clientWidth,
	clientHeight,
	block = 'center',
	inline,
	ifNeeded,
	visibilityMargin = 0,
}) {
	let x = rect[0];
	let y = rect[1];
	let top;
	let left;
	let inlineNearest = inline === 'nearest';
	let verticallyVisible = inlineNearest && ifNeeded && !(
		y > scrollTop + clientHeight + visibilityMargin
		|| rect[3] < scrollTop - visibilityMargin
	);

	if (verticallyVisible) {
		// Preserve the vertical position independently of horizontal visibility.
	}
	else if (block === 'start') {
		top = y;
	}
	else if (block === 'nearest') {
		if (y < scrollTop + NEAREST_MARGIN) {
			top = y - NEAREST_MARGIN;
		}
		else if (y > scrollTop + clientHeight - NEAREST_MARGIN) {
			top = y - clientHeight + NEAREST_MARGIN;
		}
	}
	else {
		top = (rect[1] + rect[3]) / 2 - (clientHeight / 2) - VERTICAL_PADDING;
	}

	if (inlineNearest) {
		let right = rect[2];
		let viewportRight = scrollLeft + clientWidth;
		let targetWidth = right - x;
		if (targetWidth <= clientWidth) {
			let inlineMargin = Math.min(
				NEAREST_MARGIN,
				Math.max(0, (clientWidth - targetWidth) / 2)
			);
			if (x < scrollLeft) {
				left = x - inlineMargin;
			}
			else if (right > viewportRight) {
				left = right - clientWidth + inlineMargin;
			}
		}
		else if (x > scrollLeft) {
			left = x;
		}
		else if (right < viewportRight) {
			left = right - clientWidth;
		}
	}
	else if (block === 'nearest') {
		if (x < scrollLeft + NEAREST_MARGIN) {
			left = x - NEAREST_MARGIN;
		}
		else if (x > scrollLeft + clientWidth - NEAREST_MARGIN) {
			left = x - clientWidth + NEAREST_MARGIN;
		}
	}
	else {
		left = (rect[0] + rect[2]) / 2 - (clientWidth / 2);
	}

	return { left, top };
}

export function getFitScale({ rectWidth, rectHeight, currentScale, clientWidth, clientHeight }) {
	if (!(currentScale > 0) || !(clientWidth > 0) || !(clientHeight > 0)) {
		return null;
	}
	let factor = Math.min(
		rectWidth > clientWidth ? clientWidth / rectWidth : 1,
		rectHeight > clientHeight ? clientHeight / rectHeight : 1
	);
	return factor < 1 ? currentScale * factor : null;
}
