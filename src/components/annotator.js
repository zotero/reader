'use strict';

import React from 'react';
import Layer from './layer';
import Sidebar from './sidebar';
import Toolbar from './toolbar';
import PopupScreen from './screen-popup';
import ColorPicker from './color-picker';
import { annotationColors } from '../lib/colors';

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
  
  initKeyboard() {
    window.addEventListener('keydown', e => {
      let viewerContainer = document.getElementById('viewerContainer');
      let annotationsView = document.getElementById('annotationsView');
      if ([8, 46].includes(e.keyCode)) {
        if (e.target === viewerContainer || e.target === annotationsView) {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            this.props.onDeleteAnnotation(this.state.activeAnnotationId);
          }
        }
      }
    });
  }
  
  scrollViewerTo = (annotation) => {
  
  };
  
  navigate = (annotation) => {
    let existingAnnotation = this.state.annotations.find(x => x.id === annotation.id);
    if (existingAnnotation) {
      this.setState({ activeAnnotationId: annotation.id });
    }
    
    this.blink(annotation.position);
    this.scrollViewerTo(annotation.position);
  }
  
  setAnnotations = (annotations) => {
    this.setState({ annotations });
  }
  
  setImportableAnnotationsNum = (importableAnnotationsNum) => {
    this.setState({ importableAnnotationsNum });
  }
  
  blink(position) {
    this.setState({
      blink: {
        id: Math.random(),
        position: position
      }
    })
  }
  
  componentDidMount() {
    let { onInitialized, navigateRef, setAnnotationsRef, importableAnnotationsNumRef } = this.props;
    
    this.initKeyboard();
    
    navigateRef(this.navigate);
    setAnnotationsRef(this.setAnnotations);
    importableAnnotationsNumRef(this.setImportableAnnotationsNum);
    
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.screen-popup') && !e.target.closest('.toolbarButton')) {
        this.setState({ colorPicking: false });
      }
    });
    
    document.addEventListener('mousedown', (e) => {
    
    });
    
    onInitialized();
  }
  
  componentDidUpdate(prevProps, prevState) {
    if (prevState.activeAnnotationId !== this.state.activeAnnotationId) {
      setTimeout(() => {
        let el = document.querySelector(`div[data-sidebar-id="${this.state.activeAnnotationId}"]`);
        let container = document.getElementById('annotationsView');
        if (!el || !container) return;
        
        if (
          window.PDFViewerApplication.pdfSidebar.isOpen &&
          window.PDFViewerApplication.pdfSidebar.active !== 9
        ) {
          window.PDFViewerApplication.pdfSidebar.switchView(9);
        }
        
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
    let text = '';
    if (window.getSelection) {
      text = window.getSelection().toString();
    }
    else if (document.selection && document.selection.type != 'Control') {
      text = document.selection.createRange().text;
    }
    return !!text;
  }
  
  clearSelection() {
    let selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
    if (!!selection) selection.empty ? selection.empty() : selection.removeAllRanges();
  }
  
  getAnnotationsAtPoint(position) {
    let found = [];
    let x = position.rects[0][0];
    let y = position.rects[0][1];
    
    for (let annotation of this.state.annotations) {
      for (let rect of annotation.position.rects) {
        if (
          annotation.position.pageIndex === position.pageIndex &&
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
      if (annotation && annotation.type !== 'note') {
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
        if (annotation.position.pageIndex === position.pageIndex && rect[0] <= x && x <= rect[2] &&
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
    let containerTop = container.scrollTop;
    let containerBottom = containerTop + container.clientHeight;
    
    let elementTop = element.offsetTop;
    let elementBottom = elementTop + element.clientHeight;
    
    if (elementTop < containerTop) {
      container.scrollTop -= (containerTop - elementTop);
    }
    else if (elementBottom > containerBottom) {
      container.scrollTop += (elementBottom - containerBottom);
    }
  }
  
  render() {
    let { onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation, onClickTags, onImport } = this.props;
    let { annotations } = this.state;
    
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
          <PopupScreen className="global-color-picker-popup" parentId="globalColorButton">
            <ColorPicker onColorPick={(color) => {
              this.setState({ color });
              this.setState({ colorPicking: false });
            }}/>
          </PopupScreen>
        ) : null}
        <Sidebar
          importableAnnotationsNum={this.state.importableAnnotationsNum}
          annotations={this.state.annotations}
          activeAnnotationId={this.state.activeAnnotationId}
          onSelectAnnotation={(id) => {
            this.setState({ activeAnnotationId: id });
            this.scrollViewerTo(this.state.annotations.find(x => x.id === id).position);
          }}
          onChange={(annotation) => {
            onUpdateAnnotation(annotation);
            this.setState({ recentlyUpdatedAnnotationId: annotation.id });
          }}
          onDelete={(id) => {
            onDeleteAnnotation(id);
          }}
          onClickTags={onClickTags}
          onImport={onImport}
        />
        <Layer
          scrollRef={scrollTo => {
            this.scrollViewerTo = scrollTo;
          }}
          onMouseSelection={(selection) => {
            // this.setState({ selection });
            if (this.state.mode === 'highlight') {
              let annotation = onAddAnnotation({
                type: 'highlight',
                color: this.state.color,
                sortIndex: selection.sortIndex,
                position: selection.position,
                text: selection.text
              });
              
              this.setState({ recentlyCreatedAnnotationId: annotation.id });
              this.clearSelection();
            }
          }}
          onHighlight={(selection) => {
            let annotation = onAddAnnotation({
              type: 'highlight',
              color: this.state.color,
              sortIndex: selection.sortIndex,
              position: selection.position,
              text: selection.text
            });
            
            this.setState({ recentlyCreatedAnnotationId: annotation.id });
            this.clearSelection();
          }}
          enableAreaSelector={this.state.mode === 'area' && !this.state.activeAnnotationId}
          enableMouseSelection={!this.state.mode}
          enableInactiveTextDragging={this.state.mode !== 'area'}
          blink={this.state.blink}
          onSelection={(position) => {
            let annotation = onAddAnnotation({
              type: 'area',
              color: this.state.color,
              position: position
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
            if (this.state.mode === 'note') {
              position.rects[0][0] -= 10;
              position.rects[0][1] -= 10;
              position.rects[0][2] += 10;
              position.rects[0][3] += 10;
              let annotation = onAddAnnotation({
                type: 'note',
                position: position,
                color: this.state.color
              });
              this.setState({ recentlyCreatedAnnotationId: annotation.id });
              this.setState({ activeAnnotationId: annotation.id });
              this.setState({ mode: null });
            }
          }}
          onClickTags={onClickTags}
          onClickMarginNote={annotationId => {
            this.setState({ activeAnnotationId: annotationId });
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
