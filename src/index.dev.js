import Viewer from './viewer.js';
import annotations from './demo-annotations';
import strings from './en-us.strings';

window.development = true;

let loaded = false;

function setOptions() {
	if (!window.PDFViewerApplicationOptions) {
		return;
	}
	window.PDFViewerApplicationOptions.set('isEvalSupported', false);
	window.PDFViewerApplicationOptions.set('defaultUrl', '');
	window.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
	window.PDFViewerApplicationOptions.set('standardFontDataUrl', 'standard_fonts/');
	window.PDFViewerApplicationOptions.set('cMapPacked', true);
	window.PDFViewerApplicationOptions.set('workerSrc', './pdf.worker.js');
	window.PDFViewerApplicationOptions.set('historyUpdateUrl', false);
	window.PDFViewerApplicationOptions.set('textLayerMode', 1);
	window.PDFViewerApplicationOptions.set('sidebarViewOnLoad', 0);
	window.PDFViewerApplicationOptions.set('ignoreDestinationZoom', true);
	window.PDFViewerApplicationOptions.set('renderInteractiveForms', false);
	window.PDFViewerApplicationOptions.set('printResolution', 300);
}

setOptions();
document.addEventListener('webviewerloaded', function () {
	setOptions();
	window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
	window.PDFViewerApplication.externalServices.createPreferences = function () {
		return window.PDFViewerApplicationOptions;
	};

	PDFViewerApplication.initializedPromise.then(async function () {
		if (!window.PDFViewerApplication.pdfViewer || loaded) return;
		loaded = true;
		window.PDFViewerApplication.eventBus.on('documentinit', (e) => {
			console.log('documentinit');
		});

		if (!window.isSecondView) {
			test();
		}
		// setTimeout(() => {
		//   viewer.navigate(annotations[0]);
		// }, 3000);
	});
});

window.isSecondView = !!window.frameElement && window.frameElement.id === 'secondViewIframe';
window.addEventListener('DOMContentLoaded', () => {
	if (window.isSecondView) {
		document.body.classList.add('second-view');
	}
});

async function test() {
	let res = await fetch('compressed.tracemonkey-pldi-09.pdf');
	let buf = new Uint8Array(await res.arrayBuffer());

	// Load primary view
	let vi = new ViewerInstance({
		readOnly: false,
		buf,
		annotations,
		rtl: false,
		state: null,
		location: {
			position: { pageIndex: 0, rects: [[371.395, 266.635, 486.075, 274.651]] }
		}
	});

	vi._viewer.setBottomPlaceholderHeight(0);
	vi._viewer.setToolbarPlaceholderWidth(0);

	vi._viewer.setEnableAddToNote(false);
	// vi._viewer.setBottomPlaceholderHeight(400);
	// vi._viewer.setToolbarPlaceholderWidth(50);

	// vi._viewer.navigate({
	//   'position': { 'pageIndex': 100, 'rects': [[371.395, 266.635, 486.075, 274.651]] }
	// })

	// Load second view
	let splitWrapper = document.getElementById('splitWrapper');
	let iframe = document.getElementById('secondViewIframe');
	iframe.addEventListener('load', async () => {
		console.log('iframe loaded');
		let app = iframe.contentWindow.PDFViewerApplication;
		await app.initializedPromise;
		let vi2 = new iframe.contentWindow.ViewerInstance({
			readOnly: true,
			buf,
			annotations: [],
			rtl: false,
			state: null,
		});
	});
	iframe.src = 'viewer.html?';
	splitWrapper.classList.add('enable-split');
	// splitWrapper.classList.add('horizontal');
}

class ViewerInstance {
	constructor(options) {

		let annotations = options.annotations;
		if (options.readOnly) {
			annotations.forEach(x => x.readOnly = true);
		}

		window.rtl = options.rtl;

		this._viewer = new Viewer({
			onAddToNote() {
				alert('This will add annotations to the pinned note');
			},
			onSaveAnnotations: function (annotation) {
				console.log('Save annotations', annotation);
			},
			onDeleteAnnotations: function (ids) {
				console.log('Delete annotations', JSON.stringify(ids));
			},
			onSaveImage: (annotation) => {
				console.log('Saving image', annotation);
			},
			onSetState: function (state) {
				console.log('Set state', state);
			},
			onClickTags(annotationID, event) {
				alert('This will open Zotero tagbox popup');
			},
			onDoubleClickPageLabel: (id) => {
				console.log('Open page label popup', id);
			},
			onPopup(name, data) {
				console.log(name, data);
				alert('This will open ' + name);
			},
			onClosePopup(data) {
				console.log('onClosePopup', data);
			},
			onExternalLink(url) {
				alert('This will navigate to the external link: ' + url);
			},
			onDownload() {
				alert('This will call pdf-worker to write all annotations to the PDF file and then triggers the download');
			},
			onChangeSidebarWidth(width) {
				console.log('Changed sidebar width ' + width);
			},
			onChangeSidebarOpen: (open) => {
				console.log('changeSidebarOpen', open);
			},
			buf: options.buf,
			annotations,
			state: options.state,
			location: options.location,
			sidebarWidth: 240,
			sidebarOpen: true,
			bottomPlaceholderHeight: 0,
			localizedStrings: strings,
			readOnly: options.readOnly,
			authorName: 'John',
			showAnnotations: true
			// password: 'test'
		});
	}

	uninit() {
		this._viewer.uninit();
	}
}

window.ViewerInstance = ViewerInstance;
