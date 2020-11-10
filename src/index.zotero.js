import Viewer from './viewer.js'

let loaded = false;

document.addEventListener('webviewerloaded', (e) => {
  window.PDFViewerApplicationOptions.set('disableHistory', true);
  window.PDFViewerApplicationOptions.set('eventBusDispatchToDOM', true);
  window.PDFViewerApplicationOptions.set('isEvalSupported', false);
  window.PDFViewerApplicationOptions.set('defaultUrl', '');
  window.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
  window.PDFViewerApplicationOptions.set('cMapPacked', true);
  window.PDFViewerApplicationOptions.set('workerSrc', 'pdf.worker.js');
  window.PDFViewerApplicationOptions.set('historyUpdateUrl', false);
  window.PDFViewerApplicationOptions.set('textLayerMode', 0);
  window.PDFViewerApplicationOptions.set('sidebarViewOnLoad', 9);

  window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
  window.PDFViewerApplication.externalServices.createPreferences = function () {
    return window.PDFViewerApplicationOptions;
  };
  window.PDFViewerApplication.isViewerEmbedded = true;

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
    this._itemId = options.itemId;
    this._viewer = null;

    if (!options.showItemPaneToggle) {
      document.getElementById('noteSidebarToggle').style.display = 'none';
    }

    window.addEventListener('message', this.handleMessage);
    window.attachmentItemKey = options.key;
    window.itemId = options.itemId;
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
        console.log('Set annotation', annotation);
        this._postMessage({ action: 'setAnnotation', annotation });
      },
      onDeleteAnnotations: (ids) => {
        console.log('Delete annotations', JSON.stringify(ids));
        this._postMessage({ action: 'deleteAnnotations', ids });
      },
      onSetState: (state) => {
        console.log('Set state', state);
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
        this._postMessage({ action: 'openUrl', url });
      },
      onDownload: () => {
        this._postMessage({ action: 'save' });
      },
      onToggleNoteSidebar: (isToggled) => {
        this._postMessage({ action: 'toggleNoteSidebar', isToggled });
      },
      buf: options.buf,
      annotations: options.annotations,
      state: options.state,
      location: options.location
    });
  }

  _postMessage(message) {
    parent.postMessage({ itemId: this._itemId, message }, parent.origin);
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

    if (event.data.itemId !== this._itemId) {
      return;
    }

    let message = data.message;

    switch (message.action) {
      case 'error': {
        window.PDFViewerApplication.error(message.message, message.moreInfo);
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
      }
    }
  }

  handlePopupAction(data) {
    // TODO: Fix multiple
    switch (data.cmd) {
      case 'addToNote': {
        let annotation = this._viewer._annotationsStore.annotations.find(x => x.id === data.id);
        if (annotation) {
          annotation.itemId = window.itemId;
          this._postMessage({
            action: 'addToNote',
            annotations: [annotation]
          });
        }
        return;
      }
      case 'deleteAnnotation': {
        this._viewer._annotationsStore.deleteAnnotations([data.id]);
        return;
      }
      case 'setAnnotationColor': {
        this._viewer._annotationsStore.updateAnnotation({
          id: data.id,
          color: data.color
        });
        return;
      }
      case 'setColor': {
        this._viewer.setColor(data.color);
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
  let itemId = event.data.itemId;
  let message = event.data.message;

  if (message.action === 'open') {
    let { buf, state, location, annotations, promptImport, showItemPaneToggle } = message;
    if (currentViewerInstance) {
      currentViewerInstance.uninit();
    }
    currentViewerInstance = new ViewerInstance({
      itemId, buf, state, location, annotations, promptImport, showItemPaneToggle
    });
  }
});
