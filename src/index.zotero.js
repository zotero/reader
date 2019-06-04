import Viewer from "./viewer.js"

document.addEventListener("webviewerloaded", (e) => {
	window.PDFViewerApplicationOptions.set("disableHistory", true);
	window.PDFViewerApplicationOptions.set("eventBusDispatchToDOM", true);
	window.PDFViewerApplicationOptions.set("isEvalSupported", false);
	window.PDFViewerApplicationOptions.set("defaultUrl", '');
	window.PDFViewerApplicationOptions.set("cMapUrl", 'cmaps/');
	window.PDFViewerApplicationOptions.set("cMapPacked", true);
	window.PDFViewerApplicationOptions.set("workerSrc", 'pdf.worker.js');
	window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
	window.PDFViewerApplication.externalServices.createPreferences = function () {
		return window.PDFViewerApplicationOptions;
	};
	window.PDFViewerApplication.isViewerEmbedded = true;
}, true);

var viewer;

window.addEventListener('message', function (message) {
	if (message.data.parent) return;
	let data = message.data;
	if (data.op === 'open') {
		viewer = new Viewer({
			onSetAnnotation: function (annotation) {
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
			userId: data.userId,
			label: data.label,
			url: data.url,
			annotations: data.annotations,
			state: data.state
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

window.isViewerReady = true;
