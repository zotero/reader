import Viewer from "./viewer.js"

let annotations = [];

const viewer = new Viewer({
	onSetAnnotation: function (annotation) {
		console.log("Set annotation", annotation);
	},
	onDeleteAnnotation: function (annotationId) {
		console.log("Delete annotation", annotationId);
	},
	onSetState: function (state) {
		console.log("Set state", state);
	},
	userId: 123,
	label: "john",
	url: "compressed.tracemonkey-pldi-09.pdf",
	annotations,
	state: null
});

document.addEventListener("webviewerloaded", (e) => {
	window.PDFViewerApplicationOptions.set("disableHistory", true);
	window.PDFViewerApplicationOptions.set("eventBusDispatchToDOM", true);
	window.PDFViewerApplicationOptions.set("isEvalSupported", false);
	window.PDFViewerApplicationOptions.set("defaultUrl", "");
	window.PDFViewerApplicationOptions.set("cMapUrl", 'cmaps/');
	window.PDFViewerApplicationOptions.set("cMapPacked", true);
	window.PDFViewerApplicationOptions.set("workerSrc", './pdf.worker.js');
	
	window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
	window.PDFViewerApplication.externalServices.createPreferences = function () {
		return window.PDFViewerApplicationOptions;
	};
	window.PDFViewerApplication.isViewerEmbedded = true;
}, true);
