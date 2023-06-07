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
