/**
 * Turn a source image element (resolved from an SDT image block's anchor in the
 * base view) into a data URL that renders in the SDT overlay's iframe
 */
export async function imageElementToDataURL(el: Element): Promise<string | null> {
	if (el.tagName?.toLowerCase() !== 'img') {
		return null;
	}
	let img = el as HTMLImageElement;
	let src = img.currentSrc || img.src;
	if (src.startsWith('data:')) {
		return src;
	}
	try {
		if (img.decode) {
			await img.decode();
		}
	}
	catch {
	}
	let width = img.naturalWidth;
	let height = img.naturalHeight;
	if (!width || !height) {
		return src || null;
	}
	let canvas = el.ownerDocument.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	let ctx = canvas.getContext('2d');
	if (!ctx) {
		return src || null;
	}
	ctx.drawImage(img, 0, 0);
	try {
		return canvas.toDataURL('image/png');
	}
	catch {
		return src || null;
	}
}
