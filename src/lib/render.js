'use strict';

import { p2v } from './coordinates';
import { fitRectIntoRect, getPositionBoundingRect } from './utilities';

const SCALE = 4;
const PATH_BOX_PADDING = 10; // pt
const MIN_PATH_BOX_SIZE = 30; // pt

export async function renderAreaImage(annotation) {
	let { position, color } = annotation;

	let page = await PDFViewerApplication.pdfDocument.getPage(position.pageIndex + 1);

	// Create a new position that just contains single rect that is a bounding
	// box of image or ink annotations
	let expandedPosition = { pageIndex: position.pageIndex };
	if (position.rects) {
		// Image annotations have only one rect
		expandedPosition.rects = position.rects;
	}
	// paths
	else {
		let rect = getPositionBoundingRect(position);
		rect = [
			rect[0] - PATH_BOX_PADDING,
			rect[1] - PATH_BOX_PADDING,
			rect[2] + PATH_BOX_PADDING,
			rect[3] + PATH_BOX_PADDING
		];

		if (rect[2] - rect[0] < MIN_PATH_BOX_SIZE) {
			let x = rect[0] + (rect[2] - rect[0]) / 2;
			rect[0] = x - MIN_PATH_BOX_SIZE;
			rect[2] = x + MIN_PATH_BOX_SIZE;
		}

		if (rect[3] - rect[1] < MIN_PATH_BOX_SIZE) {
			let y = rect[1] + (rect[3] - rect[1]) / 2;
			rect[1] = y - MIN_PATH_BOX_SIZE;
			rect[3] = y + MIN_PATH_BOX_SIZE;
		}

		expandedPosition.rects = [fitRectIntoRect(rect, page.view)];
	}

	let rect = expandedPosition.rects[0];
	let maxScale = Math.sqrt(
		PDFViewerApplication.pdfViewer.maxCanvasPixels
		/ ((rect[2] - rect[0]) * (rect[3] - rect[1]))
	);
	let scale = Math.min(SCALE, maxScale);

	expandedPosition = p2v(expandedPosition, page.getViewport({ scale }));
	rect = expandedPosition.rects[0];

	let viewport = page.getViewport({ scale, offsetX: -rect[0], offsetY: -rect[1] });
	position = p2v(position, viewport);

	let canvasWidth = (rect[2] - rect[0]);
	let canvasHeight = (rect[3] - rect[1]);

	let canvas = document.createElement('canvas');
	let ctx = canvas.getContext('2d', { alpha: false });

	if (!canvasWidth || !canvasHeight) {
		return '';
	}

	canvas.width = canvasWidth;
	canvas.height = canvasHeight;
	canvas.style.width = canvasWidth + 'px';
	canvas.style.height = canvasHeight + 'px';

	let renderContext = {
		canvasContext: ctx,
		viewport: viewport
	};

	await page.render(renderContext).promise;

	if (position.paths) {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = position.width;
		ctx.beginPath();
		ctx.strokeStyle = color;
		for (let path of position.paths) {
			for (let i = 0; i < path.length - 1; i += 2) {
				let x = path[i];
				let y = path[i + 1];

				if (i === 0) {
					ctx.moveTo(x, y);
				}
				ctx.lineTo(x, y);
			}
		}
		ctx.stroke();
	}

	return canvas.toDataURL('image/png', 1);
}
