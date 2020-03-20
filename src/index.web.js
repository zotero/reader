import Viewer from './viewer.js'
import annotations from './demo-annotations'

let _loaded = false;
document.addEventListener('localized', (e) => {
  if (!window.PDFViewerApplication.pdfViewer || _loaded) return;
  _loaded = true;
  window.PDFViewerApplication.eventBus.on('documentinit', (e) => {
    console.log('documentinit')
  });
  
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
    onDeleteAnnotation: function (annotationId) {
      console.log('Delete annotation', annotationId);
    },
    onSetState: function (state) {
      console.log('Set state', state);
    },
    onClickTags(annotationId, screenX, screenY) {
      alert('This will open Zotero tagbox popup');
    },
    onEnterPassword(password) {
      console.log('Entered password', password);
    },
    onDownload() {
      alert('This will call pdf-worker to write all annotations to the PDF file and then triggers the download');
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

document.addEventListener('webviewerloaded', (e) => {
  window.PDFViewerApplicationOptions.set('disableHistory', false);
  window.PDFViewerApplicationOptions.set('eventBusDispatchToDOM', true);
  window.PDFViewerApplicationOptions.set('isEvalSupported', false);
  window.PDFViewerApplicationOptions.set('defaultUrl', '');
  window.PDFViewerApplicationOptions.set('cMapUrl', 'cmaps/');
  window.PDFViewerApplicationOptions.set('cMapPacked', true);
  window.PDFViewerApplicationOptions.set('workerSrc', './pdf.worker.js');
  window.PDFViewerApplicationOptions.set('historyUpdateUrl', true);
  
  window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
  window.PDFViewerApplication.externalServices.createPreferences = function () {
    return window.PDFViewerApplicationOptions;
  };
  window.PDFViewerApplication.isViewerEmbedded = true;
}, true);
