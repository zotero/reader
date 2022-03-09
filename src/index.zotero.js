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
	// Disable interactive forms because our PDF saving mechanism can't
	// save then. In addition, we don't have styling for those forms,
	// and they sometimes show popup preventing to leave tab
	window.PDFViewerApplicationOptions.set('renderInteractiveForms', false);
	window.PDFViewerApplicationOptions.set('printResolution', 300);

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

		let annotations = options.annotations;
		if (options.readOnly) {
			annotations.forEach(x => x.readOnly = true);
		}

		window.addEventListener('message', this.handleMessage);
		window.itemID = options.itemID;
		this._viewer = new Viewer({
			onAddToNote: (annotations) => {
				this._postMessage({ action: 'addToNote', annotations });
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
				this._postMessage({ action: 'openTagsPopup', id, selector });
			},
			onDoubleClickPageLabel: (id) => {
				this._postMessage({ action: 'openPageLabelPopup', id });
			},
			onPopup: (name, data) => {
				this._postMessage({ action: name, data });
			},
			onClosePopup: (data) => {
				this._postMessage({ action: 'closePopup', data });
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
			onFocusSplitButton: () => {
				this._postMessage({ action: 'focusSplitButton' });
			},
			onFocusContextPane: () => {
				this._postMessage({ action: 'focusContextPane' });
			},
			buf: options.buf,
			annotations,
			state: options.state,
			location: options.location,
			sidebarWidth: options.sidebarWidth,
			sidebarOpen: options.sidebarOpen,
			bottomPlaceholderHeight: options.bottomPlaceholderHeight,
			localizedStrings: options.localizedStrings,
			readOnly: options.readOnly,
			authorName: options.authorName
		});

		this._viewer.setBottomPlaceholderHeight(0);
		this._viewer.setToolbarPlaceholderWidth(0);
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
			case 'enableAddToNote': {
				let { enable } = message;
				this._viewer.setEnableAddToNote(enable);
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
			case 'focusLastToolbarButton': {
				document.getElementById('viewFind').focus();
				return;
			}
			case 'tabToolbar': {
				let { reverse } = message;
				this._viewer.annotatorRef.current.tabToolbar(reverse);
				return;
			}
		}
	}

	handlePopupAction(message) {
		// TODO: Fix multiple
		switch (message.cmd) {
			case 'addToNote': {
				let annotations = this._viewer._annotationsStore._annotations
				.filter(x => message.ids.includes(x.id))
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
				this._viewer._annotationsStore.deleteAnnotations(message.ids);
				return;
			}
			case 'setAnnotationColor': {
				let annotations = [];
				for (let id of message.ids) {
					annotations.push({ id, color: message.color });
				}
				this._viewer._annotationsStore.updateAnnotations(annotations);
				return;
			}
			case 'setColor': {
				this._viewer.setColor(message.color);
				return;
			}
			case 'openPageLabelPopup': {
				this._viewer.openPageLabelPopup(message.data);
				return;
			}
			case 'editHighlightedText': {
				this._viewer.editHighlightedText(message.data);
				return;
			}
			case 'clearSelector': {
				this._viewer.clearSelector();
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
			case 'zoomPageHeight': {
				PDFViewerApplication.pdfViewer.currentScaleValue = 'page-fit';
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
			case 'presentationmode': {
				eb.dispatch('presentationmode');
				return;
			}
			case 'print': {
				eb.dispatch('print');
				return;
			}
			case 'download': {
				eb.dispatch('download');
				return;
			}
			case 'firstpage': {
				eb.dispatch('firstpage');
				return;
			}
			case 'lastpage': {
				eb.dispatch('lastpage');
				return;
			}
			case 'rotatecw': {
				eb.dispatch('rotatecw');
				return;
			}
			case 'rotateccw': {
				eb.dispatch('rotateccw');
				return;
			}
			// case 'switchcursortool_select': {
			// 	eb.dispatch('switchcursortool', { tool: 0 });
			// 	return;
			// }
			case 'switchcursortool_hand': {
				// eb.dispatch('switchcursortool', { tool: 1 });
				PDFViewerApplication.pdfCursorTools.handTool.toggle();
				return;
			}
			case 'switchscrollmode_vertical': {
				eb.dispatch('switchscrollmode', { mode: 0 });
				return;
			}
			case 'switchscrollmode_horizontal': {
				eb.dispatch('switchscrollmode', { mode: 1 });
				return;
			}
			case 'switchscrollmode_wrapped': {
				eb.dispatch('switchscrollmode', { mode: 2 });
				return;
			}
			case 'switchspreadmode_none': {
				eb.dispatch('switchspreadmode', { mode: 0 });
				return;
			}
			case 'switchspreadmode_odd': {
				eb.dispatch('switchspreadmode', { mode: 1 });
				return;
			}
			case 'switchspreadmode_even': {
				eb.dispatch('switchspreadmode', { mode: 2 });
				return;
			}
			case 'back': {
				window.history.back();
				return;
			}
			case 'forward': {
				window.history.forward();
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
			case 'zoomPageHeight': {
				PDFViewerApplication.pdfViewer.currentScaleValue = 'page-fit';
				return;
			}
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
