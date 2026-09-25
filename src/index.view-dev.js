import View from './common/view';
import { getSDTPack } from './worker-client.dev';
import pdf from '../demo/pdf';
import epub from '../demo/epub';
import snapshot from '../demo/snapshot';

window.dev = true;

window.createView = (options) => {
	let view = new View({
		...options,
		container: document.getElementById('view'),
		onInitialized: () => {
			console.log('Initialized view');
		},
		onInitializeFailed: () => {
			console.warn('View failed to initialize');
		},
		onSaveAnnotations: (annotations) => {
			// New annotation was created or existing was modified. Although, view, probably, won't need
			// to modify existing annotations for now
			console.log('Save annotations', annotations);
		},
		// We could have 'onDeleteAnnotations', but probably not needed, because on mobile app the deletion
		// will happen outside the view
		onSetOutline: (outline) => {
			console.log('Set outline', outline);
		},
		onRequestPassword: () => {
			console.log('Request password');
		},
		onSetThumbnails: (thumbnails) => {
			console.log('Set thumbnails', thumbnails);
		},
		onSetPageLabels: (pageLabels) => {
			console.log('Set page labels', pageLabels);
		},
		onDeleteAnnotations: (ids) => {
			console.log('Delete annotations', ids);
		},
		onSelectAnnotations: (ids) => {
			console.log('Select annotations', ids);
			view.selectAnnotations(ids);
		},
		onSetSelectionPopup: (params) => {
			// Can open or close selection popup.
			// 'params.rect' is a rectangle around which selection popup should be positioned.
			// 'params.annotation' is pre-created annotation that should actually be created by the app,
			// if user presses 'highlight' in the selection popup.
			// TODO: 'onSetSelectionPopup' will also be called when view is being scrolled, but it doesn't do that yet.
			// Selection popup should either change its position or stay hidden while scrolling is in progress
			console.log('Set selection popup', params);
		},
		onSetAnnotationPopup: (params) => {
			// Similar to 'onSetSelectionPopup'. Can open or close selection popup. Will also be
			// triggered by scroll. Although possibly this won't be needed for mobile app because
			// annotation popup can be opened (or annotation selected in sidebar) when
			// 'onSelectAnnotations' is fired
			console.log('Set annotation popup', params);
		},
		onOpenLink: (url) => {
			console.log('Open external link', url);
		},
		onFindResult: (result) => {
			// TODO: This is not currently called because onSetFindState is not called from EPUB and snapshot views.

			// 'result' example:
			// let result = {
			// 	total: 2
			// 	index: 0,
			// 	snippets: ['…first result snippet…', '…second result snippet…']
			// };

			// Once user picks a result, trigger the same search again, but with the snippet index
			// to focus specific result:
			// view.find({ …, index: 123 })
			console.log('Received find result', result);
		},
		onChangeViewState: (state) => {
			// Provides view state that can be later used to re-create the view at the same position, zoom, etc.
			// The current position (similar to attachmentLastPageIndex setting for PDF) will be taken from here
			console.log('View state changed', state);
		},
		onChangeViewStats: (stats) => {
			// Provides useful information about the view
			console.log('View stats changed', stats);
		},
		onBackdropTap: (event) => {
			console.log('Backdrop tap', event);
		},
	});

	window._view = view;
};

// Stand-in for the app's native PDF renderer in standalone Reading Mode
// (?type=sdt): render the requested page regions with pdf.js
let pdfDocumentPromise = null;
async function renderPageRegionImages({ requestID, pageIndex, rects, scale }) {
	pdfDocumentPromise ??= (async () => {
		let pdfjsLib = await import(/* webpackIgnore: true */ new URL('pdf/build/pdf.mjs', window.location).href);
		pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf/build/pdf.worker.mjs', window.location).href;
		let res = await fetch(pdf.fileName);
		return pdfjsLib.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
	})();
	let images = [];
	try {
		let page = await (await pdfDocumentPromise).getPage(pageIndex + 1);
		let viewport = page.getViewport({ scale });
		let canvas = document.createElement('canvas');
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
		for (let rect of rects) {
			let [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
			let left = Math.min(x1, x2);
			let top = Math.min(y1, y2);
			let width = Math.abs(x2 - x1);
			let height = Math.abs(y2 - y1);
			let crop = document.createElement('canvas');
			crop.width = Math.max(1, Math.round(width));
			crop.height = Math.max(1, Math.round(height));
			crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
			images.push(crop.toDataURL('image/png'));
		}
	}
	catch (e) {
		console.warn('Failed to render page region images', e);
		images = rects.map(() => '');
	}
	window._view.setPageRegionImages(requestID, images);
}

async function main() {
	if (window._view) {
		throw new Error('View is already initialized');
	}
	let queryString = window.location.search;
	let urlParams = new URLSearchParams(queryString);
	let type = urlParams.get('type') || 'snapshot';
	let platform = urlParams.get('platform') || (/Android/.test(navigator.userAgent) ? 'android' : undefined);
	// Standalone Reading Mode (?type=sdt) of the PDF demo
	let sourceType = type === 'sdt' ? 'pdf' : null;
	let demo;
	if (type === 'pdf' || type === 'sdt') {
		demo = pdf;
	}
	else if (type === 'epub') {
		demo = epub;
	}
	else if (type === 'snapshot') {
		demo = snapshot;
	}
	let res = await fetch(demo.fileName);
	window.createView({
		type,
		sourceType,
		platform,
		onRequestPageRegionImages: type === 'sdt' ? renderPageRegionImages : undefined,
		// Test on-demand annotation image delivery by appending '&onDemandImages',
		// then calling window._view.renderAnnotationImages([id, …]) in the console
		onRenderAnnotationImage: urlParams.has('onDemandImages')
			? ({ id, image }) => console.log('Render annotation image', id, image)
			: undefined,
		data: {
			buf: new Uint8Array(await res.arrayBuffer()),
		},
		annotations: demo.annotations,
		viewState: type === 'sdt' ? undefined : demo.state,
		// location: {
		// 	annotationID: 123
		// },
		// viewState: {
		// 	scale: 2
		// },
	});

	// Hand over the SDT pack like the mobile apps do, so Reading Mode and
	// Read Aloud work (e.g. `await _view.setReadingModeEnabled(true)`). In
	// standalone Reading Mode, this displays the view.
	getSDTPack(sourceType ?? type, demo.fileName).then((pack) => {
		if (pack.ok) {
			window._view.setSDTPack(pack);
			console.log('Set SDT pack');
		}
		else {
			console.warn('SDT pack unavailable:', pack.reason);
		}
	});

	// Examples:
	// // Initiate search
	// window._view.find({
	// 	query: 'the',
	// 	highlightAll: false,
	// 	caseSensitive: false,
	// 	entireWord: false,
	// });
	// // Cancel search
	// window._view.find(null);
	// window._view.zoomIn();
	// window._view.zoomIn();
	// window._view.zoomReset();
	// // Set annotation tool and color (currently doesn't work on snapshots TODO: Fix)
	// window._view.setTool({ type: 'highlight', color: '#ffd400' });
	// Clear annotation tool
	// window._view.setTool();

	// Add/replace annotation in the view. See complete annotation examples in
	// demo/epub/annotations.js and demo/snapshot/annotations.js
	// window._view.setAnnotations([
	// 	{
	// 		id: "FZMV3CF6",
	// 		type: "highlight",
	// 		color: "#a28ae5",
	// 		position: {
	// 			…
	// 		}
	// 		…
	// 	}
	// ]);

	// Remove annotation from the view
	// window._view.unsetAnnotations(['FZMV3CF6']);
}

main();
