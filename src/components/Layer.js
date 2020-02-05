import React from "react";
import ReactDom from "react-dom";

import cn from "classnames"

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
      <div className={cn({'selecting-annotation': !!activeAnnotationId})}>
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


class MarginNoteLayer extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      "Layer__marginNote"
    );
  }
  
  getDirection(pageWidth, position) {
    let min = Infinity;
    let max = 0;
  
    for (let rect of position.rects) {
      if (rect[0] < min) {
        min = rect[0];
      }
    
      if (rect[2] > max) {
        max = rect[2];
      }
    }
    
    if (min + (max-min)/2 < pageWidth / 2) {
      return 'left';
    }
    
    return 'right';
  }
  
  getStackedMarginNotes(marginNotes, isRight) {
    let scale = PDFViewerApplication.pdfViewer._currentScale;
    marginNotes.sort((a, b) => b.top - a.top);
    
    let marginNotesGrouped = [];
    
    for (let marginNote of marginNotes) {
      if (marginNotesGrouped.length) {
        let prev = marginNotesGrouped[marginNotesGrouped.length - 1];
        
        if (prev[0].rect.top + prev[0].rect.height >= marginNote.rect.top) {
          prev.push(marginNote);
        }
        else {
          marginNotesGrouped.push([marginNote]);
        }
      }
      else {
        marginNotesGrouped.push([marginNote]);
      }
    }
    
    let marginNotesStacked = [];
    
    for (let mg of marginNotesGrouped) {
      let first = mg[0];
      marginNotesStacked.push(first);
      for (let i = 1; i < mg.length; i++) {
        let m = mg[i];
        m.rect.top = first.rect.top;
        if (isRight) {
          m.rect.left -= i * m.rect.width/2
        }
        else {
          m.rect.left += i * m.rect.width/2;
        }
        marginNotesStacked.push(m)
      }
    }
    
    return marginNotesStacked;
  }
  
  getMarginNotes(marginLeft, marginRight, pageWidth, annotations, viewport) {
    let marginLeftNotes = [];
    let marginRightNotes = [];
    
    let scale = PDFViewerApplication.pdfViewer._currentScale;
    
    const width = 15 * scale;
    const height = 15 * scale;
    
    for (let annotation of annotations) {
      let viewportPosition = p2v(annotation.position, viewport);
      let direction = this.getDirection(pageWidth, viewportPosition)
      console.log({direction})
      let left;
      if (direction === 'right') {
        left = marginRight + (pageWidth - marginRight) / 2 - width / 2;
        marginRightNotes.push({
            annotation,
            rect: {
              left: left,
              top: viewportPosition.rects[0][1],
              width: width,
              height: height
            }
          }
        );
      }
      else {
        left = marginLeft / 2 - width / 2;
        marginLeftNotes.push({
            annotation,
            rect: {
              left: left,
              top: viewportPosition.rects[0][1],
              width: width,
              height: height
            }
          }
        );
      }
    }
		console.log({marginLeftNotes, marginRightNotes})
   let marginNotes = this.getStackedMarginNotes(marginLeftNotes).concat(this.getStackedMarginNotes(marginRightNotes, true));
		marginNotes = marginNotes.reverse();
    console.log('marginNotes', marginNotes);
    return marginNotes;
  }
  
  render() {
    const {
      view,
      annotations,
      activeAnnotationId,
      marginLeft,
      marginRight,
      pageWidth,
      onClick
    } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    let comentedAnnotations = annotations.filter(x => x.comment)
    let marginNotes = this.getMarginNotes(marginLeft, marginRight, pageWidth, comentedAnnotations, view.viewport);
    
    console.log('marginNotes', marginNotes);
    
    return ReactDom.createPortal(
      <div>
        {marginNotes.map(
          (marginNote) => {
            let active = activeAnnotationId === marginNote.annotation.id;
            return (
              <div
                key={marginNote.annotation.id}
                className={`MarginNote ${active ? "MarginNote-active" : ""}`}
                style={{
                  left: marginNote.rect.left,
                  top: marginNote.rect.top,
                  width: marginNote.rect.width,
                  height: marginNote.rect.height,
                  backgroundColor: marginNote.annotation.color,
                  zIndex: active?2:1
                }}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClick(marginNote.annotation.id);
                }}
              />
            );
          }
        )}
      </div>,
      node
    );
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
      
      if (e.target.classList.contains('MarginNote')) {
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
  
    let viewerNode = document.getElementById('viewer');
    viewerNode.addEventListener('dragstart', (e) => {
      let annotation = {
        itemId: window.itemId,
        text: this.state.selection.text,
        position: this.state.selection.position
      };
      
      // Todo: Move this out from here
      let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
  
      if (pageLabels && pageLabels[annotation.position.pageNumber - 1]) {
        annotation.page = pageLabels[annotation.position.pageNumber - 1];
      }
      else {
        annotation.page = annotation.position.pageNumber;
      }
      
      e.dataTransfer.setData('zotero/annotation', JSON.stringify({...annotation, position: this.v2p(annotation.position)}));
      e.dataTransfer.setData('text/plain', JSON.stringify({...annotation, position: this.v2p(annotation.position)}));
    });
    
    viewerNode.addEventListener('dragend', (e) => {
      if (window.getSelection().empty) {  // Chrome
        window.getSelection().empty();
      }
      else if (window.getSelection().removeAllRanges) {  // Firefox
        window.getSelection().removeAllRanges();
      }
    });
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
    console.log('sell', await this.getSelection());
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
  
  getMargins(pageNumber) {
    let pageView = window.PDFViewerApplication.pdfViewer.getPageView(pageNumber - 1);
    
    let pageWidth = window.PDFViewerApplication.pdfViewer.getPageView(pageNumber - 1).width;

    
    if (!pageView.textLayer || !pageView.textLayer.textDivs) {
      return [0, pageWidth];
    }
    
    let data = pageView.textLayer.textDivs.map(x => parseFloat(x.style.left)).filter(x => x).sort((a, b) => a - b);

    let result = data.reduce(function (r, a, i, aa) {
      if (a - aa[i - 1] < 5) {
        if (!Array.isArray(r[r.length - 1])) {
          r[r.length - 1] = [r[r.length - 1]];
        }
        r[r.length - 1].push(a);
        return r;
      }
      r.push(a);
      return r;
    }, []);
    
    console.log(result);
    
    let b = result.map(ar => {
      if (!Array.isArray(ar)) ar = [ar];
      let sum = ar.reduce((a, b) => a + b, 0);
      let avg = sum / ar.length;
      return [avg, ar.length];
    });
    
    b = b.filter(x => x[1] >= 10);
    
    let res = null;
    if (b.length) {
      res = b[0][0];
    }
    
    let margins = [res, pageWidth - res];
    
    console.log('margins', margins)
    
    return margins;
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
      onHighlight,
      onClickTags,
      onClickMarginNote
    } = this.props;
    
    if (!this.viewer || !this.viewer.pdfDocument || !this.state.initialized) return null;
    
    const annotationsByPage = this.groupAnnotationsByPage(annotations);
    const annotationsByPagePrev = this.groupAnnotationsByPage(this.props.annotations);
    
    let pageLayers = [];
    for (let pageNumber = 1; pageNumber <= this.viewer.pdfDocument.numPages; pageNumber++) {
      if (!annotationsByPage[String(pageNumber)] && !annotationsByPagePrev[String(pageNumber)]) continue;
      
      let view = this.viewer.getPageView(pageNumber - 1);
      
      let margins = this.getMargins(pageNumber);
      let pageWidth = window.PDFViewerApplication.pdfViewer.getPageView(pageNumber - 1).width;
      
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
        />,
        <MarginNoteLayer
          key={"m_" + pageNumber}
          view={view}
          activeAnnotationId={activeAnnotationId}
          annotations={(annotationsByPage[String(pageNumber)].filter(x => ["highlight", "square"].includes(x.type)) || [])}
          marginLeft={margins[0]}
          marginRight={margins[1]}
          pageWidth={pageWidth}
          onClick={onClickMarginNote}
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
              // onDragStart={(event)=> {
              //     let annotation = popupAnnotation;
              //     annotation.itemId = window.itemId;
              //     event.dataTransfer.setData('zotero/annotation', JSON.stringify({...annotation, position: this.v2p(annotation.position)}));
              //     event.dataTransfer.setData('text/plain', JSON.stringify({...annotation, position: this.v2p(annotation.position)}));
              //   }}
            >
              {/*<div className="AnnotationPopup__title">*/}
              {/*  <div>{popupAnnotation.label}</div>*/}
              {/*  <div>{popupAnnotation.dateModified.split("T")[0]}</div>*/}
              {/*</div>*/}
              <Meta
                annotation={popupAnnotation}
                isLayer={true}
                onUpdate={(comment) => {
                  onChange({ id: popupAnnotation.id, comment });
                }}
                onColorChange={(color) => {
                  onChange({ id: popupAnnotation.id, color });
                }}
                onDelete={() => {
                  onDelete(popupAnnotation.id);
                }}
                onClickTags={onClickTags}
                onChange={onChange}
                onDragStart={(event) => {
                  let annotation = popupAnnotation;
                  annotation.itemId = window.itemId;
                  event.dataTransfer.setData('zotero/annotation', JSON.stringify({...annotation, position: this.v2p(annotation.position)}));
                  event.dataTransfer.setData('text/plain', JSON.stringify({...annotation, position: this.v2p(annotation.position)}));
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
