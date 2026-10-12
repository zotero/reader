// Plan against stable sizing constraints, never the popup's current content size.
// The returned CSS anchors an edge, so growing content does not move its pointer.
export function getStableAttachment({ rect, viewport, width, height, padding = 10 }) {
	let [vw, vh] = viewport;
	let marginX = Math.min(padding, vw / 2);
	let marginY = Math.min(padding, vh / 2);
	width = Math.max(0, Math.min(width, vw - 2 * marginX));
	height = Math.max(0, Math.min(height, vh - 2 * marginY));
	let clamp = (value, min, max) => Math.max(min, Math.min(value, max));
	let anchorX = clamp((rect[0] + rect[2]) / 2, marginX, vw - marginX);
	let anchorY = clamp((rect[1] + rect[3]) / 2, marginY, vh - marginY);
	let above = clamp(rect[1] - padding, marginY, vh - marginY);
	let below = clamp(rect[3] + padding, marginY, vh - marginY);
	let fitsAbove = above - marginY >= height;
	let fitsBelow = vh - marginY - below >= height;
	let left = anchorX - width / 2;
	let side;
	if (left < marginX) side = 'right';
	else if (left + width > vw - marginX) side = 'left';
	else if (fitsBelow) side = 'bottom';
	else if (fitsAbove) side = 'top';
	else side = anchorX >= vw / 2 ? 'left' : 'right';
	// In narrow panes a side card would cover its own anchor. Use the larger
	// vertical region instead, still chosen from constraints rather than content.
	if (side === 'left' || side === 'right') {
		let fitsLeft = anchorX - padding - marginX >= width;
		let fitsRight = vw - marginX - anchorX - padding >= width;
		if (!(side === 'left' ? fitsLeft : fitsRight)) {
			if (side === 'left' ? fitsRight : fitsLeft) side = side === 'left' ? 'right' : 'left';
			else side = above - marginY >= vh - marginY - below ? 'top' : 'bottom';
		}
		if (anchorY < marginY + 20 || anchorY > vh - marginY - 20) {
			side = above - marginY >= vh - marginY - below ? 'top' : 'bottom';
		}
	}
	if ((side === 'top' || side === 'bottom') && above === marginY && below === vh - marginY) {
		// A rect spanning the viewport has no usable outside edge. Attach to its
		// visible anchor, as the side-placement fallback does for very wide rects.
		above = Math.max(marginY, anchorY - padding);
		below = Math.min(vh - marginY, anchorY + padding);
		side = above - marginY >= vh - marginY - below ? 'top' : 'bottom';
	}

	let style = { width, maxWidth: width, maxHeight: height };
	if (side === 'top' || side === 'bottom') {
		left = clamp(left, marginX, vw - marginX - width);
		if (side === 'top') style.bottom = vh - above;
		else style.top = below;
		style.maxHeight = Math.min(height, side === 'top' ? above - marginY : vh - marginY - below);
		style['--popup-pointer-x'] = `${anchorX - left}px`;
	}
	else {
		if (side === 'left') {
			left = rect[0] - width - padding;
			if (left < marginX) left = anchorX - width - padding;
		}
		else {
			left = rect[2] + padding;
			if (left + width > vw - marginX) left = anchorX + padding;
		}
		left = clamp(left, marginX, vw - marginX - width);
		let inset = Math.min(20, height / 2);
		let growDown = anchorY <= vh / 2;
		let edge = growDown ? anchorY - inset : anchorY + inset;
		if (growDown) style.top = edge;
		else style.bottom = vh - edge;
		style.maxHeight = Math.min(height, growDown ? vh - marginY - edge : edge - marginY);
		style.minHeight = Math.min(2 * inset, style.maxHeight);
		style['--popup-pointer-y'] = growDown ? `${inset}px` : `calc(100% - ${inset}px)`;
	}
	style.left = left;
	style['--popup-available-height'] = `${style.maxHeight}px`;
	return { side, style };
}
