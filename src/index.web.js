import Viewer from './viewer.js'
import annotations from './demo-annotations'

let loaded = false;

document.addEventListener('webviewerloaded', function () {
  window.PDFViewerApplicationOptions.set('disableHistory', false);
  window.PDFViewerApplicationOptions.set('isEvalSupported', false);
  window.PDFViewerApplicationOptions.set('defaultUrl', '');
  window.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
  window.PDFViewerApplicationOptions.set('cMapPacked', true);
  window.PDFViewerApplicationOptions.set('workerSrc', './pdf.worker.js');
  window.PDFViewerApplicationOptions.set('historyUpdateUrl', true);
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
      console.log('documentinit')
    });
    
    window.attachmentItemKey = 'AAAABBBB';

    const viewer = new Viewer({
      askImport: true,
      onImport() {
        alert('This will call pdf-worker to extract annotations')
      },
      onDismissImport() {
        alert('You won\'t be asked to import annotations until new annotations will be detected in the PDF file');
      },
      onSetAnnotation: function (annotation) {
        console.log('Set annotation', annotation);
      },
      onDeleteAnnotations: function (ids) {
        console.log('Delete annotations', JSON.stringify(ids));
      },
      onSetState: function (state) {
        console.log('Set state', state);
      },
      onClickTags(annotationId, event) {
        alert('This will open Zotero tagbox popup');
      },
      onPopup(name, data) {
        console.log(name, data);
        alert('This will open ' + name);
      },
      onExternalLink(url) {
        alert('This will navigate to the external link: ' + url);
      },
      onDownload() {
        alert('This will call pdf-worker to write all annotations to the PDF file and then triggers the download');
      },
      onToggleNoteSidebar(isToggled) {
        alert(`This will ${isToggled ? 'show' : 'hide'} the note sidebar on the right`);
      },
      url: 'compressed.tracemonkey-pldi-09.pdf',
      annotations,
      state: null
      // password: 'test'
    });
    
    // setTimeout(() => {
    //   viewer.navigate(annotations[0]);
    // }, 3000);
  });
});

setTimeout(function () {
  PDFViewerApplication.pdfSidebar.switchView(9, true);
}, 1000);
