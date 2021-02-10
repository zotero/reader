'use strict';

import React from 'react';
import ReactDom from 'react-dom';
import Annotator from './components/annotator';
import AnnotationsStore from './annotations-store';
import { debounce } from './lib/debounce';

class Viewer {
  constructor(options) {
    this.options = options;
    this._loaded = false;
    this._onSetState = debounce(function (state) {
      options.onSetState(state);
    }, 100);
    this._userId = options.userId;
    this._label = options.label;
    this._lastState = null;
    this._uninitialized = false;
    // TODO: Find a better way to determine the event origin
    this._enableSidebarOpenEvent = true;
    this.setBottomPlaceholderHeight(this.options.bottomPlaceholderHeight);
    this._annotatorPromise = new Promise((resolve) => {
      this._annotatorPromiseResolve = resolve;
    })
    this._pdfjsPromise = new Promise((resolve) => {
      this._pdfjsPromiseResolve = resolve;
    })
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

    // Sidebar configuration must be finished before loading the PDF
    // to avoid the immediate resize and re-render of PDF pages
    if (this.options.sidebarOpen) {
      PDFViewerApplication.pdfSidebar.setInitialView(9);
    }
    else {
      PDFViewerApplication.pdfSidebar.switchView(9);
    }
    window.PDFViewerApplication.pdfSidebarResizer._updateWidth(this.options.sidebarWidth);

    document.getElementById('download').addEventListener('click', this.handleDownloadButtonClick);
    document.getElementById('zoomAuto').addEventListener('click', this.handleZoomAutoButtonClick);
    window.PDFViewerApplication.eventBus.on('updateviewarea', this.handleViewAreaUpdate);
    window.PDFViewerApplication.eventBus.on('documentinit', this.handleDocumentInit);
    window.onChangeSidebarWidth = this.handleChangeSidebarWidth;
    // document.getElementById('back').addEventListener('click', this.handleBackButtonClick);
    // document.getElementById('forward').addEventListener('click', this.handleForwardButtonClick);
    // Override the external link click handling
    window.addEventListener('click', this.handleClick, true);
    // Prevent dragging for internal links
    window.addEventListener('dragstart', this.handleDragStart);

    // window.PDFViewerApplication.eventBus.on("pagesinit", () => {
    //   window.PDFViewerApplication.pdfDocument._transport.messageHandler.sendWithPromise("setIgnoredAnnotationIds", options.ignoredAnnotationIds);
    // });

    window.PDFViewerApplication.eventBus.on('pagesinit', () => {
      this._pdfjsPromiseResolve();
    });

    this.annotatorRef = React.createRef();
    this.node = document.createElement('div');
    ReactDom.render(
      <Annotator
        onAddAnnotation={this._annotationsStore.addAnnotation.bind(this._annotationsStore)}
        onUpdateAnnotation={this._annotationsStore.updateAnnotation.bind(this._annotationsStore)}
        onDeleteAnnotations={this._annotationsStore.deleteAnnotations.bind(this._annotationsStore)}
        onClickTags={options.onClickTags}
        onPopup={options.onPopup}
        promptImport={options.promptImport}
        onImport={options.onImport}
        onAddToNote={options.onAddToNote}
        onDismissImport={options.onDismissImport}
        ref={this.annotatorRef}
      />,
      this.node,
      () => {
        this.setAnnotations(this._annotationsStore.getAnnotations());
        this._annotatorPromiseResolve();
      }
    );

    setTimeout(function () {
      window.PDFViewerApplication.open(options.buf);
    }, 0);
  }

  uninit() {
    window.PDFViewerApplication.pdfDocument.uninitialized = true;
    ReactDom.unmountComponentAtNode(this.node);
    document.getElementById('download').removeEventListener('click', this.handleDownloadButtonClick);
    document.getElementById('zoomAuto').removeEventListener('click', this.handleZoomAutoButtonClick);
    window.PDFViewerApplication.eventBus.off('updateviewarea', this.handleViewAreaUpdate);
    window.PDFViewerApplication.eventBus.off('sidebarviewchanged', this.handleSidebarViewChange);
    window.PDFViewerApplication.eventBus.off('documentinit', this.handleDocumentInit);
    // document.getElementById('back').removeEventListener('click', this.handleBackButtonClick);
    // document.getElementById('forward').removeEventListener('click', this.handleForwardButtonClick);
    window.removeEventListener('click', this.handleClick);
    window.removeEventListener('dragstart', this.handleDragStart);
    window.PDFViewerApplication.close();
    this._uninitialized = true;
    window.chsCache = {};
  }

  handleDownloadButtonClick = () => {
    this.options.onDownload();
  }

  handleZoomAutoButtonClick = () => {
    PDFViewerApplication.pdfViewer._setScale('page-width');
  }

  handleViewAreaUpdate = (e) => {
    let state = {
      pageIndex: e.location.pageNumber - 1,
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
  }

  handleSidebarViewChange = (e) => {
    console.log('view change', e)
    if (this._lastState) {
      this._lastState.sidebarView = e.view;
      this._onSetState(this._lastState);
    }
    setTimeout(() => {
      PDFViewerApplication.eventBus.dispatch('resize');
    }, 50);
    if (this._enableSidebarOpenEvent) {
      this.options.onChangeSidebarOpen(!!e.view);
    }
  }

  handleDocumentInit = async () => {
    // PDFViewerApplication.pdfSidebar.switchView(9);


    if (this.options.state) {
      this._setState(this.options.state, !!this.options.location);
    }
    // Default state
    else {
      PDFViewerApplication.pdfViewer._setScale('page-width');
    }

    await this._annotatorPromise;
    if (this._uninitialized) {
      return;
    }

    if (this.options.location) {
      this.annotatorRef.current.navigate(this.options.location);
    }

    // Can't be in the constructor because gets triggered by the initial
    // sidebar configuration
    window.PDFViewerApplication.eventBus.on('sidebarviewchanged', this.handleSidebarViewChange);
  }

  handleChangeSidebarWidth = (width) => {
    this.options.onChangeSidebarWidth(width);
  }

  handleClick = (event) => {
    if (
      event.button === 0
      && event.target.closest('.annotationLayer')
      && !event.target.classList.contains('internalLink')
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!PDFViewerApplication.pdfViewer.isInPresentationMode) {
        this.options.onExternalLink(event.target.href);
      }
    }
  }

  handleDragStart = (event) => {
    if (event.target.nodeType === Node.ELEMENT_NODE
      && event.target.closest('.annotationLayer')) {
      event.preventDefault();
    }

    if (!event.target.closest('#viewer')
      && !event.target.closest('#annotationsView')) {
      event.preventDefault();
    }
  }

  setAnnotations = (annotations) => {
    this.annotatorRef.current.setAnnotations(annotations);
  };

  setColor = (color) => {
    this.annotatorRef.current.setColor(color);
  };

  importableAnnotationsNum = (num) => {

  };

  navigate = async (location) => {
    await this._annotatorPromise;
    await this._pdfjsPromise;
    if (this._uninitialized) {
      return;
    }
    this.annotatorRef.current.navigate(location);
  };

  setPromptImport = async (enable) => {
    await this._annotatorPromise;
    await this._pdfjsPromise;
    if (this._uninitialized) {
      return;
    }
    this.annotatorRef.current.setPromptImport(enable);
  };

  setEnableAddToNote = async (enable) => {
    await this._annotatorPromise;
    await this._pdfjsPromise;
    if (this._uninitialized) {
      return;
    }
    this.annotatorRef.current.setEnableAddToNote(enable);
  };

  setAnnotation(annotation) {
    this._annotationsStore.setAnnotation(annotation);
  }

  unsetAnnotations(ids) {
    this._annotationsStore.unsetAnnotations(ids);
  }

  setSidebarWidth(width) {
    window.PDFViewerApplication.pdfSidebarResizer._updateWidth(width);
  }

  setSidebarOpen(open) {
    this._enableSidebarOpenEvent = false;
    if (open) {
      window.PDFViewerApplication.pdfSidebar.open();
    }
    else {
      window.PDFViewerApplication.pdfSidebar.close();
    }
    this._enableSidebarOpenEvent = true;
  }

  setBottomPlaceholderHeight(height) {
    let root = document.documentElement;
    root.style.setProperty('--bottomPlaceholderHeight', height + 'px');
  }

  setToolbarPlaceholderWidth(width) {
    document.getElementById('toolbarContainer').style.paddingRight = width + 'px';
  }

  // TODO: Try to scroll into the required page avoiding first pages rendering to speed up navigation
  _setState(state, skipScroll) {
    // window.PDFViewerApplication.pdfSidebar.switchView(state.sidebarView, true);
    // window.PDFViewerApplication.pdfSidebarResizer._updateWidth(state.sidebarWidth);

    window.PDFViewerApplication.pdfViewer.scrollMode = state.scrollMode;
    window.PDFViewerApplication.pdfViewer.spreadMode = state.spreadMode;

    window.PDFViewerApplication.pdfViewer.pagesRotation = state.rotation;

    if (!skipScroll) {
      let dest = [null, { name: 'XYZ' }, state.left,
        state.top, parseInt(state.scale) ? state.scale / 100 : state.scale];

      window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
        pageNumber: state.pageIndex + 1,
        destArray: dest,
        allowNegativeOffset: true
      });
    }
  }
}

export default Viewer;
