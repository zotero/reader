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
      onDeleteAnnotation: options.onDeleteAnnotation
    });
    
    // Takeover the download button
    PDFViewerApplication.download = function () {
    };
    let downloadButton = document.getElementById('download');
    downloadButton.addEventListener('click', (event) => {
      options.onDownload();
    });
    
    
    window.PDFViewerApplication.eventBus.on('textlayerrendered', e => {
      return;
      // let pageIndex = e.pageNumber;
      // let pageView = window.PDFViewerApplication.pdfViewer.getPageView(e.pageNumber - 1);
      // let data = pageView.textLayer.textDivs.map(x => parseFloat(x.style.left)).filter(x => x).sort((a, b) => a - b);
      //
      // let result = data.reduce(function (r, a, i, aa) {
      //   if (a - aa[i - 1] < 5) {
      //     if (!Array.isArray(r[r.length - 1])) {
      //       r[r.length - 1] = [r[r.length - 1]];
      //     }
      //     r[r.length - 1].push(a);
      //     return r;
      //   }
      //   r.push(a);
      //   return r;
      // }, []);
      //
      // let b = result.map(ar => {
      //   if (!Array.isArray(ar)) ar = [ar];
      //   let sum = ar.reduce((a, b) => a + b, 0);
      //   let avg = sum / ar.length;
      //   return [avg, ar.length];
      // });
      //
      // b = b.filter(x => x[1] >= 10);
      //
      // let res = null;
      // if (b.length) {
      //   res = b[0][0];
      // }
      //
      // let pageWidth = window.PDFViewerApplication.pdfViewer.getPageView(pageIndex).width;
      // let margins = [res, pageWidth - res];
    });
    
    if (options.password) {
      window.PDFViewerApplication.passwordPrompt.open = function () {
        this.updateCallback(options.password);
      }
    }
    
    let _password = null;
    
    window.PDFViewerApplication.passwordPrompt.verify = function () {
      const password = this.input.value;
      _password = password;
      if (password && password.length > 0) {
        this.close();
        this.updateCallback(password);
      }
    }
    
    window.PDFViewerApplication.eventBus.on('updateviewarea', (e) => {
      // console.log(e);
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
      window.isDocumentReady = true;
      this._setState(options.state);
    });
    
    window.PDFViewerApplication.eventBus.on('pagesinit', (e) => {
      if (_password) {
        options.onEnterPassword(_password);
      }
    });
    
    // window.PDFViewerApplication.eventBus.on("pagesinit", () => {
    //   window.PDFViewerApplication.pdfDocument._transport.messageHandler.sendWithPromise("setIgnoredAnnotationIds", options.ignoredAnnotationIds);
    // });
    
    render(
      <Annotator
        onAddAnnotation={this._annotationsStore.addAnnotation.bind(this._annotationsStore)}
        onUpdateAnnotation={this._annotationsStore.updateAnnotation.bind(this._annotationsStore)}
        onDeleteAnnotation={this._annotationsStore.deleteAnnotation.bind(this._annotationsStore)}
        onClickTags={options.onClickTags}
        onImport={options.onImport}
        onInitialized={() => {
          this._annotationsStore.onUpdateAnnotations = this.setAnnotations;
          this._annotationsStore.onImportableAnnotationsNum = this.importableAnnotationsNum;
          this.setAnnotations(this._annotationsStore.getAnnotations());
        }}
        setAnnotationsRef={(ref) => {
          this.setAnnotations = ref;
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
    
    
    let tvl = document.getElementById('toolbarViewerLeft');
    let vf = document.getElementById('viewFind');
    let st = document.getElementById('sidebarToggle');
    
    let labelArrowLeft = document.createElement('span');
    let arrowLeft = document.createElement('button');
    labelArrowLeft.setAttribute('data-l10n-id', 'back_label');
    labelArrowLeft.appendChild(document.createTextNode('Back'));
    arrowLeft.className = 'toolbarButton';
    arrowLeft.id = 'back';
    arrowLeft.appendChild(labelArrowLeft);
    arrowLeft.addEventListener('click', () => {
      window.history.back();
    });
    tvl.insertBefore(arrowLeft, st);
    
    let labelArrowRight = document.createElement('span');
    let arrowRight = document.createElement('button');
    labelArrowRight.setAttribute('data-l10n-id', 'forward_label');
    labelArrowRight.appendChild(document.createTextNode('Forward'));
    arrowRight.className = 'toolbarButton';
    arrowRight.id = 'forward';
    arrowRight.appendChild(labelArrowRight);
    arrowRight.addEventListener('click', () => {
      window.history.forward();
    });
    tvl.insertBefore(arrowRight, st);
    
    setTimeout(function () {
      window.PDFViewerApplication.open(options.url);
    }, 0);
  }
  
  setAnnotations = (annotations) => {
  
  };
  
  importableAnnotationsNum = (num) => {
  
  };
  
  navigate = (annotation) => {
  
  };
  
  setAnnotation(annotation) {
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
