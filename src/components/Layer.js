import React from "react";
import ReactDom from "react-dom";

import Highlight from "./Highlight";
import Text from "./Text";
import Square from "./Square";
import AreaSelector from "./AreaSelector";
import SelectionMenu from "./SelectionMenu";

import PopupPage from "./PopupPage";
import Meta from "./Meta";

import {
  getPageFromRange,
  getPageFromElement,
  findOrCreateContainerLayer
} from "../lib/pdfjs-dom";

import { p2v, v2p, wx, hy } from "../lib/coordinates";
import {extractRange} from "../lib/extract";
import {copyToClipboard, getClientRects, debounce} from "../lib/utilities";

import "../style/Layer.css";

class PageLayerHighlight extends React.Component {
  getContainerNode(viewport) {
    const textLayer = viewport.textLayer;
    if (!textLayer) {
      return;
    }
    
    return findOrCreateContainerLayer(
      textLayer.textLayerDiv,
      "Layer__highlight"
    );
  }
  
  render() {
    const { view, annotations, activeAnnotationId } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDom.createPortal(
      <div>
        {annotations.map(
          (annotation, index) => {
            const { position, ...rest } = annotation;
            
            const viewportAnnotation = {
              position: p2v(position, view.viewport),
              ...rest
            };
            
            return (
              <div key={annotation.id}>
                <Highlight
                  annotation={viewportAnnotation}
                  active={activeAnnotationId === annotation.id}
                />
              </div>
            );
          }
        )}
      </div>,
      node
    );
  }
}

class PageLayerText extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      "Layer__text"
    );
  }
  
  render() {
    const {
      view,
      annotations,
      activeAnnotationId,
      enableInactiveDragging,
      onChangePosition
    } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDom.createPortal(
      <div>
        {annotations.map(
          (annotation, index) => {
            const { position, ...rest } = annotation;
            
            const viewportAnnotation = {
              position: p2v(position, view.viewport),
              ...rest
            };
            
            return (
              <div key={annotation.id}>
                <Text
                  annotation={viewportAnnotation}
                  active={activeAnnotationId === annotation.id}
                  enableInactiveDragging={enableInactiveDragging}
                  onChangePosition={(position) => {
                    onChangePosition(annotation.id, position);
                  }}
                />
              </div>
            );
          }
        )}
      </div>,
      node
    );
  }
}

class PageLayerSquare extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      "Layer__square"
    );
  }
  
  render() {
    const {
      view,
      annotations,
      activeAnnotationId,
      onChangePosition
    } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDom.createPortal(
      <div>
        {annotations.map(
          (annotation, index) => {
            const { position, ...rest } = annotation;
            
            const viewportAnnotation = {
              position: p2v(position, view.viewport),
              ...rest
            };
            
            return (
              <div key={annotation.id}>
                <Square
                  annotation={viewportAnnotation}
                  active={activeAnnotationId === annotation.id}
                  onChangePosition={(position) => {
                    onChangePosition(annotation.id, position);
                  }}
                />
              </div>
            );
          }
        )}
      </div>,
      node
    );
  }
}

class AreaSelectorLayer extends React.Component {
  render() {
    let { color, enableAreaSelector, onSelection } = this.props;
    let areaSelectorContainer = document.getElementById("areaSelectorContainer");
    if (!areaSelectorContainer) {
      let viewerContainer = document.getElementById("viewerContainer");
      areaSelectorContainer = document.createElement("div");
      areaSelectorContainer.id = "areaSelectorContainer";
      viewerContainer.appendChild(areaSelectorContainer);
    }
    return ReactDom.createPortal(
      <AreaSelector
        onDragStart={() => {
          // console.log("dragstart");
        }}
        onDragEnd={() => {
          // console.log("dragstop");
        }}
        onChange={isVisible => {
          // console.log({ isVisible });
        }}
        color={color}
        shouldStart={enableAreaSelector}
        onSelection={onSelection}
      />,
      areaSelectorContainer);
  }
}

class Layer extends React.Component {
  state = {
    selection: null,
    editing: false,
    initialized: false,
    dragging: false
  };
  
  viewer = null;
  
  containerNode = null;
  
  componentDidMount() {
    const { onMouseSelection, onPointerUp, onPointerDown } = this.props;
    this.debouncedAfterSelection = this.afterSelection;
    
    this.viewer = window.PDFViewerApplication.pdfViewer;
    
    this.viewer.eventBus.on("pagesinit", this.onDocumentReady);
    this.viewer.eventBus.on("textlayerrendered", this.onTextLayerRendered);
    
    
    this.containerNode = document.getElementById("viewerContainer");
    // this.renderAnnotations();
    
    this.containerNode.addEventListener("click", e => {
      this.setState({ selectionFinished: !!this.state.range });
    });
    
    this.containerNode.addEventListener("mouseup", async e => {
      let selection = await this.getSelection();
      if (!selection) return;
      selection.position = this.v2p(selection.position);
      onMouseSelection(selection);
    });
    
    this.containerNode.addEventListener("mousedown", e => {
      const page = getPageFromElement(e.target);
      if (!page) {
        return;
      }
      
      let containerEl = page.node;
      const offset = containerEl.getBoundingClientRect();
      
      const x = e.clientX + containerEl.scrollLeft - offset.left - 9;
      const y = e.clientY + containerEl.scrollTop - offset.top - 10;
      
      const position = {
        pageNumber: page.number,
        rects: [[x, y, x, y]]
      };
      
      let p = this.v2p(position);
      p.rects[0][0] -= 10;
      p.rects[0][1] -= 10;
      p.rects[0][2] += 10;
      p.rects[0][3] += 10;
      
      onPointerDown(this.v2p(position));
    });
    
    this.containerNode.addEventListener("mouseup", e => {
      const page = getPageFromElement(e.target);
      if (!page) {
        return;
      }
      
      let containerEl = page.node;
      const offset = containerEl.getBoundingClientRect();
      
      const x = e.clientX + containerEl.scrollLeft - offset.left - 9;
      const y = e.clientY + containerEl.scrollTop - offset.top - 10;
      
      const position = {
        pageNumber: page.number,
        rects: [[x, y, x, y]]
      };
      
      let p = this.v2p(position);
      p.rects[0][0] -= 10;
      p.rects[0][1] -= 10;
      p.rects[0][2] += 10;
      p.rects[0][3] += 10;
      
      // Shoot the event after all other events are emitted.
      // Otherwise the resize updating in the square annotation is emitted too late
      setTimeout(() => {
        onPointerUp(this.v2p(position));
      }, 0);
    }, true);
    
    document.addEventListener("selectionchange", this.onSelectionChange);
  }
  
  componentWillUnmount() {
    document.removeEventListener("selectionchange", this.onSelectionChange);
    
    this.containerNode &&
    this.containerNode.removeEventListener(
      "textlayerrendered",
      this.onTextLayerRendered
    );
  }
  
  groupAnnotationsByPage(annotations) {
    return [...annotations]
      .filter(Boolean)
      .reduce((res, annotation) => {
        if (annotation.external) return res;
        const { pageNumber } = annotation.position;
        
        res[pageNumber] = res[pageNumber] || [];
        res[pageNumber].push(annotation);
        
        return res;
      }, {});
  }
  
  onTextLayerRendered = () => {
    this.setState({ initialized: true });
  };
  
  scrollTo = (annotation) => {
    let x = annotation.position.rects[0][0];
    let y = annotation.position.rects[0][3] + 100;
    
    this.viewer.scrollPageIntoView({
      pageNumber: annotation.position.pageNumber,
      destArray: [
        null,
        { name: "XYZ" },
        x,
        y,
        null
      ]
    });
  };
  
  onDocumentReady = () => {
    const { scrollRef } = this.props;
    scrollRef(this.scrollTo);
  };
  
  selectionChangeDebounce = debounce(async () => {
    this.setState({ selection: await this.getSelection() });
  }, 250);
  
  onSelectionChange = () => {
    this.setState({ selection: null });
    this.selectionChangeDebounce();
  };
  
  async getSelection() {
    const selection = window.getSelection();
	
	  if (selection.anchorNode && selection.focusNode) {
		  let a = selection.anchorNode;
		  if (a.nodeType === Node.TEXT_NODE) {
			  a = a.parentElement;
		  }
		
		  let b = selection.focusNode;
		  if (b.nodeType === Node.TEXT_NODE) {
			  b = b.parentElement;
		  }
		
		  if (
			  !a.parentNode.className.includes('textLayer') ||
			  !b.parentNode.className.includes('textLayer')
		  ) {
			  return null;
		  }
		
		  if (a.parentNode !== b.parentNode) {
			  return null;
		  }
	  }
    
    let range = null;
    
    if (!selection.isCollapsed) {
      range = selection.getRangeAt(0);
    }
    
    if (!range) return null;
    
    const page = getPageFromRange(range);
    
    if (!page) {
      return null;
    }
    const rects = getClientRects(range, page.node);
    
    if (rects.length === 0) {
      return null;
    }
    
    const position = { rects, pageNumber: page.number };
    
    let extractedRange = await extractRange(this.v2p(position));
    if(!extractedRange) return null;
    
    extractedRange.position = this.p2v(extractedRange.position);
    return extractedRange;
  }
  
  toggleTextSelection(flag) {
    this.viewer.viewer.classList.toggle(
      "Layer--disable-selection",
      flag
    );
  }
  
  v2p(position) {
    const viewport = this.viewer.getPageView(position.pageNumber - 1).viewport;
    return v2p(position, viewport);
  }
  
  p2v(position) {
    const viewport = this.viewer.getPageView(position.pageNumber - 1).viewport;
    return p2v(position, viewport);
  }
  
  render() {
    let {
      annotations,
      color,
      activeAnnotationId,
      enableAreaSelector,
      enableInactiveTextDragging,
      popupAnnotation,
      popupSelection,
      onSelection,
      onChange,
      onDelete,
      onHighlight
    } = this.props;
    
    if (!this.viewer || !this.viewer.pdfDocument || !this.state.initialized) return null;
    
    const annotationsByPage = this.groupAnnotationsByPage(annotations);
    const annotationsByPagePrev = this.groupAnnotationsByPage(this.props.annotations);
    
    let pageLayers = [];
    for (let pageNumber = 1; pageNumber <= this.viewer.pdfDocument.numPages; pageNumber++) {
      if (!annotationsByPage[String(pageNumber)] && !annotationsByPagePrev[String(pageNumber)]) continue;
      
      let view = this.viewer.getPageView(pageNumber - 1);
      
      pageLayers.push(
        <PageLayerHighlight
          key={"h_" + pageNumber}
          view={view}
          activeAnnotationId={activeAnnotationId}
          annotations={(annotationsByPage[String(pageNumber)].filter(x => x.type === "highlight") || [])}
        />,
        <PageLayerText
          key={"t_" + pageNumber}
          view={view}
          activeAnnotationId={activeAnnotationId}
          enableInactiveDragging={enableInactiveTextDragging}
          annotations={(annotationsByPage[String(pageNumber)].filter(x => x.type === "text") || [])}
          onChangePosition={(id, position) => {
            onChange({ id, position: this.v2p(position) });
          }}
          onDragStart={() => {
            this.setState({ dragging: true });
          }}
          onDragStop={() => {
            this.setState({ dragging: false });
          }}
        />,
        <PageLayerSquare
          key={"s_" + pageNumber}
          view={view}
          activeAnnotationId={activeAnnotationId}
          annotations={(annotationsByPage[String(pageNumber)].filter(x => x.type === "square") || [])}
          onChangePosition={(id, position) => {
            onChange({ id, position: this.v2p(position) });
          }}
          onDragStart={() => {
            this.setState({ dragging: true });
          }}
          onDragStop={() => {
            this.setState({ dragging: false });
          }}
        />
      );
    }
    
    if (popupAnnotation) {
      const { position, ...rest } = popupAnnotation;
      popupAnnotation = {
        position: this.p2v(position),
        ...rest
      };
    }
    
    return (
      <React.Fragment>
        <AreaSelectorLayer
          color={color}
          enableAreaSelector={enableAreaSelector}
          onSelection={(position) => {
            onSelection(this.v2p(position));
          }}
        />
        {
          popupAnnotation && !this.state.dragging && !window.PDFViewerApplication.pdfSidebar.isOpen ? (
            <PopupPage
              className="AnnotationPopup"
              position={popupAnnotation.position}
            >
              <div className="AnnotationPopup__title">
                <div>{popupAnnotation.label}</div>
                <div>{popupAnnotation.dateModified.split("T")[0]}</div>
              </div>
              <Meta
                annotation={popupAnnotation}
                onUpdate={(comment) => {
                  onChange({ id: popupAnnotation.id, comment });
                }}
                onColorChange={(color) => {
                  onChange({ id: popupAnnotation.id, color });
                }}
                onDelete={() => {
                  onDelete(popupAnnotation.id);
                }}
              />
            
            </PopupPage>
          ) : null
        }
        {
          this.state.selection && this.props.enableMouseSelection ? (
            <PopupPage position={this.state.selection.position}>
              <SelectionMenu
                onHighlight={() => {
                  let selection = this.state.selection;
                  selection.position = this.v2p(selection.position);
                  onHighlight(selection);
                }}
                onCopy={() => {
                  if (this.state.selection) {
                    copyToClipboard(this.state.selection.text);
                  }
                }}
              />
            </PopupPage>
          ) : null
        }
        {pageLayers}
      </React.Fragment>
    );
  }
}

export default Layer;
