/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** @typedef {import("./interfaces").IL10n} IL10n */
/** @typedef {import("./interfaces").IPDFLinkService} IPDFLinkService */
/** @typedef {import("./interfaces").IRenderableView} IRenderableView */
// eslint-disable-next-line max-len
import queue from 'queue';

/** @typedef {import("./pdf_rendering_queue").PDFRenderingQueue} PDFRenderingQueue */

// import { OutputScale, RenderingStates } from "./ui_utils.js";
// import { RenderingCancelledException } from "pdfjs-lib";

const DRAW_UPSCALE_FACTOR = 2; // See comment in `PDFThumbnailView.draw` below.
const MAX_NUM_SCALING_STEPS = 3;
const THUMBNAIL_CANVAS_BORDER_WIDTH = 1; // px
const THUMBNAIL_WIDTH = 120; // px




const RenderingStates = {
	INITIAL: 0, RUNNING: 1, PAUSED: 2, FINISHED: 3,
};


/**
 * Scale factors for the canvas, necessary with HiDPI displays.
 */
class OutputScale {
	constructor() {
		const pixelRatio = window.devicePixelRatio || 1;

		/**
		 * @type {number} Horizontal scale.
		 */
		this.sx = pixelRatio;

		/**
		 * @type {number} Vertical scale.
		 */
		this.sy = pixelRatio;
	}

	/**
	 * @type {boolean} Returns `true` when scaling is required, `false` otherwise.
	 */
	get scaled() {
		return this.sx !== 1 || this.sy !== 1;
	}
}

class TempImageFactory {
	static #tempCanvas = null;

	static getCanvas(width, height, iframeWindow) {
		const tempCanvas = (this.#tempCanvas ||= iframeWindow.document.createElement("canvas"));
		tempCanvas.width = width;
		tempCanvas.height = height;

		// Since this is a temporary canvas, we need to fill it with a white
		// background ourselves. `_getPageDrawContext` uses CSS rules for this.
		const ctx = tempCanvas.getContext("2d", { alpha: false });
		ctx.save();
		ctx.fillStyle = "rgb(255, 255, 255)";
		ctx.fillRect(0, 0, width, height);
		ctx.restore();
		return [tempCanvas, tempCanvas.getContext("2d")];
	}

	static destroyCanvas() {
		const tempCanvas = this.#tempCanvas;
		if (tempCanvas) {
			// Zeroing the width and height causes Firefox to release graphics
			// resources immediately, which can greatly reduce memory consumption.
			tempCanvas.width = 0;
			tempCanvas.height = 0;
		}
		this.#tempCanvas = null;
	}
}

/**
 * @implements {IRenderableView}
 */


class PDFThumbnails {
	constructor(options) {
		this._pdfView = options.pdfView;
		this._onUpdate = options.onUpdate;
		this._window = options.window;
		this._thumbnails = [];
		this._initialized = false;
		this._renderQueue = queue({
			concurrency: 1,
			autostart: true
		});
		this._init();
	}

	async _init() {
		let { pdfDocument } = this._window.PDFViewerApplication;

		let firstPdfPage = await pdfDocument.getPage(1);

		let pagesCount = pdfDocument.numPages;
		let defaultViewport = firstPdfPage.getViewport({ scale: 1 });

		for (let pageNum = 1; pageNum <= pagesCount; ++pageNum) {
			let pageWidth = defaultViewport.width;
			let pageHeight = defaultViewport.height;
			let pageRatio = pageWidth / pageHeight;

			let canvasWidth = THUMBNAIL_WIDTH;
			let canvasHeight = (canvasWidth / pageRatio) | 0;
			let scale = canvasWidth / pageWidth;

			this._thumbnails.push({
				pageIndex: pageNum - 1,
				width: canvasWidth,
				height: canvasHeight
			});
		}
		this._onUpdate(this._thumbnails);
	}

	async _render(pageIndex) {
		let thumbnail = this._thumbnails[pageIndex];
		if (thumbnail?.image && !thumbnail.forceRerender) {
			return;
		}
		let { pdfDocument } = this._window.PDFViewerApplication;

		let pdfPage = await pdfDocument.getPage(pageIndex + 1);
		let viewport = pdfPage.getViewport({ scale: 1 });


		let pageWidth = viewport.width;
		let pageHeight = viewport.height;
		let pageRatio = pageWidth / pageHeight;

		let canvasWidth = THUMBNAIL_WIDTH;
		let canvasHeight = (canvasWidth / pageRatio) | 0;
		let scale = canvasWidth / pageWidth;


		// // Keep the no-thumbnail outline visible, i.e. `data-loaded === false`,
		// // until rendering/image conversion is complete, to avoid display issues.
		// const canvas = document.createElement("canvas");
		// const ctx = canvas.getContext("2d", { alpha: false });
		// const outputScale = new OutputScale();
		//
		// canvas.width = (DRAW_UPSCALE_FACTOR * canvasWidth * outputScale.sx) | 0;
		// canvas.height = (DRAW_UPSCALE_FACTOR * canvasHeight * outputScale.sy) | 0;
		//
		// const transform = outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : null;



		// Render the thumbnail at a larger size and downsize the canvas (similar
		// to `setImage`), to improve consistency between thumbnails created by
		// the `draw` and `setImage` methods (fixes issue 8233).
		// NOTE: To primarily avoid increasing memory usage too much, but also to
		//   reduce downsizing overhead, we purposely limit the up-scaling factor.
		const { ctx, canvas, transform } = this._getPageDrawContext(DRAW_UPSCALE_FACTOR, canvasWidth, canvasHeight);

		const drawViewport = pdfPage.getViewport({
			scale: DRAW_UPSCALE_FACTOR * scale,
		});

		const renderContext = {
			canvasContext: ctx,
			transform,
			viewport: drawViewport
		};
		const renderTask = pdfPage.render(renderContext);

		try {
			await renderTask.promise;
		}
		catch(e) {
			console.log(e);
		}
		finally {
			await this._pdfView.renderPageAnnotationsOnCanvas(canvas, drawViewport, pageIndex);
			const reducedCanvas = this._reduceImage(canvas, canvasWidth, canvasHeight);
			this._thumbnails = this._thumbnails.slice();
			this._thumbnails[pageIndex] = {
				pageIndex,
				width: canvasWidth,
				height: canvasHeight,
				image: reducedCanvas.toDataURL()
			};

			// Zeroing the width and height causes Firefox to release graphics
			// resources immediately, which can greatly reduce memory consumption.
			canvas.width = 0;
			canvas.height = 0;

			this._window.PDFViewerApplication.eventBus.dispatch("thumbnailrendered", {
				source: this,
				pageNumber: this.id,
				pdfPage: this.pdfPage,
			});
		}
		this._onUpdate(this._thumbnails);
	}

	async render(pageIndexes = [], rerenderOnly) {
		// If there are no thumbnails being rerendered due to annotation changes,
		// clear the rendering queue to only render the thumbnails that were recently
		// scrolled into view in the sidebar thumbnails view
		if (!this._thumbnails.some(x => x.forceRerender)) {
			this._renderQueue.end();
		}
		for (let pageIndex of pageIndexes) {
			let thumbnail = this._thumbnails[pageIndex];
			// Only already rendered thumbnails will be re-rendered, which means
			// if thumbnails view isn't actively used, it won't waste resources to
			// re-render thumbnails whenever annotations are updated
			if (rerenderOnly) {
				if (thumbnail.image) {
					thumbnail.forceRerender = true;
				}
				else {
					continue;
				}
			}
			this._renderQueue.unshift(async () => this._render(pageIndex));
		}
	}

	clear() {
		this._renderQueue.end();
		this._thumbnails = this._thumbnails.map(x => ({ ...x, image: undefined }));
		this._onUpdate(this._thumbnails);
	}

	_getPageDrawContext(upscaleFactor = 1, canvasWidth, canvasHeight) {
		// Keep the no-thumbnail outline visible, i.e. `data-loaded === false`,
		// until rendering/image conversion is complete, to avoid display issues.
		const canvas = this._window.document.createElement("canvas");
		const ctx = canvas.getContext("2d", { alpha: false });
		const outputScale = new OutputScale();

		canvas.width = (upscaleFactor * canvasWidth * outputScale.sx) | 0;
		canvas.height = (upscaleFactor * canvasHeight * outputScale.sy) | 0;

		const transform = outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : null;

		return { ctx, canvas, transform };
	}

	_reduceImage(img, canvasWidth, canvasHeight) {
		const { ctx, canvas } = this._getPageDrawContext(1, canvasWidth, canvasHeight);

		if (img.width <= 2 * canvas.width) {
			ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
			return canvas;
		}
		// drawImage does an awful job of rescaling the image, doing it gradually.
		let reducedWidth = canvas.width << MAX_NUM_SCALING_STEPS;
		let reducedHeight = canvas.height << MAX_NUM_SCALING_STEPS;
		const [reducedImage, reducedImageCtx] = TempImageFactory.getCanvas(reducedWidth, reducedHeight, this._window);

		while (reducedWidth > img.width || reducedHeight > img.height) {
			reducedWidth >>= 1;
			reducedHeight >>= 1;
		}
		reducedImageCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, reducedWidth, reducedHeight);
		while (reducedWidth > 2 * canvas.width) {
			reducedImageCtx.drawImage(reducedImage, 0, 0, reducedWidth, reducedHeight, 0, 0, reducedWidth >> 1, reducedHeight >> 1);
			reducedWidth >>= 1;
			reducedHeight >>= 1;
		}
		ctx.drawImage(reducedImage, 0, 0, reducedWidth, reducedHeight, 0, 0, canvas.width, canvas.height);
		return canvas;
	}
}

export { PDFThumbnails };
