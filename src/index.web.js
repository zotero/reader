import Viewer from './viewer.js';
import strings from './en-us.strings';

// Keep this until we have a write-enabled pdf-reader web version
window.isWeb = true;

parent.addEventListener('webviewerloaded', (e) => {
	window.PDFViewerApplicationOptions.set('eventBusDispatchToDOM', true);
	window.PDFViewerApplicationOptions.set('isEvalSupported', false);
	window.PDFViewerApplicationOptions.set('defaultUrl', '');
	window.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
	window.PDFViewerApplicationOptions.set('cMapPacked', true);
	window.PDFViewerApplicationOptions.set('workerSrc', 'pdf.worker.js');
	window.PDFViewerApplicationOptions.set('historyUpdateUrl', false);
	window.PDFViewerApplicationOptions.set('textLayerMode', 1);
	// Without this PDF.js forces opening outline view when it exists
	window.PDFViewerApplicationOptions.set('sidebarViewOnLoad', 0);
	window.PDFViewerApplicationOptions.set('ignoreDestinationZoom', true);
	// Disable interactive forms because our PDF saving mechanism can't
	// save then. In addition, we don't have styling for those forms,
	// and they sometimes show popup preventing to leave tab
	window.PDFViewerApplicationOptions.set('renderInteractiveForms', false);
	window.PDFViewerApplicationOptions.set('printResolution', 300);

	window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
	window.PDFViewerApplication.externalServices.createPreferences = function () {
		return window.PDFViewerApplicationOptions;
	};

	let loaded = false;
	PDFViewerApplication.initializedPromise.then(function () {
		window.isReady = true;
		if (!window.PDFViewerApplication.pdfViewer || loaded) {
			return;
		}
		loaded = true;

		window.PDFViewerApplication.eventBus.on('documentloaded', async (event) => {
			let buf = (await window.PDFViewerApplication.pdfDocument.getData()).buffer;
			window.postMessage({ action: 'loadExternalAnnotations', buf }, [buf]);
		});
	});
});

window.save = async () => {
	let buf = (await window.PDFViewerApplication.pdfDocument.getData()).buffer;
	window.postMessage({ action: 'save', buf }, [buf]);
};

class ViewerInstance {
	constructor(options) {
		this._itemID = options.itemID;
		this._viewer = null;

		let annotations = options.annotations;
		if (options.readOnly) {
			annotations.forEach(x => x.readOnly = true);
		}

		window.addEventListener('message', this.handleMessage);
		// window.itemID = options.itemID;
		window.rtl = options.rtl;
		this._viewer = new Viewer({
			onAddToNote: (annotations) => {
			},
			onSaveAnnotations: (annotations) => {
				this._postMessage({ action: 'saveAnnotations', annotations });
			},
			onDeleteAnnotations: (ids) => {
				this._postMessage({ action: 'deleteAnnotations', ids });
			},
			onSetState: (state) => {
				this._postMessage({ action: 'setState', state });
			},
			onClickTags: (id, event) => {
				let selector;
				if (event.target.closest('#viewerContainer')) {
					selector = '#viewerContainer .preview .tags';
				}
				else {
					selector = `[data-sidebar-annotation-id="${id}"] .tags`;
				}
				// this._postMessage({ action: 'openTagsPopup', id, selector });
			},
			onPopup: (name, data) => {
				// this._postMessage({ action: name, data });
			},
			onClosePopup: (data) => {
				this._postMessage({ action: 'closePopup', data });
			},
			onExternalLink: (url) => {
				window.open(url, '_blank');
			},
			onDownload: () => {
				// this._postMessage({ action: 'save' });
			},
			onChangeSidebarWidth: (width) => {
				// this._postMessage({ action: 'changeSidebarWidth', width });
			},
			onChangeSidebarOpen: (open) => {
				// this._postMessage({ action: 'changeSidebarOpen', open });
			},
			onFocusSplitButton: () => {
			},
			onFocusContextPane: () => {
			},
			buf: options.url,
			annotations,
			state: options.state,
			location: options.location,
			sidebarWidth: options.sidebarWidth,
			sidebarOpen: options.sidebarOpen,
			bottomPlaceholderHeight: 0,
			localizedStrings: strings,
			readOnly: options.readOnly,
			authorName: options.authorName
		});

		this._viewer.setBottomPlaceholderHeight(0);
		this._viewer.setToolbarPlaceholderWidth(0);
	}

	_postMessage(message) {
		window.postMessage(message);
	}

	uninit() {
		window.removeEventListener('message', this.handleMessage);
		this._viewer.uninit();
	}

	handleMessage = (event) => {
		if (event.source === window) {
			return;
		}

		let data = event.data;
		let message = data;
		switch (message.action) {
			case 'error': {
				window.PDFViewerApplication._otherError(message.message, message.moreInfo);
				return;
			}
			case 'navigate': {
				let { location } = message;
				this._viewer.navigate(location);
				return;
			}
			case 'setAnnotations': {
				let { annotations } = message;
				this._viewer.setAnnotations(annotations);
				return;
			}
			case 'unsetAnnotations': {
				let { ids } = message;
				// TODO: Handle conflicts when one user modifies and another deletes an annotation
				this._viewer.unsetAnnotations(ids);
				return;
			}
		}
	}
}

let currentViewerInstance = null;

window.addEventListener('message', async function (event) {
	let message = event.data;

	if (message.action === 'crash') {
		document.body.style.pointerEvents = 'none';
		let popover = document.createElement('div');
		popover.id = 'crash-popover';
		popover.append(message.message);
		document.body.append(popover);
	}

	if (message.action === 'open') {
		await PDFViewerApplication.initializedPromise;
		// TODO: Improve error handling here
		if (currentViewerInstance) {
			currentViewerInstance.uninit();
		}
		currentViewerInstance = new ViewerInstance({
			...message
		});
		window.postMessage({ action: 'initialized' });
	}
});
