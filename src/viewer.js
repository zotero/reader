import React from "react";
import { render } from "react-dom";
import Annotator from "./components/Annotator";
import AnnotationsStore from "./AnnotationsStore";


class Viewer {
  constructor(options) {
    this._loaded = false;
    this._onSetAnnotation = options.onSetAnnotation;
    this._onDeleteAnnotation = options.onDeleteAnnotation;
    this._onSetState = options.onSetState;
    this._userId = options.userId;
    this._label = options.label;
    this._lastState = null;
    this._annotationsStore = new AnnotationsStore({
      onSetAnnotation: options.onSetAnnotation,
      onDeleteAnnotation: options.onDeleteAnnotation,
      userId: options.userId,
      label: options.label
    });
    
    this._annotationsStore.annotations = options.annotations;
    
    document.addEventListener("localized", (e) => {
      if (!window.PDFViewerApplication.pdfViewer || this._loaded) return;
      this._loaded = true;
      
      
      window.PDFViewerApplication.eventBus.on("updateviewarea", (e) => {
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
      
      window.PDFViewerApplication.eventBus.on("sidebarviewchanged", (e) => {
        if (this._lastState) {
          this._lastState.sidebarView = e.view;
          this._onSetState(this._lastState);
        }
        setTimeout(() => {
          PDFViewerApplication.eventBus.dispatch("resize");
        }, 50);
      });
      
      //
      // window.PDFViewerApplication.eventBus.on("colorchange", (e) => {
      //   if (this._lastState) {
      //     this._lastState.sidebarView = e.view;
      //     this._onSetState(this._lastState);
      //   }
      // });
      
      
      window.PDFViewerApplication.eventBus.on("documentinit", (e) => {
        this._setState(options.state);
      });
      
      // window.PDFViewerApplication.eventBus.on("pagesinit", () => {
      //   window.PDFViewerApplication.pdfDocument._transport.messageHandler.sendWithPromise("setIgnoredAnnotationIds", options.ignoredAnnotationIds);
      // });
      
      render(
        <Annotator
          onAddAnnotation={this._annotationsStore.addAnnotation.bind(this._annotationsStore)}
          onUpdateAnnotation={this._annotationsStore.updateAnnotation.bind(this._annotationsStore)}
          onDeleteAnnotation={this._annotationsStore.deleteAnnotation.bind(this._annotationsStore)}
          onInitialized={() => {
            this._annotationsStore.onUpdateAnnotations = this.setAnnotations;
            this.setAnnotations(this._annotationsStore.getAnnotations());
          }}
          setAnnotationsRef={(ref) => {
            this.setAnnotations = ref;
          }}
          navigateRef={(ref) => {
            this.navigate = ref;
          }}
        />,
        document.createElement("div")
      );
      
      window.PDFViewerApplication.open(options.url);
    });
  }
  
  setAnnotations = (annotations) => {
  
  };
  
  navigate = (annotation) => {
  
  };
  
  _setState(options) {
    window.PDFViewerApplication.pdfSidebar.switchView(options.sidebarView, true);
    window.PDFViewerApplication.pdfSidebarResizer._updateWidth(options.sidebarWidth);
    
    window.PDFViewerApplication.pdfViewer.scrollMode = options.scrollMode;
    window.PDFViewerApplication.pdfViewer.spreadMode = options.spreadMode;
    
    window.PDFViewerApplication.pdfViewer.pagesRotation = options.rotation;
    
    let dest = [null, { name: "XYZ" }, options.left,
      options.top, parseInt(options.scale) ? options.scale / 100 : options.scale];
    
    window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
      pageNumber: options.page,
      destArray: dest,
      allowNegativeOffset: true
    });
  }
}

export default Viewer;
