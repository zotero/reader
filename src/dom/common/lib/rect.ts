export function getBoundingRect(rects: DOMRect[]) {
	const left = Math.min(...rects.map(rect => rect.left));
	const top = Math.min(...rects.map(rect => rect.top));
	const right = Math.max(...rects.map(rect => rect.right));
	const bottom = Math.max(...rects.map(rect => rect.bottom));
	return new DOMRect(
		left,
		top,
		right - left,
		bottom - top
	);
}
