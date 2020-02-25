'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames'
import Highlight from './highlight';
import Note from './note';
import Area from './area';
import AreaSelector from './area-selector';
import SelectionMenu from './selection-menu';
import PagePopup from './page-popup';
import AnnotationPreview from './annotation-preview';

import {
  getPageFromRange,
  getPageFromElement,
  findOrCreateContainerLayer
} from '../lib/pdfjs-dom';

import { p2v, v2p, wx, hy } from '../lib/coordinates';
import { extractRange } from '../lib/extract';
import {
  copyToClipboard,
  getClientRects,
  debounce,
  formatAnnotationText,
  throttle
} from '../lib/utilities';

class PageLayerHighlight extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      'layer-highlight'
    );
  }
  
  render() {
    let { view, annotations, activeAnnotationId } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDOM.createPortal(
      <div className={cx({ 'selecting-annotation': !!activeAnnotationId })}>
        {annotations.map(
          (annotation, index) => {
            let { position, ...rest } = annotation;
            
            let viewportAnnotation = {
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

class PageLayerNote extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      'layer-note'
    );
  }
  
  render() {
    let {
      view,
      annotations,
      activeAnnotationId,
      enableInactiveDragging,
      onChangePosition
    } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDOM.createPortal(
      <div>
        {annotations.map(
          (annotation, index) => {
            let { position, ...rest } = annotation;
            
            let viewportAnnotation = {
              position: p2v(position, view.viewport),
              ...rest
            };
            
            return (
              <div key={annotation.id}>
                <Note
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

class PageLayerArea extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      'layer-area'
    );
  }
  
  render() {
    let {
      view,
      annotations,
      activeAnnotationId,
      onChangePosition
    } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDOM.createPortal(
      <div>
        {annotations.map(
          (annotation, index) => {
            let { position, ...rest } = annotation;
            
            let viewportAnnotation = {
              position: p2v(position, view.viewport),
              ...rest
            };
            
            return (
              <div key={annotation.id}>
                <Area
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
    let areaSelectorContainer = document.getElementById('areaSelectorContainer');
    if (!areaSelectorContainer) {
      let viewerContainer = document.getElementById('viewerContainer');
      areaSelectorContainer = document.createElement('div');
      areaSelectorContainer.id = 'areaSelectorContainer';
      viewerContainer.appendChild(areaSelectorContainer);
    }
    return ReactDOM.createPortal(
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
      areaSelectorContainer
    );
  }
}


class MarginNoteLayer extends React.Component {
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      'layer-margin-note'
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
    
    if (min + (max - min) / 2 < pageWidth / 2) {
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
          m.rect.left -= i * m.rect.width / 2
        }
        else {
          m.rect.left += i * m.rect.width / 2;
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
    
    let width = 10 * scale;
    let height = 10 * scale;
    
    for (let annotation of annotations) {
      let viewportPosition = p2v(annotation.position, viewport);
      let direction = this.getDirection(pageWidth, viewportPosition)
      
      let left;
      if (direction === 'right') {
        left = marginRight + (pageWidth - marginRight) / 2 - width / 2;
        marginRightNotes.push({
            annotation,
            rect: {
              left: viewportPosition.rects[0][0]-width/2,
              top: viewportPosition.rects[0][1]-height+height/3,
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
              left: viewportPosition.rects[0][0]-width/2,
              top: viewportPosition.rects[0][1]-height+height/3,
              width: width,
              height: height
            }
          }
        );
      }
    }
    // let marginNotes = this.getStackedMarginNotes(marginLeftNotes).concat(this.getStackedMarginNotes(marginRightNotes, true));
    
    let marginNotes = marginLeftNotes.concat(marginRightNotes)
    marginNotes = marginNotes.reverse();
    return marginNotes;
  }
  
  render() {
    let {
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
    
    let commentedAnnotations = annotations.filter(x => x.comment)
    let marginNotes = this.getMarginNotes(marginLeft, marginRight, pageWidth, commentedAnnotations, view.viewport);
    
    return ReactDOM.createPortal(
      <div>
        {marginNotes.map(
          (marginNote) => {
            let active = activeAnnotationId === marginNote.annotation.id;
            return (
              <div
                key={marginNote.annotation.id}
                className={cx('margin-note', { active })}
                style={{
                  left: marginNote.rect.left,
                  top: marginNote.rect.top,
                  width: marginNote.rect.width,
                  height: marginNote.rect.height,
                  backgroundColor: marginNote.annotation.color,
                  zIndex: active ? 2 : 1
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

class BlinkLayer extends React.Component {
  interval = null;
  
  componentDidUpdate(prevProps) {
    if (prevProps.id !== this.props.id) {
      this.fade(this.refs.blink);
    }
  }
  
  componentDidMount() {
    this.fade(this.refs.blink);
  }
  
  fade(element) {
    if (this.interval) clearInterval(this.interval);
    let op = 1;
    this.interval = setInterval(() => {
      
      if (!element) return;
      if (op <= 0.05) {
        clearInterval(this.interval);
        element.style.opacity = 0;
        return;
      }
      element.style.opacity = op;
      op -= op * 0.1;
    }, 100);
  }
  
  getContainerNode(viewport) {
    return findOrCreateContainerLayer(
      viewport.div,
      'layer-blink'
    );
  }
  
  render() {
    let { view, position } = this.props;
    
    let node = this.getContainerNode(view);
    if (!node) return null;
    
    return ReactDOM.createPortal(
      <div ref="blink">
        {position.rects.map((rect, index) => (
          <div
            key={index}
            className="rect"
            style={{
              left: rect[0],
              top: rect[1],
              width: rect[2] - rect[0],
              height: rect[3] - rect[1]
            }}
          />
        ))}
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
    let { onMouseSelection, onPointerUp, onPointerDown, onMouseMove } = this.props;
    this.debouncedAfterSelection = this.afterSelection;
    
    this.viewer = window.PDFViewerApplication.pdfViewer;
    
    this.viewer.eventBus.on('pagesinit', this.onDocumentReady);
    this.viewer.eventBus.on('textlayerrendered', this.onTextLayerRendered);
    
    
    this.containerNode = document.getElementById('viewerContainer');
    
    this.containerNode.addEventListener('click', e => {
      this.setState({ selectionFinished: !!this.state.range });
    });
    
    this.containerNode.addEventListener('mouseup', async e => {
      let selection = await this.getSelection();
      if (!selection) return;
      selection.position = this.v2p(selection.position);
      onMouseSelection(selection);
    });
    
    this.containerNode.addEventListener('mousedown', e => {
      let page = getPageFromElement(e.target);
      if (!page) {
        return;
      }
      
      let containerEl = page.node;
      let offset = containerEl.getBoundingClientRect();
      
      let x = e.clientX + containerEl.scrollLeft - offset.left - 9;
      let y = e.clientY + containerEl.scrollTop - offset.top - 10;
      
      let position = {
        pageIndex: page.number - 1,
        rects: [[x, y, x, y]]
      };
      
      onPointerDown(this.v2p(position));
    });
    
    this.containerNode.addEventListener('mouseup', e => {
      let page = getPageFromElement(e.target);
      if (!page) {
        return;
      }
      
      if (e.target.classList.contains('margin-note')) {
        return;
      }
      
      let containerEl = page.node;
      let offset = containerEl.getBoundingClientRect();
      
      let x = e.clientX + containerEl.scrollLeft - offset.left - 9;
      let y = e.clientY + containerEl.scrollTop - offset.top - 10;
      
      let position = {
        pageIndex: page.number - 1,
        rects: [[x, y, x, y]]
      };
      
      // Shoot the event after all other events are emitted.
      // Otherwise the resize updating in the area annotation is emitted too late
      setTimeout(() => {
        onPointerUp(this.v2p(position));
      }, 0);
    }, true);
  
    this.containerNode.addEventListener('mousemove', throttle(e => {
      let page = getPageFromElement(e.target);
      if (!page) {
        return;
      }
    
      let containerEl = page.node;
      let offset = containerEl.getBoundingClientRect();
    
      let x = e.clientX + containerEl.scrollLeft - offset.left - 9;
      let y = e.clientY + containerEl.scrollTop - offset.top - 10;
    
      let position = {
        pageIndex: page.number - 1,
        rects: [[x, y, x, y]]
      };
    
      onMouseMove(this.v2p(position));
    }, 50), true);
    
    document.addEventListener('selectionchange', this.onSelectionChange);
    
    let viewerNode = document.getElementById('viewer');
    viewerNode.addEventListener('dragstart', (e) => {
      let annotation = {
        itemId: window.itemId,
        text: this.state.selection.text,
        position: this.state.selection.position
      };
      
      // Todo: Move this out from here
      let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
      if (pageLabels && pageLabels[annotation.position.pageIndex]) {
        annotation.page = pageLabels[annotation.position.pageIndex];
      }
      else {
        annotation.page = annotation.position.pageIndex + 1;
      }
      
      e.dataTransfer.setData('zotero/annotation', JSON.stringify({
        ...annotation,
        position: this.v2p(annotation.position)
      }));
      e.dataTransfer.setData('text/plain', JSON.stringify({ ...annotation, position: this.v2p(annotation.position) }));
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
    document.removeEventListener('selectionchange', this.onSelectionChange);
    
    if (this.containerNode) {
      this.containerNode.removeEventListener(
        'textlayerrendered',
        this.onTextLayerRendered
      );
    }
  }
  
  groupAnnotationsByPage(annotations) {
    return [...annotations]
      .filter(Boolean)
      .reduce((res, annotation) => {
        let { pageIndex } = annotation.position;
        
        res[pageIndex] = res[pageIndex] || [];
        res[pageIndex].push(annotation);
        
        return res;
      }, {});
  }
  
  onTextLayerRendered = () => {
    this.setState({ initialized: true });
  };
  
  scrollTo = (position) => {
    let x = position.rects[0][0];
    let y = position.rects[0][3] + 100;
    
    this.viewer.scrollPageIntoView({
      pageNumber: position.pageIndex + 1,
      destArray: [
        null,
        { name: 'XYZ' },
        x,
        y,
        null
      ]
    });
  };
  
  onDocumentReady = () => {
    let { scrollRef } = this.props;
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
    let selection = window.getSelection();
    
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
    
    let page = getPageFromRange(range);
    if (!page) {
      return null;
    }
    let rects = getClientRects(range, page.node);
    
    if (rects.length === 0) {
      return null;
    }
    
    let position = { rects, pageIndex: page.number - 1 };
    
    let extractedRange = await extractRange(this.v2p(position));
    if (!extractedRange) return null;
    
    extractedRange.position = this.p2v(extractedRange.position);
    
    // TODO: Unify all annotations sort index calculation
    let offset = extractedRange.offset;
    extractedRange.sortIndex = [
      position.pageIndex.toString().padStart(6, '0'),
      offset.toString().padStart(7, '0'),
      '0'.padStart(10, '0') // TODO: Fix missing dot
    ].join('|');
    
    delete extractedRange.offset;
    
    return extractedRange;
  }
  
  v2p(position) {
    let viewport = this.viewer.getPageView(position.pageIndex).viewport;
    return v2p(position, viewport);
  }
  
  p2v(position) {
    let viewport = this.viewer.getPageView(position.pageIndex).viewport;
    return p2v(position, viewport);
  }
  
  getMargins(pageIndex) {
    let pageView = window.PDFViewerApplication.pdfViewer.getPageView(pageIndex);
    let pageWidth = pageView.width;
    
    if (!pageView.textLayer || !pageView.textLayer.textDivs) {
      return [0, pageWidth];
    }
    
    let data = pageView.textLayer.textDivs
      .map(x => parseFloat(x.style.left))
      .filter(x => x)
      .sort((a, b) => a - b);
    
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
      blink,
      onSelection,
      onChange,
      onDelete,
      onHighlight,
      onClickTags,
      onClickMarginNote
    } = this.props;
    
    if (!this.viewer || !this.viewer.pdfDocument || !this.state.initialized) return null;
    
    let annotationsByPage = this.groupAnnotationsByPage(annotations);
    let annotationsByPagePrev = this.groupAnnotationsByPage(this.props.annotations);
    
    let pageLayers = [];
    for (let pageIndex = 0; pageIndex <= this.viewer.pdfDocument.numPages; pageIndex++) {
      if (!annotationsByPage[String(pageIndex)] && !annotationsByPagePrev[String(pageIndex)]) continue;
      
      let view = this.viewer.getPageView(pageIndex);
      
      let margins = this.getMargins(pageIndex);
      let pageWidth = window.PDFViewerApplication.pdfViewer.getPageView(pageIndex).width;
      
      pageLayers.push(
        <PageLayerHighlight
          key={'h_' + pageIndex}
          view={view}
          activeAnnotationId={activeAnnotationId}
          annotations={(annotationsByPage[String(pageIndex)].filter(x => x.type === 'highlight') || [])}
        />,
        <PageLayerNote
          key={'n_' + pageIndex}
          view={view}
          activeAnnotationId={activeAnnotationId}
          enableInactiveDragging={enableInactiveTextDragging}
          annotations={(annotationsByPage[String(pageIndex)].filter(x => x.type === 'note') || [])}
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
        <PageLayerArea
          key={'a_' + pageIndex}
          view={view}
          activeAnnotationId={activeAnnotationId}
          annotations={(annotationsByPage[String(pageIndex)].filter(x => x.type === 'area') || [])}
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
          key={'m_' + pageIndex}
          view={view}
          activeAnnotationId={activeAnnotationId}
          annotations={(annotationsByPage[String(pageIndex)].filter(x => ['highlight', 'area'].includes(x.type)) || [])}
          marginLeft={margins[0]}
          marginRight={margins[1]}
          pageWidth={pageWidth}
          onClick={onClickMarginNote}
        />
      );
    }
    
    if (popupAnnotation) {
      let { position, ...rest } = popupAnnotation;
      popupAnnotation = {
        position: this.p2v(position),
        ...rest
      };
    }
    
    let blinkLayer = null;
    if (blink) {
      let view = this.viewer.getPageView(blink.position.pageIndex);
      let id = blink.id;
      let position = this.p2v(blink.position);
      blinkLayer = <BlinkLayer view={view} id={id} position={position}/>
    }
    
    return (
      <React.Fragment>
        {blinkLayer}
        <AreaSelectorLayer
          color={color}
          enableAreaSelector={enableAreaSelector}
          onSelection={(position) => {
            onSelection(this.v2p(position));
          }}
        />
        {
          popupAnnotation && !this.state.dragging && !window.PDFViewerApplication.pdfSidebar.isOpen ? (
            <PagePopup
              className="annotation-preview-popup"
              position={popupAnnotation.position}
            >
              <AnnotationPreview
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
                  event.dataTransfer.setData('zotero/annotation', JSON.stringify({
                    ...annotation,
                    position: this.v2p(annotation.position)
                  }));
                  event.dataTransfer.setData('text/plain', formatAnnotationText(annotation));
                }}
              />
            
            </PagePopup>
          ) : null
        }
        {
          this.state.selection && this.props.enableMouseSelection && (
            <PagePopup position={this.state.selection.position}>
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
            </PagePopup>
          )
        }
        {pageLayers}
      </React.Fragment>
    );
  }
}

export default Layer;
