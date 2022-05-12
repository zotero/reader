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

export function drawAnnotationsOnCanvas(canvas, viewport, annotations) {
	let ctx = canvas.getContext('2d', { alpha: false });

	let scale = canvas.width / viewport.width;
	ctx.transform(scale, 0, 0, scale, 0, 0);
	ctx.globalCompositeOperation = 'multiply';

	for (let annotation of annotations) {
		let { color } = annotation;
		let position = p2v(annotation.position, viewport);
		ctx.save();
		if (annotation.type === 'highlight') {
			ctx.fillStyle = color + '80';
			for (let rect of position.rects) {
				ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		else if (annotation.type === 'note') {
			let [x, y] = position.rects[0];
			ctx.transform(1, 0, 0, 1, x, y);
			ctx.fillStyle = '#000';
			var path = new Path2D('M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z');
			ctx.fill(path);

			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(0.5, 0.5);
			ctx.lineTo(23.5, 0.5);
			ctx.lineTo(23.5, 23.5);
			ctx.lineTo(11.5, 23.5);
			ctx.lineTo(0.5, 12.5);
			ctx.closePath();
			ctx.fill();

			ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
			ctx.beginPath();
			ctx.moveTo(0.5, 12.5);
			ctx.lineTo(11.5, 12.5);
			ctx.lineTo(11.5, 23.5);
			ctx.closePath();
			ctx.fill();
		}
		else if (annotation.type === 'image') {
			let rect = position.rects[0];
			ctx.lineWidth = 2;
			ctx.strokeStyle = color;
			ctx.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		}
		else if (annotation.type === 'ink') {
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
		ctx.restore();
	}
}
