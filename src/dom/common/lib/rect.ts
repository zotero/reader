export function getBoundingRect(rects: DOMRectReadOnly[]) {
	let left = Math.min(...rects.map(rect => rect.left));
	let top = Math.min(...rects.map(rect => rect.top));
	let right = Math.max(...rects.map(rect => rect.right));
	let bottom = Math.max(...rects.map(rect => rect.bottom));
	return new DOMRect(
		left,
		top,
		right - left,
		bottom - top
	);
}

export function rectContainsPoint(rect: DOMRectReadOnly, x: number, y: number) {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function rectContainsRect(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly) {
	return (
		rect2.left >= rect1.left
		&& rect2.right <= rect1.right
		&& rect2.top >= rect1.top
		&& rect2.bottom <= rect1.bottom
	);
}

export function rectsIntersect(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly) {
	return rect1.left < rect2.right && rect1.right > rect2.left && rect1.top < rect2.bottom && rect1.bottom > rect2.top;
}

export function rectsEqual(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly) {
	return rect1.left === rect2.left && rect1.top === rect2.top && rect1.right === rect2.right && rect1.bottom === rect2.bottom;
}

export function isPageRectVisible(rect: DOMRectReadOnly, win: Window, margin = 50) {
	if (isErrorRect(rect)) {
		return false;
	}
	return rectsIntersect(
		rect,
		expandRect(DOMRect.fromRect({
			x: win.scrollX,
			y: win.scrollY,
			width: win.innerWidth,
			height: win.innerHeight,
		}), margin)
	);
}

export function isPageRectFullyVisible(rect: DOMRectReadOnly, win: Window) {
	if (isErrorRect(rect)) {
		return false;
	}
	return rectContainsRect(
		DOMRect.fromRect({
			x: win.scrollX,
			y: win.scrollY,
			width: win.innerWidth,
			height: win.innerHeight,
		}),
		rect,
	);
}

export function pageRectToClientRect(pageRect: DOMRectReadOnly, win: Window) {
	return new DOMRect(
		pageRect.left - win.scrollX,
		pageRect.top - win.scrollY,
		pageRect.right - pageRect.left,
		pageRect.bottom - pageRect.top
	);
}

export function expandRect(rect: DOMRectReadOnly, marginInline: number, marginBlock: number = marginInline): DOMRect {
	return DOMRect.fromRect({
		x: rect.left - marginInline,
		y: rect.top - marginBlock,
		width: rect.width + marginInline * 2,
		height: rect.height + marginBlock * 2,
	});
}

export function isErrorRect(rect: DOMRectReadOnly) {
	return rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0;
}
