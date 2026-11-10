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
const THUMBNAIL_WIDTH = 120; // px

function getThumbnailDimensions({ width, height }, { maxWidth, maxHeight } = {}) {
	if (maxWidth === undefined && maxHeight === undefined) {
		maxWidth = THUMBNAIL_WIDTH;
	}
	const scale = Math.min(
		maxWidth === undefined ? Infinity : maxWidth / width,
		maxHeight === undefined ? Infinity : maxHeight / height
	);
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
		scale,
	};
}


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
		this._onInit = options.onInit || options.onUpdate;
		this._onUpdate = options.onUpdate;
		this._onRender = options.onRender;
		this._window = options.window;
		this._thumbnails = [];
		this._renderOptions = [];
		this._initialized = false;
		this._generation = 0;
		// Pages whose thumbnails were requested and haven't been delivered yet, with their render options
		this._requested = new Map();
		this._inFlight = new Map();
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
		let { width, height } = getThumbnailDimensions(defaultViewport);

		for (let pageNum = 1; pageNum <= pagesCount; ++pageNum) {
			this._thumbnails.push({
				pageIndex: pageNum - 1,
				width,
				height
			});
		}
		this._onInit(this._thumbnails);
	}

	async _render(pageIndex, options) {
		let generation = this._generation;
		this._requested.delete(pageIndex);
		this._inFlight.set(pageIndex, options);
		try {
			await this._renderThumbnail(pageIndex, options);
		}
		finally {
			// After clear() the entry belongs to the render that was started again
			if (generation === this._generation) {
				this._inFlight.delete(pageIndex);
			}
		}
	}

	async _renderThumbnail(pageIndex, options) {
		let { pdfDocument } = this._window.PDFViewerApplication;
		let generation = this._generation;

		let pdfPage = await pdfDocument.getPage(pageIndex + 1);
		let viewport = pdfPage.getViewport({ scale: 1 });
		let { width: canvasWidth, height: canvasHeight, scale }
			= getThumbnailDimensions(viewport, options);

		let thumbnail = this._thumbnails[pageIndex];
		if (thumbnail?.image && !thumbnail.forceRerender
				&& thumbnail.width === canvasWidth
				&& thumbnail.height === canvasHeight) {
			if (this._onRender) {
				this._onRender(thumbnail);
			}
			return;
		}

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

		let renderedThumbnail;
		try {
			await renderTask.promise;
		}
		catch (e) {
			console.log(e);
		}
		finally {
			await this._pdfView.renderPageAnnotationsOnCanvas(canvas, drawViewport, pageIndex);
			// Thumbnails are cleared when the color scheme changes. A render that started before that
			// would be using the previous scheme, so its result must not be kept
			if (generation === this._generation) {
				const reducedCanvas = this._reduceImage(canvas, canvasWidth, canvasHeight);
				renderedThumbnail = {
					pageIndex,
					width: canvasWidth,
					height: canvasHeight,
					image: reducedCanvas.toDataURL()
				};
				this._thumbnails = this._thumbnails.slice();
				this._thumbnails[pageIndex] = renderedThumbnail;
				this._renderOptions[pageIndex] = options;
			}

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
		if (this._onRender && renderedThumbnail) {
			this._onRender(renderedThumbnail);
		}
		else {
			this._onUpdate(this._thumbnails);
		}
	}

	render(pageIndexes = [], options) {
		this._queueRender(pageIndexes, options);
	}

	rerender(pageIndexes = []) {
		this._queueRender(pageIndexes, undefined, true);
	}

	_queueRender(pageIndexes, options, rerenderOnly = false) {
		// If there are no thumbnails being rerendered due to annotation changes,
		// clear the rendering queue to only render the thumbnails that were recently
		// scrolled into view in the sidebar thumbnails view
		if (!this._thumbnails.some(x => x.forceRerender)) {
			// Ending the queue also drops renders that were requested but haven't started yet.
			// The app requests thumbnails one page at a time and expects every one of them
			// to be delivered, so keep those
			let notStarted = Array.from(this._requested);
			this._renderQueue.end();
			this._requested.clear();
			for (let [pageIndex, pageOptions] of notStarted) {
				this._enqueue(pageIndex, pageOptions);
			}
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
			let pageOptions = rerenderOnly
				? this._renderOptions[pageIndex]
				: options;
			if (rerenderOnly) {
				this._renderQueue.unshift(async () => this._render(pageIndex, pageOptions));
			}
			else {
				this._enqueue(pageIndex, pageOptions);
			}
		}
	}

	_enqueue(pageIndex, options) {
		this._requested.set(pageIndex, options);
		this._renderQueue.unshift(async () => this._render(pageIndex, options));
	}

	clear() {
		this._generation++;
		this._renderQueue.end();
		this._thumbnails = this._thumbnails.map(x => ({ ...x, image: undefined }));
		this._renderOptions = [];
		this._onUpdate(this._thumbnails);
		// Ending the queue dropped the pending renders and the ones in flight are discarded,
		// so render everything that was asked for again with the new color scheme
		let outstanding = new Map([...this._requested, ...this._inFlight]);
		this._requested.clear();
		for (let [pageIndex, options] of outstanding) {
			this._enqueue(pageIndex, options);
		}
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

export { getThumbnailDimensions, PDFThumbnails };
