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
  window.PDFViewerApplicationOptions.set('sidebarViewOnLoad', 9);

  window.PDFViewerApplication.preferences = window.PDFViewerApplicationOptions;
  window.PDFViewerApplication.externalServices.createPreferences = function () {
    return window.PDFViewerApplicationOptions;
  };
  window.PDFViewerApplication.isViewerEmbedded = true;

  PDFViewerApplication.initializedPromise.then(async function () {
    if (!window.PDFViewerApplication.pdfViewer || loaded) return;
    loaded = true;
    window.PDFViewerApplication.eventBus.on('documentinit', (e) => {
      console.log('documentinit')
    });


    test();


    // setTimeout(() => {
    //   viewer.navigate(annotations[0]);
    // }, 3000);
  });
});

async function test() {
  let res = await fetch('compressed.tracemonkey-pldi-09.pdf');
  let buf = await res.arrayBuffer();
  let vi = new ViewerInstance({
    buf,
    annotations,
    state: null,
    location: {
      'position': { 'pageIndex': 0, 'rects': [[371.395, 266.635, 486.075, 274.651]] }
    }
  });

  // vi._viewer.navigate({
  //   'position': { 'pageIndex': 100, 'rects': [[371.395, 266.635, 486.075, 274.651]] }
  // })

  setInterval(() => {
    vi.uninit();
    vi = new ViewerInstance({
      buf,
      annotations,
      state: null
    });

  }, 30000000);

}

class ViewerInstance {
  constructor(options) {
    window.attachmentItemKey = 'AAAABBBB';

    this._viewer = new Viewer({
      promptImport: true,
      onNavigateBack: () => {
        console.log('Navigate back');
      },
      onNavigateForward: () => {
        console.log('Navigate forward');
      },
      onImport() {
        alert('This will call pdf-worker to extract annotations')
      },
      onDismissImport() {
        alert('You won\'t be asked to import annotations until new annotations will be detected in the PDF file');
      },
      onAddToNote() {
        alert('This will add annotations to the pinned note');
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
      buf: options.buf,
      annotations: options.annotations,
      state: options.state,
      location: options.location
      // password: 'test'
    });
  }

  uninit() {
    this._viewer.uninit();
  }
}

// setTimeout(function () {
//   PDFViewerApplication.pdfSidebar.switchView(9, true);
// }, 1000);
