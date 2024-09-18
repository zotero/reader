// A slightly modified version of PDF.js print service
// https://github.com/zotero/pdf.js/blob/master/web/pdf_print_service.js

const CSS_UNITS = 96.0 / 72.0;

const PRINT_RESOLUTION = 300;

class PrintTask {
	constructor(
		pdfView,
		pdfjsWindow,
		pdfDocument,
		pagesOverview,
		printContainer,
		printResolution,
		optionalContentConfigPromise = null,
		onProgress,
		onFinish
	) {
		this._pdfView = pdfView;
		this.active = true;
		this.pdfDocument = pdfDocument;
		this.pagesOverview = pagesOverview;
		this.printContainer = printContainer;
		this._printResolution = printResolution || 150;
		this._optionalContentConfigPromise =
			optionalContentConfigPromise || pdfDocument.getOptionalContentConfig();
		this._printAnnotationStoragePromise = Promise.resolve();
		this.currentPage = -1;
		this.onProgress = onProgress;
		this.onFinish = onFinish;
		// The temporary canvas where renderPage paints one page at a time.
		this.scratchCanvas = pdfjsWindow.document.createElement("canvas");
	}

	// Renders the page to the canvas of the given print service, and returns
	// the suggested dimensions of the output page.
	async renderPage(
		activeServiceOnEntry,
		pdfDocument,
		pageNumber,
		size,
		printResolution
	) {
		// The size of the canvas in pixels for printing.
		const PRINT_UNITS = printResolution / 72.0;
		this.scratchCanvas.width = Math.floor(size.width * PRINT_UNITS);
		this.scratchCanvas.height = Math.floor(size.height * PRINT_UNITS);

		// The physical size of the img as specified by the PDF document.
		const width = Math.floor(size.width * CSS_UNITS) + "px";
		const height = Math.floor(size.height * CSS_UNITS) + "px";

		const ctx = this.scratchCanvas.getContext("2d");
		ctx.save();
		ctx.fillStyle = "rgb(255, 255, 255)";
		ctx.fillRect(0, 0, this.scratchCanvas.width, this.scratchCanvas.height);
		ctx.restore();

		let pdfPage = await pdfDocument.getPage(pageNumber);
		const renderContext = {
			canvasContext: ctx,
			transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0],
			viewport: pdfPage.getViewport({ scale: 1, rotation: size.rotation }),
			intent: "print",
			annotationStorage: pdfDocument.annotationStorage
		};
		await pdfPage.render(renderContext).promise;
		if (this._includeAnnotations) {
			this._pdfView.renderPageAnnotationsOnCanvas(this.scratchCanvas, renderContext.viewport, pageNumber - 1);
		}
		return {
			width, height,
		};
	}

	layout() {
		this.throwIfInactive();

		const body = document.querySelector("body");
		body.setAttribute("data-pdfjsprinting", true);

		const { width, height } = this.pagesOverview[0];
		const hasEqualPageSizes = this.pagesOverview.every(
			size => size.width === width && size.height === height
		);
		if (!hasEqualPageSizes) {
			console.warn(
				"Not all pages have the same size. The printed result may be incorrect!"
			);
		}

		// Insert a @page + size rule to make sure that the page size is correctly
		// set. Note that we assume that all pages have the same size, because
		// variable-size pages are not supported yet (e.g. in Chrome & Firefox).
		// TODO(robwu): Use named pages when size calculation bugs get resolved
		// (e.g. https://crbug.com/355116) AND when support for named pages is
		// added (http://www.w3.org/TR/css3-page/#using-named-pages).
		// In browsers where @page + size is not supported, the next stylesheet
		// will be ignored and the user has to select the correct paper size in
		// the UI if wanted.
		this.pageStyleSheet = document.createElement("style");
		this.pageStyleSheet.textContent = `@page { size: ${width}pt ${height}pt;}`;
		body.append(this.pageStyleSheet);
	}

	destroy() {
		this.active = false;
		this.printContainer.textContent = "";

		const body = document.querySelector("body");
		body.removeAttribute("data-pdfjsprinting");

		if (this.pageStyleSheet) {
			this.pageStyleSheet.remove();
			this.pageStyleSheet = null;
		}
		this.scratchCanvas.width = this.scratchCanvas.height = 0;
		this.scratchCanvas = null;
		this.onFinish();
	}

	renderPages() {
		const pageCount = this.pagesOverview.length;

		const renderNextPage = (resolve, reject) => {
			this.throwIfInactive();
			if (++this.currentPage >= pageCount) {
				this.onProgress(100);
				resolve();
				return;
			}
			const index = this.currentPage;
			this.onProgress(Math.round(index / pageCount * 100));
			this.renderPage(
				this,
				this.pdfDocument,
				/* pageNumber = */ index + 1,
				this.pagesOverview[index],
				this._printResolution,
				this._optionalContentConfigPromise,
				this._printAnnotationStoragePromise
			).then(this.useRenderedPage.bind(this)).then(function () {
				renderNextPage(resolve, reject);
			}, reject);
		};
		return new Promise(renderNextPage);
	}

	useRenderedPage(printItem) {
		this.throwIfInactive();
		const img = document.createElement("img");
		img.style.width = printItem.width;
		img.style.height = printItem.height;

		const scratchCanvas = this.scratchCanvas;
		// Don't use toBlob because in PDF.js it wasn't revoking the object
		img.src = scratchCanvas.toDataURL();

		const wrapper = document.createElement("div");
		wrapper.appendChild(img);
		this.printContainer.appendChild(wrapper);

		return new Promise(function (resolve, reject) {
			img.onload = resolve;
			img.onerror = reject;
		});
	}

	performPrint() {
		this.throwIfInactive();
		return new Promise(resolve => {
			// Push window.print in the macrotask queue to avoid being affected by
			// the deprecation of running print() code in a microtask, see
			// https://github.com/mozilla/pdf.js/issues/7547.
			setTimeout(() => {
				if (!this.active) {
					resolve();
					return;
				}
				if (typeof zoteroPrint !== 'undefined') {
					zoteroPrint().then(resolve);
				}
				else {
					window._print();
					// Delay promise resolution in case print() was not synchronous.
					setTimeout(resolve, 20); // Tidy-up.
				}
			}, 0);
		});
	}

	throwIfInactive() {
		if (!this.active) {
			throw new Error("This print request was cancelled or completed.");
		}
	}
}

function dispatchEvent(eventType) {
	const event = document.createEvent("CustomEvent");
	event.initCustomEvent(eventType, false, false, "custom");
	window.dispatchEvent(event);
}

if ("onbeforeprint" in window) {
	// Do not propagate before/afterprint events when they are not triggered
	// from within this polyfill. (FF / Chrome 63+).
	const stopPropagationIfNeeded = function (event) {
		if (event.detail !== "custom" && event.stopImmediatePropagation) {
			event.stopImmediatePropagation();
		}
	};
	window.addEventListener("beforeprint", stopPropagationIfNeeded);
	window.addEventListener("afterprint", stopPropagationIfNeeded);
}

class PDFPrintService {
	constructor({ onProgress, onFinish, pdfView }) {
		this._onProgress = onProgress;
		this._onFinish = onFinish;
		this._pdfView = pdfView;
		this._activeTask = null;

		window.addEventListener('beforeprint', this.beforePrint);
		window.addEventListener('afterprint', this.afterPrint);
	}

	beforePrint = () => {
		if (this._activeTask) {
			// There is no way to suppress beforePrint/afterPrint events,
			// but PDFPrintService may generate double events -- this will ignore
			// the second event that will be coming from native window.print().
			return;
		}

		if (!this._pdfView._iframeWindow.PDFViewerApplication.supportsPrinting) {
			throw new Error('Printing is not supported');
			return;
		}

		// The beforePrint is a sync method and we need to know layout before
		// returning from this method. Ensure that we can get sizes of the pages.
		if (!this._pdfView._iframeWindow.PDFViewerApplication.pdfViewer.pageViewsReady) {
			throw new Error('Printing is not ready');
			return;
		}

		const pagesOverview = this._pdfView._iframeWindow.PDFViewerApplication.pdfViewer.getPagesOverview();
		const printContainer = document.getElementById('printContainer');
		const printResolution = PRINT_RESOLUTION;
		const optionalContentConfigPromise = this._pdfView._iframeWindow.PDFViewerApplication.pdfViewer.optionalContentConfigPromise;

		this._activeTask = new PrintTask(
			this._pdfView,
			this._pdfView._iframeWindow,
			this._pdfView._iframeWindow.PDFViewerApplication.pdfDocument,
			pagesOverview,
			printContainer,
			printResolution,
			optionalContentConfigPromise,
			this._onProgress,
			this._onFinish
		);

		this._pdfView._iframeWindow.PDFViewerApplication.forceRendering();
		this._activeTask.layout();
	};


	afterPrint = () => {
		if (this._activeTask) {
			this._activeTask.destroy();
			this._activeTask = null;
		}
		this._pdfView._iframeWindow.PDFViewerApplication.forceRendering();
	};

	abort() {
		if (this._activeTask) {
			this._activeTask.destroy();
			this._activeTask = null;
			dispatchEvent("afterprint");
		}
		else {
			this._onFinish();
		}
	}
}

let printService;

function initPDFPrintService({ onProgress, onFinish, pdfView }) {
	if (printService) {
		printService._onProgress = onProgress;
		printService._onFinish = onFinish;
		printService._pdfView = pdfView;
		return;
	}
	printService = new PDFPrintService({ onProgress, onFinish, pdfView });
	window._print = window.print;
	window.print = function (includeAnnotations) {
		try {
			dispatchEvent("beforeprint");
		}
		finally {
			let printTask = printService._activeTask;
			printTask._includeAnnotations = includeAnnotations;
			printTask.renderPages().then(function () {
				return printTask.performPrint();
			}).catch(function () {
				// Ignore any error messages.
			}).then(function () {
				// aborts acts on the "active" print request, so we need to check
				// whether the print request (activeServiceOnEntry) is still active.
				// Without the check, an unrelated print request (created after aborting
				// this print request while the pages were being generated) would be
				// aborted.
				if (printTask === printService._activeTask) {
					printService.abort();
				}
			});
		}
	};

	window.abortPrint = function () {
		printService.abort();
	};

	// window.addEventListener(
	// 	"keydown",
	// 	function (event) {
	// 		// Intercept Cmd/Ctrl + P in all browsers.
	// 		// Also intercept Cmd/Ctrl + Shift + P in Chrome and Opera
	// 		if (
	// 			event.keyCode === /* P= */ 80 &&
	// 			(event.ctrlKey || event.metaKey) &&
	// 			!event.altKey &&
	// 			(!event.shiftKey || window.chrome || window.opera)
	// 		) {
	// 			window.print();
	//
	// 			// The (browser) print dialog cannot be prevented from being shown in
	// 			// IE11.
	// 			event.preventDefault();
	// 			if (event.stopImmediatePropagation) {
	// 				event.stopImmediatePropagation();
	// 			}
	// 			else {
	// 				event.stopPropagation();
	// 			}
	// 		}
	// 	},
	// 	true
	// );
}

export { initPDFPrintService };
