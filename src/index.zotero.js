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
    parent.postMessage({ op: 'load', libraryID, key }, '*');
  });
});

var viewer;

window.addEventListener('message', function (message) {
  if (message.source === parent) return;
  
  if (message.data.parent) return;
  let data = message.data;
  
  if (data.op === 'open') {
    window.itemId = data.itemId;
    viewer = new Viewer({
      askImport: true,
      onImport() {
        parent.postMessage({ op: 'import' }, '*');
      },
      onDismissImport() {
        parent.postMessage({ op: 'dismissImport' }, '*');
      },
      onSetAnnotation: function (annotation) {
        if (annotation.temp) return;
        console.log('Set annotation', annotation);
        parent.postMessage({ op: 'setAnnotation', parent: true, annotation }, '*');
      },
      onDeleteAnnotation: function (annotationId) {
        console.log('Delete annotation', annotationId);
        parent.postMessage({ op: 'deleteAnnotation', parent: true, annotationId }, '*');
      },
      onSetState: function (state) {
        console.log('Set state', state);
        parent.postMessage({ op: 'setState', parent: true, state }, '*');
      },
      onClickTags(annotationId, screenX, screenY) {
        parent.postMessage({ op: 'tagsPopup', x: screenX, y: screenY }, '*');
      },
      onPopup(name, data) {
        parent.postMessage({ op: name, ...data }, '*');
      },
      onExternalLink(url) {
        parent.postMessage({ op: 'externalLink', url }, '*');
      }, 
      onEnterPassword(password) {
        parent.postMessage({ op: 'enterPassword', password }, '*');
      },
      onDownload() {
        parent.postMessage({ op: 'save' }, '*');
      },
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
  else if (data.op === 'popupCmd') {
    switch (data.cmd) {
      case 'deleteAnnotation':
        viewer._annotationsStore.deleteAnnotation(data.id);
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
  else if (data.op === 'menuCmd') {
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
