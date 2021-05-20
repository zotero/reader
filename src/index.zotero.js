import Viewer from './viewer.js';

let loaded = false;

document.addEventListener('webviewerloaded', (e) => {
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

	window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
	window.PDFViewerApplication.externalServices.createPreferences = function () {
		return window.PDFViewerApplicationOptions;
	};

	PDFViewerApplication.initializedPromise.then(function () {
		window.isReady = true;
		if (!window.PDFViewerApplication.pdfViewer || loaded) return;
		loaded = true;

		window.PDFViewerApplication.eventBus.on('documentinit', (e) => {
		});
	});
});


class ViewerInstance {
	constructor(options) {
		this._itemID = options.itemID;
		this._viewer = null;

		window.addEventListener('message', this.handleMessage);
		window.itemID = options.itemID;
		this._viewer = new Viewer({
			promptImport: options.promptImport,
			onImport: () => {
				this._postMessage({ action: 'import' });
			},
			onDismissImport: () => {
				this._postMessage({ action: 'dismissImport' });
			},
			onAddToNote: (annotations) => {
				this._postMessage({ action: 'addToNote', annotations });
			},
			onSetAnnotation: (annotation) => {
				this._postMessage({ action: 'setAnnotation', annotation });
			},
			onDeleteAnnotations: (ids) => {
				this._postMessage({ action: 'deleteAnnotations', ids });
			},
			onSetState: (state) => {
				this._postMessage({ action: 'setState', state });
			},
			onClickTags: (id, event) => {
				let rect = event.currentTarget.getBoundingClientRect();
				let x = event.screenX - (event.clientX - rect.left);
				let y = event.screenY - (event.clientY - rect.top);
				this._postMessage({ action: 'openTagsPopup', x, y, id });
			},
			onPopup: (name, data) => {
				this._postMessage({ action: name, ...data });
			},
			onExternalLink: (url) => {
				this._postMessage({ action: 'openURL', url });
			},
			onDownload: () => {
				this._postMessage({ action: 'save' });
			},
			onChangeSidebarWidth: (width) => {
				this._postMessage({ action: 'changeSidebarWidth', width });
			},
			onChangeSidebarOpen: (open) => {
				this._postMessage({ action: 'changeSidebarOpen', open });
			},
			buf: options.buf,
			annotations: options.annotations,
			state: options.state,
			location: options.location,
			sidebarWidth: options.sidebarWidth,
			sidebarOpen: options.sidebarOpen,
			bottomPlaceholderHeight: options.bottomPlaceholderHeight,
			localizedStrings: options.localizedStrings
		});
	}

	_postMessage(message) {
		// console.log(message);
		parent.postMessage({ itemID: this._itemID, message }, parent.origin);
	}

	uninit() {
		window.removeEventListener('message', this.handleMessage);
		this._viewer.uninit();
	}

	handleMessage = (event) => {
		if (event.source === parent) {
			return;
		}

		let data = event.data;

		if (event.data.itemID !== this._itemID) {
			return;
		}

		let message = data.message;

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
			case 'toggleImportPrompt': {
				let { enable } = message;
				this._viewer.setPromptImport(enable);
				return;
			}
			case 'enableAddToNote': {
				let { enable } = message;
				this._viewer.setEnableAddToNote(enable);
				return;
			}
			case 'setAnnotations': {
				let { annotations } = message;
				annotations.forEach(x => this._viewer.setAnnotation(x));
				return;
			}
			case 'unsetAnnotations': {
				let { ids } = message;
				// TODO: Handle conflicts when one user modifies and another deletes an annotation
				this._viewer.unsetAnnotations(ids);
				return;
			}
			case 'popupCmd': {
				this.handlePopupAction(message);
				return;
			}
			case 'menuCmd': {
				let { cmd } = message;
				this.handleMenuAction(cmd);
				return;
			}
			case 'setSidebarWidth': {
				let { width } = message;
				this._viewer.setSidebarWidth(width);
				return;
			}
			case 'setSidebarOpen': {
				let { open } = message;
				this._viewer.setSidebarOpen(open);
				return;
			}
			case 'setBottomPlaceholderHeight': {
				let { height } = message;
				this._viewer.setBottomPlaceholderHeight(height);
				return;
			}
			case 'setToolbarPlaceholderWidth': {
				let { width } = message;
				this._viewer.setToolbarPlaceholderWidth(width);
				return;
			}
		}
	}

	handlePopupAction(data) {
		// TODO: Fix multiple
		switch (data.cmd) {
			case 'addToNote': {
				let annotations = this._viewer._annotationsStore.annotations
				.filter(x => data.ids.includes(x.id))
				.map(x => ({ ...x, attachmentItemID: window.itemID }));

				if (annotations.length) {
					this._postMessage({
						action: 'addToNote',
						annotations
					});
				}
				return;
			}
			case 'deleteAnnotation': {
				this._viewer._annotationsStore.deleteAnnotations(data.ids);
				return;
			}
			case 'setAnnotationColor': {
				for (let id of data.ids) {
					this._viewer._annotationsStore.updateAnnotation({
						id,
						color: data.color
					});
				}
				return;
			}
			case 'setColor': {
				this._viewer.setColor(data.color);
				return;
			}
			case 'copy': {
				return;
			}
			case 'zoomIn': {
				PDFViewerApplication.zoomIn();
				return;
			}
			case 'zoomOut': {
				PDFViewerApplication.zoomOut();
				return;
			}
			case 'zoomAuto': {
				PDFViewerApplication.pdfViewer.currentScaleValue = 'auto';
				return;
			}
			case 'zoomPageWidth': {
				PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width';
				return;
			}
			case 'prevPage': {
				PDFViewerApplication.pdfViewer.previousPage();
				return;
			}
			case 'nextPage': {
				PDFViewerApplication.pdfViewer.nextPage();
				return;
			}
		}
	}

	handleMenuAction(cmd) {
		let eb = window.PDFViewerApplication.eventBus;
		switch (cmd) {
			case 'presentationmode':
				eb.dispatch('presentationmode');
				break;
			case 'print':
				eb.dispatch('print');
				break;
			case 'download':
				eb.dispatch('download');
				break;
			case 'firstpage':
				eb.dispatch('firstpage');
				break;
			case 'lastpage':
				eb.dispatch('lastpage');
				break;
			case 'rotatecw':
				eb.dispatch('rotatecw');
				break;
			case 'rotateccw':
				eb.dispatch('rotateccw');
				break;
			case 'switchcursortool_select':
				eb.dispatch('switchcursortool', { tool: 0 });
				break;
			case 'switchcursortool_hand':
				eb.dispatch('switchcursortool', { tool: 1 });
				break;
			case 'switchscrollmode_vertical':
				eb.dispatch('switchscrollmode', { mode: 0 });
				break;
			case 'switchscrollmode_horizontal':
				eb.dispatch('switchscrollmode', { mode: 1 });
				break;
			case 'switchscrollmode_wrapped':
				eb.dispatch('switchscrollmode', { mode: 2 });
				break;
			case 'switchspreadmode_none':
				eb.dispatch('switchspreadmode', { mode: 0 });
				break;
			case 'switchspreadmode_odd':
				eb.dispatch('switchspreadmode', { mode: 1 });
				break;
			case 'switchspreadmode_even':
				eb.dispatch('switchspreadmode', { mode: 2 });
				break;
		}
	}
}

let currentViewerInstance = null;

window.addEventListener('message', function (event) {
	let itemID = event.data.itemID;
	let message = event.data.message;

	if (message.action === 'crash') {
		document.body.style.pointerEvents = 'none';
		let popover = document.createElement('div');
		popover.id = 'crash-popover';
		popover.append(message.message);
		document.body.append(popover);
	}

	if (message.action === 'open') {
		// TODO: Improve error handling here
		if (currentViewerInstance) {
			currentViewerInstance.uninit();
		}
		currentViewerInstance = new ViewerInstance({
			itemID, ...message
		});
		parent.postMessage({ itemID, message: { action: 'initialized' } }, parent.origin);
	}
});
