export function getBoundingRect(rects: DOMRect[]) {
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

export function rectContains(rect: DOMRect, x: number, y: number) {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function rectIntersects(rect1: DOMRect, rect2: DOMRect) {
	return rect1.left < rect2.right && rect1.right > rect2.left && rect1.top < rect2.bottom && rect1.bottom > rect2.top;
}

export function rectsEqual(rect1: DOMRect, rect2: DOMRect) {
	return rect1.left === rect2.left && rect1.top === rect2.top && rect1.right === rect2.right && rect1.bottom === rect2.bottom;
}

export function isClientRectVisible(rect: DOMRect, win: Window) {
	let winRect = new DOMRect(0, 0, win.innerWidth, win.innerHeight);
	return rectIntersects(rect, winRect);
}
