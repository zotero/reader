import { darkenHex, fitRectIntoRect, getPositionBoundingRect } from './lib/utilities';
import { p2v } from './lib/coordinates';
import { DARKEN_INK_AND_TEXT_COLOR } from '../common/defines';

const SCALE = 4;
const PATH_BOX_PADDING = 10; // pt
const MIN_PATH_BOX_SIZE = 30; // pt

export function calculateInkImageRect(position) {
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
	return rect;
}

class PDFRenderer {
	constructor(options) {
		this._pdfView = options.pdfView;
		this._processing = false;
		this._lastRendered = new Map();
	}

	async _renderNext() {
		if (this._processing) {
			return;
		}
		this._processing = true;
		let annotation = this._pdfView._annotations.find(x => ['image', 'ink'].includes(x.type) && !x.image);
		if (annotation) {
			let lastRendered = this._lastRendered.get(annotation.id);
			if (!lastRendered || lastRendered < annotation.dateModified) {
				this._lastRendered.set(annotation.id, annotation.dateModified);
				let image = await this._renderAnnotationImage(annotation);
				if (image) {
					this._pdfView._onUpdateAnnotations([{ id: annotation.id, image }]);
				}
				setTimeout(() => this._renderNext());
			}
		}
		this._processing = false;
	}

	async _renderAnnotationImage(annotation) {
		let { position, color } = annotation;

		let page = await this._pdfView._iframeWindow.PDFViewerApplication.pdfDocument.getPage(position.pageIndex + 1);

		// Create a new position that just contains single rect that is a bounding
		// box of image or ink annotations
		let expandedPosition = { pageIndex: position.pageIndex };
		if (position.rects) {
			// Image annotations have only one rect
			expandedPosition.rects = position.rects;
		}
		// paths
		else {
			let rect = calculateInkImageRect(position);
			expandedPosition.rects = [fitRectIntoRect(rect, page.view)];
		}

		let rect = expandedPosition.rects[0];
		let maxScale = Math.sqrt(
			this._pdfView._iframeWindow.PDFViewerApplication.pdfViewer.maxCanvasPixels
			/ ((rect[2] - rect[0]) * (rect[3] - rect[1]))
		);
		let scale = Math.min(SCALE, maxScale);

		expandedPosition = p2v(expandedPosition, page.getViewport({ scale }));
		rect = expandedPosition.rects[0];

		let viewport = page.getViewport({ scale, offsetX: -rect[0], offsetY: -rect[1] });
		position = p2v(position, viewport);

		let canvasWidth = (rect[2] - rect[0]);
		let canvasHeight = (rect[3] - rect[1]);

		let canvas = this._pdfView._iframeWindow.document.createElement('canvas');
		let ctx = canvas.getContext('2d', { alpha: false });

		if (!canvasWidth || !canvasHeight) {
			return '';
		}

		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas.style.width = canvasWidth + 'px';
		canvas.style.height = canvasHeight + 'px';

		ctx.skipBlender = true;
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
			ctx.strokeStyle = darkenHex(color, DARKEN_INK_AND_TEXT_COLOR);
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

		let image = canvas.toDataURL('image/png', 1);

		// Zeroing the width and height causes Firefox to release graphics
		// resources immediately, which can greatly reduce memory consumption. (PDF.js)
		canvas.width = 0;
		canvas.height = 0;

		return image;
	}


	_trimCanvas(canvas, ctx, padding = 0) {
		const width = canvas.width;
		const height = canvas.height;
		const imageData = ctx.getImageData(0, 0, width, height);
		const data = new Uint32Array(imageData.data.buffer);

		let minX = width, minY = height, maxX = 0, maxY = 0;
		let foundNonWhitePixel = false;

		// Scan for non-white, non-transparent pixels
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const index = y * width + x;
				// Use the first pixel as reference for the background color
				if (data[index] !== data[0]) {
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
					foundNonWhitePixel = true;
				}
			}
		}

		// If no non-white pixel is found, return the original canvas and an empty rect
		if (!foundNonWhitePixel) {
			return {
				canvas: canvas,
				rect: [0, 0, width, height]
			};
		}

		// Apply padding and ensure bounds do not exceed canvas dimensions
		minX = Math.max(0, minX - padding);
		minY = Math.max(0, minY - padding);
		maxX = Math.min(width - 1, maxX + padding);
		maxY = Math.min(height - 1, maxY + padding);

		// Calculate dimensions of the content area with padding
		const trimmedWidth = maxX - minX + 1;
		const trimmedHeight = maxY - minY + 1;

		// Extract the content area with padding
		const trimmedData = ctx.getImageData(minX, minY, trimmedWidth, trimmedHeight);

		// Clear the canvas and resize it
		canvas.width = trimmedWidth;
		canvas.height = trimmedHeight;

		// Draw the trimmed image data back onto the resized canvas
		ctx.putImageData(trimmedData, 0, 0);

		// Return the modified canvas and the bounding rectangle
		return {
			canvas: canvas,
			rect: [minX, minY, minX + trimmedWidth, minY + trimmedHeight]
		};
	}

	async renderPreviewPage(position) {
		let page = await this._pdfView._iframeWindow.PDFViewerApplication.pdfDocument.getPage(position.pageIndex + 1);

		// Create a new position that just contains single rect that is a bounding
		// box of image or ink annotations
		let expandedPosition = { pageIndex: position.pageIndex };

		// Image annotations have only one rect
		expandedPosition.rects = position.rects;

		let rect = expandedPosition.rects[0];

		let dpr = window.devicePixelRatio;
		let viewer = this._pdfView._iframeWindow.PDFViewerApplication.pdfViewer;


		let currentScale = viewer._currentScale;

		// Only boost when zooming in
		let extraScale = currentScale > 1 ? 1 + (currentScale - 1) * 1.8 : currentScale;

		let scale = dpr * extraScale; // actual render scale

		// Honour max-canvas-pixel limit
		let { width: viewportWidth, height: viewportHeight } = page.getViewport({ scale: 1 });
		let maxScale = Math.sqrt(viewer.maxCanvasPixels / (viewportWidth * viewportHeight));
		if (scale > maxScale) {
			scale = maxScale;
		}

		let viewport = page.getViewport({ scale });
		let position2 = p2v(position, viewport);
		let canvasWidth = viewport.width;
		let canvasHeight = viewport.height;

		let canvas = this._pdfView._iframeWindow.document.createElement('canvas');
		let ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

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

		let { canvas: canvas2, rect: rect2 } = this._trimCanvas(canvas, ctx, 15);

		// Render the dot after trimming the canvas to make sure it doesn't interfere with trimming
		rect = position2.rects[0];
		ctx.fillStyle = '#f57b7b';
		ctx.globalCompositeOperation = 'multiply';
		if (rect[2] - rect[0] < 5 || rect[3] - rect[1] < 5) {
			let radius = 7;
			let centerX = (rect[0] + rect[2]) / 2;
			let centerY = (rect[1] + rect[3]) / 2;
			if (centerX < rect2[0]) {
				centerX = radius;
			}
			else if (centerX > rect2[2]) {
				centerX = rect2[2] - radius;
			}
			if (centerY < rect2[1]) {
				centerY = radius;
			}
			else if (centerY > rect2[3]) {
				centerY = rect2[3] - radius;
			}
			ctx.beginPath();
			ctx.arc(centerX, centerY, 7, 0, Math.PI * 2, false);
			ctx.fill();
		}
		else {
			// Adjust x and y after trimming
			let x = rect[0] - rect2[0];
			let y = rect[1] - rect2[1];
			ctx.fillRect(x, y, rect[2] - rect[0], rect[3] - rect[1]);
		}

		let width = canvas2.width / dpr;
		let height = canvas2.height / dpr;

		let rect3 = position2.rects[0].slice();
		let x = (rect3[0] + rect3[2]) / 2;
		let y = (rect3[1] + rect3[3]) / 2;
		x -= rect2[0];
		y -= rect2[1];
		x /= dpr;
		y /= dpr;

		let image = canvas2.toDataURL('image/png', 1);

		// Zeroing the width and height causes Firefox to release graphics
		// resources immediately, which can greatly reduce memory consumption. (PDF.js)
		canvas.width = 0;
		canvas.height = 0;

		return { image, width, height, x, y };
	}

	start() {
		this._renderNext();
	}

	stop() {

	}
}

export default PDFRenderer;
