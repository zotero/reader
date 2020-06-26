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
  
  window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
  window.PDFViewerApplication.externalServices.createPreferences = function () {
    return window.PDFViewerApplicationOptions;
  };
  window.PDFViewerApplication.isViewerEmbedded = true;
  
  PDFViewerApplication.initializedPromise.then(function () {
    if (!window.PDFViewerApplication.pdfViewer || loaded) return;
    loaded = true;
    
    window.PDFViewerApplication.eventBus.on('documentinit', (e) => {
    });
    
    var url = new URL(window.location.href);
    var libraryID = url.searchParams.get('libraryID');
    var key = url.searchParams.get('key');
    parent.postMessage({ action: 'load', libraryID, key }, '*');
  });
});

var viewer;

window.addEventListener('message', function (message) {
  if (message.source === parent) return;

  if (message.data.parent) return;
  let data = message.data;

  console.log('meeeeeeee', data)

  if (data.action === 'open') {
    window.attachmentItemKey = data.key;
    window.itemId = data.itemId;
    viewer = new Viewer({
      askImport: true,
      onImport() {
        parent.postMessage({ action: 'import' }, '*');
      },
      onDismissImport() {
        parent.postMessage({ action: 'dismissImport' }, '*');
      },
      onSetAnnotation: function (annotation) {
        if (annotation.temp) return;
        console.log('Set annotation', annotation);
        parent.postMessage({ action: 'setAnnotation', parent: true, annotation }, '*');
      },
      onDeleteAnnotations: function (ids) {
        console.log('Delete annotations', JSON.stringify(ids));
        parent.postMessage({ action: 'deleteAnnotations', parent: true, ids }, '*');
      },
      onSetState: function (state) {
        console.log('Set state', state);
        parent.postMessage({ action: 'setState', parent: true, state }, '*');
      },
      onClickTags(id, event) {
        let rect = event.currentTarget.getBoundingClientRect();
        let x = event.screenX - (event.clientX - rect.left);
        let y = event.screenY - (event.clientY - rect.top);
        parent.postMessage({ action: 'openTagsPopup', x, y, id }, '*');
      },
      onPopup(name, data) {
        parent.postMessage({ action: name, ...data }, '*');
      },
      onExternalLink(url) {
        parent.postMessage({ action: 'openURL', url }, '*');
      },
      onDownload() {
        parent.postMessage({ action: 'save' }, '*');
      },
      url: 'zotero://pdf.js/pdf/' + data.libraryID + '/' + data.key,
      annotations: data.annotations,
      state: data.state
    });
  }
  else if (data.action === 'navigate') {
    viewer.navigate(data.to);
  }
  else if (data.action === 'setAnnotations') {
    data.annotations.forEach(x => viewer.setAnnotation(x));
  }
  else if (data.action === 'unsetAnnotations') {
    // TODO: Handle conflicts when one user modifies and another deletes an annotation
    viewer.unsetAnnotation(data.ids);
  }
  else if (data.action === 'popupCmd') {
    switch (data.cmd) {
      case 'deleteAnnotation':
        viewer._annotationsStore.deleteAnnotations([data.id]);
        break;
      case 'setAnnotationColor':
        viewer._annotationsStore.updateAnnotation({
          id: data.id,
          color: data.color
        });
        break;
      case 'setColor':
        viewer.setColor(data.color);
        break;
    }
  }
  else if (data.action === 'menuCmd') {
    let cmd = data.cmd;
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
});

window.isViewerReady = true;
