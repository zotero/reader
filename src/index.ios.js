import View from './common/view';

function postMessage(event, params = {}) {
	window.webkit.messageHandlers.textHandler.postMessage({ event, params });
}

window.createView = (options) => {
	window._view = new View({
		...options,
		container: document.getElementById('view'),
		data: {
			// TODO: Implement a more efficient way to transfer large files
			buf: new Uint8Array(options.buf)
		},
		onSaveAnnotations: (annotations) => {
			postMessage('onSaveAnnotations', { annotations });
		},
		onSetOutline: (outline) => {
			postMessage('onSetOutline', { outline });
		},
		onSelectAnnotations: (ids) => {
			postMessage('onSelectAnnotations', { ids });
		},
		onSetSelectionPopup: (params) => {
			postMessage('onSetSelectionPopup', params);
		},
		onSetAnnotationPopup: (params) => {
			postMessage('onSetAnnotationPopup', params);
		},
		onOpenLink: (url) => {
			postMessage('onOpenLink', { url });
		},
		onFindResult: (result) => {
			postMessage('onFindResult', result);
		},
		onChangeViewState: (state) => {
			postMessage('onChangeViewState', { state });
		},
		onChangeViewStats: (stats) => {
			postMessage('onChangeViewStats', { stats });
		}
	});
};

// Notify when iframe is loaded
postMessage('onInitialized');
