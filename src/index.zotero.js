import Viewer from './viewer.js';

function setOptions() {
	window.PDFViewerApplicationOptions.set('eventBusDispatchToDOM', true);
	window.PDFViewerApplicationOptions.set('isEvalSupported', false);
	window.PDFViewerApplicationOptions.set('defaultUrl', '');
	window.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
	window.PDFViewerApplicationOptions.set('standardFontDataUrl', 'standard_fonts/');
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
}

// For the primary view we need to wait for `webviewerloaded` to set options,
// but for the second view we have to do it immediately, to have an effect
setOptions();
document.addEventListener('webviewerloaded', (e) => {
	setOptions();
	PDFViewerApplication.initializedPromise.then(function () {
		window.isReady = true;
	});
});


class ViewerInstance {
	constructor(options) {
		this.options = options;
		this._itemID = options.itemID;
		this._viewer = null;

		let annotations = options.annotations;
		if (options.readOnly) {
			annotations.forEach(x => x.readOnly = true);
		}

		window.addEventListener('message', this.handleMessage);
		window.itemID = options.itemID;
		window.rtl = options.rtl;
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
			onSaveImage: (annotation) => {
				this._postMessage({ action: 'saveImage', annotation });
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
			localizedStrings: options.localizedStrings || {},
			readOnly: options.readOnly,
			authorName: options.authorName,
			showAnnotations: options.showAnnotations
		});

		this._viewer.setBottomPlaceholderHeight(0);
		this._viewer.setToolbarPlaceholderWidth(0);
		this._setFontSize(options.fontSize);
	}

	_postMessage(message) {
		// console.log(message);
		parent.postMessage({ itemID: this._itemID, message, secondView: window.isSecondView }, parent.origin);
	}

	uninit() {
		window.removeEventListener('message', this.handleMessage);
		this._viewer.uninit();
	}

	_setFontSize(fontSize) {
		let root = document.documentElement;
		root.style.fontSize = fontSize + 'em';
	}

	handleMessage = async (event) => {
		if (event.source === self) {
			return;
		}

		let data = event.data;

		if (event.data.itemID !== this._itemID) {
			return;
		}

		let message = data.message;

		// Route message to the second view
		if (!window.isSecondView && data.secondView) {
			let iframe = document.getElementById('secondViewIframe');
			iframe.contentWindow.postMessage(event.data, '*');
			return;
		}

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
			case 'showAnnotations': {
				let { show } = message;
				this._viewer.showAnnotations(show);
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
			case 'focusFirst': {
				this._viewer.annotatorRef.current.focusFirst();
				return;
			}
			case 'reloading': {
				let node = document.getElementById('outerContainer');
				node.classList.add('suspend');
				return;
			}
			case 'reload': {
				let { buf, data } = message;
				await this._viewer.reload(buf);
				let node = document.getElementById('outerContainer');
				node.classList.remove('suspend');
				if (data && data.rotatedPageIndexes) {
					await this._viewer._annotationsStore.rerenderPageImages(data.rotatedPageIndexes);
				}
				return;
			}
			case 'setFontSize': {
				let { fontSize } = message;
				this._setFontSize(fontSize);
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
				this._viewer.clearFilter();
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
			case 'copyImage': {
				let annotation = this._viewer._annotationsStore._annotations.find(x => message.data.ids.includes(x.id));
				if (annotation) {
					zoteroCopyImage(annotation.image);
				}
				return;
			}
			case 'saveImageAs': {
				let annotation = this._viewer._annotationsStore._annotations.find(x => message.data.ids.includes(x.id));
				if (annotation) {
					zoteroSaveImageAs(annotation.image);
				}
				return;
			}
		}
	}

	handleMenuAction(cmd) {
		function secondViewDispatch() {
			if (window.secondViewIframeWindow) {
				window.secondViewIframeWindow.PDFViewerApplication.eventBus.dispatch(...arguments);
			}
		}

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
				if (PDFViewerApplication.pdfCursorTools.activeTool === 0) {
					PDFViewerApplication.pdfCursorTools.switchTool(1);
					if (window.secondViewIframeWindow) {
						window.secondViewIframeWindow.PDFViewerApplication.pdfCursorTools.switchTool(1);
					}
				}
				else {
					PDFViewerApplication.pdfCursorTools.switchTool(0);
					if (window.secondViewIframeWindow) {
						window.secondViewIframeWindow.PDFViewerApplication.pdfCursorTools.switchTool(0);
					}
				}
				return;
			}
			case 'switchscrollmode_vertical': {
				eb.dispatch('switchscrollmode', { mode: 0 });
				secondViewDispatch('switchscrollmode', { mode: 0 });
				return;
			}
			case 'switchscrollmode_horizontal': {
				eb.dispatch('switchscrollmode', { mode: 1 });
				secondViewDispatch('switchscrollmode', { mode: 1 });
				return;
			}
			case 'switchscrollmode_wrapped': {
				eb.dispatch('switchscrollmode', { mode: 2 });
				secondViewDispatch('switchscrollmode', { mode: 2 });
				return;
			}
			case 'switchspreadmode_none': {
				eb.dispatch('switchspreadmode', { mode: 0 });
				secondViewDispatch('switchspreadmode', { mode: 0 });
				return;
			}
			case 'switchspreadmode_odd': {
				eb.dispatch('switchspreadmode', { mode: 1 });
				secondViewDispatch('switchspreadmode', { mode: 0 });
				return;
			}
			case 'switchspreadmode_even': {
				eb.dispatch('switchspreadmode', { mode: 2 });
				secondViewDispatch('switchspreadmode', { mode: 2 });
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
		if (window.viewerInstance) {
			window.viewerInstance.uninit();
		}
		window.viewerInstance = new ViewerInstance({
			itemID, ...message
		});

		parent.postMessage({ itemID, message: { action: 'initialized' } }, parent.origin);

		let { secondViewState } = message;
		if (secondViewState) {
			window.splitView(secondViewState.splitType === 'horizontal', secondViewState.splitSize, secondViewState);
		}
	}
});


window.isSecondView = !!window.frameElement && window.frameElement.id === 'secondViewIframe';
window.addEventListener('DOMContentLoaded', () => {
	if (window.isSecondView) {
		document.body.classList.add('second-view');
	}
});

window.ViewerInstance = ViewerInstance;

window.getSplitType = function () {
	let splitWrapper = document.getElementById('splitWrapper');
	if (splitWrapper.classList.contains('enable-split')) {
		if (splitWrapper.classList.contains('horizontal')) {
			return 'horizontal';
		}
		return 'vertical';
	}
	return null;
};

window.splitView = function (horizontal, size, state) {
	if (!window.isSecondView) {
		let splitWrapper = document.getElementById('splitWrapper');
		let secondView = document.getElementById('secondView');

		if (horizontal) {
			splitWrapper.classList.add('horizontal');
			secondView.style.width = 'unset';
			secondView.style.height = size || '50%';
		}
		else {
			splitWrapper.classList.remove('horizontal');
			secondView.style.height = 'unset';
			secondView.style.width = size || '50%';
		}

		if (splitWrapper.classList.contains('enable-split')) {
			window.PDFViewerApplication.eventBus.dispatch('resize');
			return;
		}

		let iframe = document.createElement('iframe');
		iframe.id = 'secondViewIframe';
		iframe.src = 'viewer.html?';
		iframe.onload = async () => {
			let app = iframe.contentWindow.PDFViewerApplication;
			if (!app) {
				return;
			}
			await app.initializedPromise;
			let cvi = window.viewerInstance;
			window.secondViewIframeWindow = iframe.contentWindow;
			let { scrollMode, spreadMode } = cvi._viewer._lastState;
			state = state ? { ...state, scrollMode, spreadMode } : cvi._viewer._lastState;
			window.secondViewIframeWindow.viewerInstance = new iframe.contentWindow.ViewerInstance({
				...cvi.options, annotations: [], readOnly: true, state: state || cvi._viewer._lastState
			});
			window.PDFViewerApplication.eventBus.dispatch('resize');
		};
		splitWrapper.classList.add('enable-split');
		secondView.innerHTML = '';
		secondView.append(iframe);
	}
};

window.unsplitView = function () {
	let splitWrapper = document.getElementById('splitWrapper');
	splitWrapper.classList.remove('enable-split');
	let iframe = document.getElementById('secondViewIframe');
	iframe.src = '';
	window.PDFViewerApplication.eventBus.dispatch('resize');
	window.secondViewIframeWindow = null;
};

window.getSecondViewState = function () {
	let splitWrapper = document.getElementById('splitWrapper');
	if (!splitWrapper.classList.contains('enable-split')) {
		return;
	}
	let state = JSON.parse(JSON.stringify(window.secondViewIframeWindow.viewerInstance._viewer._lastState));
	state.splitType = splitWrapper.classList.contains('horizontal') ? 'horizontal' : 'vertical';
	let secondView = document.getElementById('secondView');
	if (state.splitType === 'vertical') {
		state.splitSize = secondView.style.width || '50%';
	}
	else {
		state.splitSize = secondView.style.height || '50%';
	}
	delete state.scrollMode;
	delete state.spreadMode;
	return state;
};
