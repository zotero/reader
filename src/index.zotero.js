import Viewer from "./viewer.js"

document.addEventListener("webviewerloaded", (e) => {
	window.PDFViewerApplicationOptions.set("disableHistory", true);
	window.PDFViewerApplicationOptions.set("eventBusDispatchToDOM", true);
	window.PDFViewerApplicationOptions.set("isEvalSupported", false);
	window.PDFViewerApplicationOptions.set("defaultUrl", '');
	window.PDFViewerApplicationOptions.set("cMapUrl", 'cmaps/');
	window.PDFViewerApplicationOptions.set("cMapPacked", true);
	window.PDFViewerApplicationOptions.set("workerSrc", 'pdf.worker.js');
	window.PDFViewerApplicationOptions.set("historyUpdateUrl", false);
	window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
	window.PDFViewerApplication.externalServices.createPreferences = function () {
		return window.PDFViewerApplicationOptions;
	};
	window.PDFViewerApplication.isViewerEmbedded = true;
}, true);

var viewer;

window.addEventListener('message', function (message) {
	if (message.source === parent) return;
	
	if (message.data.parent) return;
	let data = message.data;

	if (data.op === 'open') {
		window.itemId = data.itemId;
		viewer = new Viewer({
			onSetAnnotation: function (annotation) {
				if (annotation.temp) return;
				console.log("Set annotation", annotation);
				parent.postMessage({op: 'setAnnotation', parent: true, annotation}, '*');
			},
			onDeleteAnnotation: function (annotationId) {
				console.log("Delete annotation", annotationId);
				parent.postMessage({op: 'deleteAnnotation', parent: true, annotationId}, '*');
			},
			onSetState: function (state) {
				console.log("Set state", state);
				parent.postMessage({op: 'setState', parent: true, state}, '*');
			},
			onClickTags(annotationId, screenX, screenY) {
				parent.postMessage({op: 'tagsPopup', x: screenX, y: screenY}, '*');
			},
			onEnterPassword(password) {
				parent.postMessage({op: 'enterPassword', password}, '*');
			},
      onDownload() {
			  parent.postMessage({op: 'save'}, '*');
      },
			userId: data.userId,
			label: data.label,
			url: 'zotero://pdf.js/pdf/' + data.libraryID + '/' + data.key,
			annotations: data.annotations,
			state: data.state,
			password: data.password
		});
	}
	else if (data.op === 'navigate') {
		viewer.navigate(data.to);
	}
	else if (data.op === 'setAnnotation') {
		viewer.setAnnotation(data.annotation);
	}
	else if (data.op === 'deleteAnnotation') {
		viewer.deleteAnnotation(data.annotationId, data.dateDeleted);
	}
});

let localized = false;

document.addEventListener("localized", (e) => {
	if (!window.PDFViewerApplication.pdfViewer || localized) return;
	localized = true;
	
	window.PDFViewerApplication.eventBus.on("documentinit", (e) => {
	});
	
	var url = new URL(window.location.href);
	var libraryID = url.searchParams.get("libraryID");
	var key = url.searchParams.get("key");
	parent.postMessage({op: 'load', libraryID, key}, '*');
});

window.isViewerReady = true;

