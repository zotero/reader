export type DOMRectLike = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

export function getBoundingRect(rects: DOMRectLike[]) {
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

export function rectContains(rect: DOMRectLike, x: number, y: number) {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function rectIntersects(rect1: DOMRectLike, rect2: DOMRectLike) {
	return rect1.left < rect2.right && rect1.right > rect2.left && rect1.top < rect2.bottom && rect1.bottom > rect2.top;
}

export function rectsEqual(rect1: DOMRectLike, rect2: DOMRectLike) {
	return rect1.left === rect2.left && rect1.top === rect2.top && rect1.right === rect2.right && rect1.bottom === rect2.bottom;
}

export function isPageRectVisible(rect: DOMRectLike, win: Window, margin = 50) {
	let winRect: DOMRectLike = {
		left: win.scrollX - margin,
		right: win.scrollX + win.innerWidth + margin,
		top: win.scrollY - margin,
		bottom: win.scrollY + win.innerHeight + margin,
	};
	return rectIntersects(rect, winRect);
}
