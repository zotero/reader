import { closestElement } from './nodes';

export function getSelectionRanges(selection: Selection): Range[] {
	let ranges = [];
	for (let i = 0; i < selection.rangeCount; i++) {
		ranges.push(selection.getRangeAt(i));
	}
	return ranges;
}

export function makeDragImageForTextSelection(selection: Selection): HTMLCanvasElement {
	// Normally the browser does the work of generating the drag image for a text drag. We can't use that
	// when we synthesize our own, so instead we'll do something silly with a canvas to make a
	// passable drag image (probably not a great one).

	let text = selection.toString();
	if (text.length > 100) {
		text = text.slice(0, 100) + '…';
	}

	let computedStyle = getComputedStyle(closestElement(selection.anchorNode!)!);
	let fontSize = computedStyle.fontSize;
	let fontFamily = computedStyle.fontFamily;
	let font = fontSize + ' ' + fontFamily;

	let canvas = document.createElement('canvas');
	let ctx = canvas.getContext('2d')!;
	ctx.font = font;
	let metrics = ctx.measureText(text);

	canvas.width = metrics.width;
	canvas.height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
	ctx.font = font;
	ctx.textBaseline = 'top';
	ctx.fillText(text, 0, 0);

	return canvas;
}
