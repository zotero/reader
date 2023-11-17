import { darkenHex, fitRectIntoRect, getPositionBoundingRect } from './lib/utilities';
import { p2v } from './lib/coordinates';
import { DARKEN_INK_AND_TEXT_COLOR } from '../common/defines';

const SCALE = 4;
const PATH_BOX_PADDING = 10; // pt
const MIN_PATH_BOX_SIZE = 30; // pt

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

	async _renderPosition(position) {
		let SCALE = window.devicePixelRatio;
		let page = await this._pdfView._iframeWindow.PDFViewerApplication.pdfDocument.getPage(position.pageIndex + 1);

		// Create a new position that just contains single rect that is a bounding
		// box of image or ink annotations
		let expandedPosition = { pageIndex: position.pageIndex };

		// Image annotations have only one rect
		expandedPosition.rects = position.rects;

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

		let renderContext = {
			canvasContext: ctx,
			viewport: viewport
		};

		await page.render(renderContext).promise;


		let image = canvas.toDataURL('image/png', 1);

		// Zeroing the width and height causes Firefox to release graphics
		// resources immediately, which can greatly reduce memory consumption. (PDF.js)
		canvas.width = 0;
		canvas.height = 0;

		return image;
	}

	start() {
		this._renderNext();
	}

	stop() {

	}
}

export default PDFRenderer;
