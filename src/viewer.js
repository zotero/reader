'use strict';

import React from 'react';
import { render } from 'react-dom';
import Annotator from './components/annotator';
import AnnotationsStore from './annotations-store';
import { debounce } from './lib/utilities';

class Viewer {
  constructor(options) {
    this._loaded = false;
    this._onSetState = debounce(function (state) {
      options.onSetState(state);
    }, 100);
    this._userId = options.userId;
    this._label = options.label;
    this._lastState = null;
    this._annotationsStore = new AnnotationsStore({
      annotations: options.annotations,
      onSetAnnotation: options.onSetAnnotation,
      onDeleteAnnotations: options.onDeleteAnnotations,
      onUpdateAnnotations: (annotations) => {
        this.setAnnotations([...annotations]);
      }
    });

    // Takeover the download button
    PDFViewerApplication.download = function () {
    };
    let downloadButton = document.getElementById('download');
    downloadButton.addEventListener('click', (event) => {
      options.onDownload();
    });
    
    let noteSidebarToggleButton = document.getElementById('noteSidebarToggle');
    noteSidebarToggleButton.addEventListener('click', (event) => {
      let isToggled;
      if (noteSidebarToggleButton.classList.contains('toggled')) {
        noteSidebarToggleButton.classList.remove('toggled');
        isToggled = false;
      }
      else {
        noteSidebarToggleButton.classList.add('toggled');
        isToggled = true;
      }
      options.onToggleNoteSidebar(isToggled);
    });

    window.PDFViewerApplication.eventBus.on('updateviewarea', (e) => {
      let state = {
        page: e.location.pageNumber,
        scale: e.location.scale,
        rotation: e.location.rotation,
        top: e.location.top,
        left: e.location.left,
        sidebarView: window.PDFViewerApplication.pdfSidebar.isOpen ?
          window.PDFViewerApplication.pdfSidebar.active : 0,
        sidebarWidth: window.PDFViewerApplication.pdfSidebarResizer._width || 200,
        scrollMode: PDFViewerApplication.pdfViewer.scrollMode,
        spreadMode: PDFViewerApplication.pdfViewer.spreadMode
      };
      this._lastState = state;
      this._onSetState(state);
    });
    
    window.PDFViewerApplication.eventBus.on('sidebarviewchanged', (e) => {
      if (this._lastState) {
        this._lastState.sidebarView = e.view;
        this._onSetState(this._lastState);
      }
      setTimeout(() => {
        PDFViewerApplication.eventBus.dispatch('resize');
      }, 50);
    });
    
    //
    // window.PDFViewerApplication.eventBus.on("colorchange", (e) => {
    //   if (this._lastState) {
    //     this._lastState.sidebarView = e.view;
    //     this._onSetState(this._lastState);
    //   }
    // });


    window.PDFViewerApplication.eventBus.on('documentinit', (e) => {
      this._setState(options.state);
    });

    window.PDFViewerApplication.eventBus.on('pagesinit', (e) => {

    });

    window.PDFViewerApplication.eventBus.on('pagerendered', (e) => {
      window.isDocumentReady = true;
    });

    // Prevent dragging for internal links
    window.addEventListener('dragstart', (event) => {
      if (event.target.nodeType === Node.ELEMENT_NODE && event.target.closest('.annotationLayer')) {
        event.preventDefault();
      }
    });

    // Takeover external link click handling
    window.addEventListener('click', (event) => {
      if (
        event.button === 0 && event.target.closest('.annotationLayer') &&
        !event.target.classList.contains('internalLink')
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!PDFViewerApplication.pdfViewer.isInPresentationMode) {
          options.onExternalLink(event.target.href);
        }
      }
    }, true);
    
    // window.PDFViewerApplication.eventBus.on("pagesinit", () => {
    //   window.PDFViewerApplication.pdfDocument._transport.messageHandler.sendWithPromise("setIgnoredAnnotationIds", options.ignoredAnnotationIds);
    // });
    
    render(
      <Annotator
        onAddAnnotation={this._annotationsStore.addAnnotation.bind(this._annotationsStore)}
        onUpdateAnnotation={this._annotationsStore.updateAnnotation.bind(this._annotationsStore)}
        onDeleteAnnotations={this._annotationsStore.deleteAnnotations.bind(this._annotationsStore)}
        onClickTags={options.onClickTags}
        onPopup={options.onPopup}
        askImport={options.askImport}
        onImport={options.onImport}
        onDismissImport={options.onDismissImport}
        onInitialized={() => {
          this.setAnnotations(this._annotationsStore.getAnnotations());
        }}
        setAnnotationsRef={(ref) => {
          this.setAnnotations = ref;
        }}
        setColorRef={(ref) => {
          this.setColor = ref;
        }}
        importableAnnotationsNumRef={(ref) => {
          this.importableAnnotationsNum = ref;
        }}
        navigateRef={(ref) => {
          this.navigate = ref;
        }}
      />,
      document.createElement('div')
    );
    
    document.getElementById('back').addEventListener('click', () => {
      window.history.back();
    });
    
    document.getElementById('forward').addEventListener('click', () => {
      window.history.forward();
    });
    
    setTimeout(function () {
      window.PDFViewerApplication.open(options.url);
    }, 0);
  }
  
  setAnnotations = (annotations) => {
  
  };
  
  setColor = (color) => {
  
  };
  
  importableAnnotationsNum = (num) => {

  };

  navigate = (annotation) => {

  };

  setAnnotation(annotation) {
    this._annotationsStore.setAnnotation(annotation);
  }

  unsetAnnotation(annotation) {
    this._annotationsStore.setAnnotation(annotation);
  }

  _setState(options) {
    window.PDFViewerApplication.pdfSidebar.switchView(options.sidebarView, true);
    window.PDFViewerApplication.pdfSidebarResizer._updateWidth(options.sidebarWidth);

    window.PDFViewerApplication.pdfViewer.scrollMode = options.scrollMode;
    window.PDFViewerApplication.pdfViewer.spreadMode = options.spreadMode;

    window.PDFViewerApplication.pdfViewer.pagesRotation = options.rotation;
    
    let dest = [null, { name: 'XYZ' }, options.left,
      options.top, parseInt(options.scale) ? options.scale / 100 : options.scale];
    
    window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
      pageNumber: options.page,
      destArray: dest,
      allowNegativeOffset: true
    });
  }
}

export default Viewer;
