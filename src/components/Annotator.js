import React from "react";

import Layer from "./Layer";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import PopupScreen from "./PopupScreen";
import ColorPicker from "./ColorPicker";

import { annotationColors } from "../lib/colors";

import "../style/pdfjs.css";
import "../style/Annotator.css"

class Annotator extends React.Component {
  state = {
    activeAnnotationId: null,
    recentlyCreatedAnnotationId: null,
    recentlyUpdatedAnnotationId: null,
    mode: null,
    color: annotationColors[0],
    colorPicking: false,
    annotations: []
  };
  
  scrollViewerTo = (annotation) => {
  
  };
  
  initKeyboard() {
    window.addEventListener("keydown", e => {
      let viewerContainer = document.getElementById("viewerContainer");
      let annotationsView = document.getElementById("annotationsView");
      if ([8, 46].includes(e.keyCode)) {
        if (e.target === viewerContainer || e.target === annotationsView) {
          if (e.key === "Delete" || e.key === "Backspace") {
            this.deleteAnnotation(this.state.activeAnnotationId);
          }
        }
      }
    });
  }
  
  navigate = (annotation) => {
    this.setState({ activeAnnotationId: annotation.id });
    this.scrollViewerTo(this.state.annotations.find(x => x.id === annotation.id));
  };
  
  setAnnotations = (annotations) => {
    this.setState({ annotations });
  };
  
  componentDidMount() {
    let { onInitialized, navigateRef, setAnnotationsRef } = this.props;
    
    this.initKeyboard();
    
    navigateRef(this.navigate);
    setAnnotationsRef(this.setAnnotations);
    
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".PopupScreen") && !e.target.closest(".toolbarButton")) {
        this.setState({ colorPicking: false });
      }
    });
    
    
    document.addEventListener("mousedown", (e) => {
    
    });
    
    onInitialized();
  }
  
  componentDidUpdate(prevProps, prevState) {
    if (prevState.activeAnnotationId !== this.state.activeAnnotationId) {
      setTimeout(() => {
        let el = document.querySelector("div[data-sidebar-id=\"" + this.state.activeAnnotationId + "\"");
        let container = document.getElementById("annotationsView");
        if (!el || !container) return;
        this.ensureInView(container, el);
      }, 50);
    }
  }
  
  toggleMode(mode) {
    if (this.state.mode === mode) {
      this.setState({ mode: null });
    }
    else {
      this.setState({ mode });
    }
    this.setState({ activeAnnotationId: null });
  }
  
  hasSelectedText() {
    let text = "";
    if (window.getSelection) {
      text = window.getSelection().toString();
    }
    else if (document.selection && document.selection.type != "Control") {
      text = document.selection.createRange().text;
    }
    return !!text;
  }
  
  clearSelection() {
    const selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
    if (!!selection) selection.empty ? selection.empty() : selection.removeAllRanges();
  }
  
  
  getAnnotationsAtPoint(position) {
    let found = [];
    let x = position.rects[0][0];
    let y = position.rects[0][1];
    
    for (let annotation of this.state.annotations) {
      for (let rect of annotation.position.rects) {
        if (
          annotation.position.pageNumber === position.pageNumber &&
          rect[0] <= x && x <= rect[2] &&
          rect[1] <= y && y <= rect[3]
        ) {
          found.push(annotation);
          break;
        }
      }
    }
    return found;
  }
  
  inClick(position) {
    if (this.state.recentlyUpdatedAnnotationId) {
      this.setState({ activeAnnotationId: this.state.recentlyUpdatedAnnotationId });
      return;
    }
    
    if (this.state.recentlyCreatedAnnotationId) {
      let annotation = this.state.annotations.find(x => x.id === this.state.recentlyCreatedAnnotationId);
      if (annotation && annotation.type !== "text") {
        return;
      }
    }
    
    if (this.hasSelectedText()) {
      this.setState({ activeAnnotationId: null });
      return;
    }
    
    let hl = this.state.annotations.find(hl => hl.id == this.state.activeAnnotationId);
    if (!hl) hl = {};
    
    let found = [];
    let x = position.rects[0][0];
    let y = position.rects[0][1];
    
    for (let annotation of this.state.annotations) {
      for (let rect of annotation.position.rects) {
        if (annotation.position.pageNumber === position.pageNumber && rect[0] <= x && x <= rect[2] &&
          rect[1] <= y && y <= rect[3]) {
          found.push(annotation);
          break;
        }
      }
    }
    
    let selectedId = null;
    
    let indexOfCurrentId = found.indexOf(found.find(annotation => annotation.id === this.state.activeAnnotationId));
    
    if (indexOfCurrentId >= 0) {
      if (indexOfCurrentId < found.length - 1) {
        selectedId = found[indexOfCurrentId + 1].id;
      }
      else {
        if (found.length) {
          selectedId = found[0].id;
        }
        // selectedId = null;
      }
    }
    else {
      if (found.length) {
        selectedId = found[0].id;
      }
    }
    
    this.setState({ activeAnnotationId: selectedId });
  }
  
  ensureInView(container, element) {
    
    //Determine container top and bottom
    let cTop = container.scrollTop;
    let cBottom = cTop + container.clientHeight;
    
    //Determine element top and bottom
    let eTop = element.offsetTop;
    let eBottom = eTop + element.clientHeight;
    
    //Check if out of view
    if (eTop < cTop) {
      container.scrollTop -= (cTop - eTop);
    }
    else if (eBottom > cBottom) {
      container.scrollTop += (eBottom - cBottom);
    }
  }
  
  render() {
    const { onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation } = this.props;
    const { annotations } = this.state;
    
    return (
      <div>
        <Toolbar
          active={this.state.mode}
          onMode={(mode) => {
            this.toggleMode(mode);
          }}
          color={this.state.color}
          onColorClick={() => {
            this.setState({ colorPicking: true });
          }}
        />
        {this.state.colorPicking ? (
          <PopupScreen className="GlobalColorPickerPopup" parentId="globalColorButton">
            <ColorPicker onColorPick={(color) => {
              this.setState({ color });
              this.setState({ colorPicking: false });
              // PDFViewerApplication.eventBus.dispatch("colorchange", {color});
            }}/>
          </PopupScreen>
        ) : null}
        <Sidebar
          annotations={this.state.annotations}
          activeAnnotationId={this.state.activeAnnotationId}
          onSelectAnnotation={(id) => {
            this.setState({ activeAnnotationId: id });
            this.scrollViewerTo(this.state.annotations.find(x => x.id === id));
          }}
          onChange={(annotation) => {
            onUpdateAnnotation(annotation);
            this.setState({ recentlyUpdatedAnnotationId: annotation.id });
          }}
          onDelete={(id) => {
            onDeleteAnnotation(id);
          }}
        />
        <Layer
          scrollRef={scrollTo => {
            this.scrollViewerTo = scrollTo;
          }}
          onMouseSelection={(selection) => {
            // this.setState({ selection });
            if (this.state.mode === "highlight") {
              let annotation = onAddAnnotation({
                type: "highlight",
                color: this.state.color,
                position: selection.position,
                text: selection.text,
                comment: ""
              });
              
              this.setState({ recentlyCreatedAnnotationId: annotation.id });
              this.clearSelection();
            }
          }}
          onHighlight={(selection) => {
            let annotation = onAddAnnotation({
              type: "highlight",
              color: this.state.color,
              position: selection.position,
              text: selection.text,
              comment: ""
            });
            
            this.setState({ recentlyCreatedAnnotationId: annotation.id });
            this.clearSelection();
          }}
          enableAreaSelector={this.state.mode === "square" && !this.state.activeAnnotationId}
          enableMouseSelection={!this.state.mode}
          enableInactiveTextDragging={this.state.mode !== "square"}
          onSelection={(position) => {
            let annotation = onAddAnnotation({
              type: "square",
              color: this.state.color,
              position: position,
              comment: ""
            });
            this.setState({ recentlyCreatedAnnotationId: annotation.id });
            this.setState({ mode: null });
          }}
          onChange={(annotation) => {
            onUpdateAnnotation(annotation);
            this.setState({ recentlyUpdatedAnnotationId: annotation.id });
          }}
          onDelete={(id) => {
            onDeleteAnnotation(id);
          }}
          onPointerDown={(position) => {
            this.setState({
              recentlyCreatedAnnotationId: null,
              recentlyUpdatedAnnotationId: null
            });
            if (!this.getAnnotationsAtPoint(position).length) {
              this.setState({ activeAnnotationId: null });
            }
          }}
          onPointerUp={(position) => {
            // console.log(position);
            this.inClick(position);
            if (this.state.mode === "text") {
              position.rects[0][0] -= 10;
              position.rects[0][1] -= 10;
              position.rects[0][2] += 10;
              position.rects[0][3] += 10;
              let annotation = onAddAnnotation({
                type: "text",
                position: position,
                color: this.state.color,
                comment: ""
              });
              this.setState({ recentlyCreatedAnnotationId: annotation.id });
              this.setState({ activeAnnotationId: annotation.id });
              this.setState({ mode: null });
            }
          }}
          popupAnnotation={this.state.activeAnnotationId ? this.state.annotations.find(x => x.id === this.state.activeAnnotationId) : null}
          popupSelection={this.state.selection ? { position: this.state.selection.position } : null}
          activeAnnotationId={this.state.activeAnnotationId}
          annotations={annotations}
          color={this.state.color}
        >
        </Layer>
      </div>
    );
  }
}

export default Annotator;
