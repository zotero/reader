'use strict';

import { p2v, v2p, wx, hy } from './coordinates';

export async function renderAreaImage(position) {
	let page = await PDFViewerApplication.pdfDocument.getPage(position.pageIndex + 1);
	let viewport = page.getViewport({ scale: 4 });

	position = p2v(position, viewport);

	let canvasWidth = viewport.width;
	let canvasHeight = viewport.height;

	let canvas = document.createElement('canvas');

	if (typeof PDFJSDev === 'undefined' ||
		PDFJSDev.test('MOZCENTRAL || FIREFOX || GENERIC')) {
		canvas.mozOpaque = true;
	}
	let ctx = canvas.getContext('2d', { alpha: false });

	canvas.width = (canvasWidth * 1) | 0;
	canvas.height = (canvasHeight * 1) | 0;
	canvas.style.width = canvasWidth + 'px';
	canvas.style.height = canvasHeight + 'px';

	let renderContext = {
		canvasContext: ctx,
		viewport: viewport
	};

	await page.render(renderContext).promise;

	let rect = position.rects[0];

	let left = rect[0];
	let top = rect[1];
	let width = wx(rect);
	let height = hy(rect);

	let newCanvas = document.createElement('canvas');

	newCanvas.width = width;
	newCanvas.height = height;

	let newCanvasContext = newCanvas.getContext('2d');

	if (!newCanvasContext || !canvas) {
		return '';
	}

	newCanvasContext.drawImage(
		canvas,
		left,
		top,
		width,
		height,
		0,
		0,
		width,
		height
	);

	return newCanvas.toDataURL('image/png', 1);
}
