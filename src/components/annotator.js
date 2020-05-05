'use strict';

import React from 'react';
import Layer from './layer';
import AnnotationsView from './annotations-view';
import Toolbar from './toolbar';
import Findbar from './findbar';
import ContextMenu from './context-menu';
import ImportBar from './import-bar';
import { annotationColors } from '../lib/colors';
import cx from 'classnames';


// All rects in annotator.js are stored in [left, top, right, bottom] order
// where the Y axis starts from the bottom:
// [231.284, 402.126, 293.107, 410.142]

class Annotator extends React.Component {
  state = {
    selectedAnnotationIds: [],
    recentlyCreatedAnnotationId: null,
    recentlyUpdatedAnnotationId: null,
    mode: null,
    color: annotationColors[0][1],
    annotations: [],
    isLastClickRight: false
  };

  initKeyboard() {
    window.addEventListener('keydown', e => {
      let viewerContainer = document.getElementById('viewerContainer');
      let annotationsView = document.getElementById('annotationsView');
      if (e.target === viewerContainer || e.target === annotationsView) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          this.props.onDeleteAnnotation(this.state.activeAnnotationId);
        }
        else if (e.key === 'ArrowUp') {
          if (this.state.activeAnnotationId) {
            let currentIndex = this.state.annotations.indexOf(
              this.state.annotations.find(x => x.id === this.state.activeAnnotationId));

            if (currentIndex > 0) {
              let annotation = this.state.annotations[currentIndex - 1];
              this.setState({ activeAnnotationId: annotation.id });
              this.scrollViewerTo(annotation.position);
            }
            e.preventDefault();
          }
        }
        else if (e.key === 'ArrowDown') {
          if (this.state.activeAnnotationId) {
            let currentIndex = this.state.annotations.indexOf(
              this.state.annotations.find(x => x.id === this.state.activeAnnotationId));

            if (currentIndex >= 0 && currentIndex < this.state.annotations.length - 1) {
              let annotation = this.state.annotations[currentIndex + 1];
              this.setState({ activeAnnotationId: annotation.id });
              this.scrollViewerTo(annotation.position);
            }
            e.preventDefault();
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
      this.setState({ selectedAnnotationIds: [annotation.id] });
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

  setColor = (color) => {
    this.setState({ color });
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
    this.props.setColorRef(this.setColor);
    importableAnnotationsNumRef(this.setImportableAnnotationsNum);

    document.addEventListener('click', (e) => {
      if (
        !e.target.closest('.context-menu') &&
        !e.target.closest('.toolbarButton') &&
        !e.target.closest('.page') &&
        !e.target.closest('.more')
      ) {
        this.setState({ contextMenu: null });
      }
    });

    document.getElementById('viewer').addEventListener('pointerdown', (event) => {
      if (event.target === document.getElementById('viewer')) {
        // this.setState({ selectedAnnotationIds: [] });
      }
    });

    document.getElementById('viewer').addEventListener('pointerup', (event) => {
          let selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
          if (!!selection && selection.isCollapsed) selection.empty ? selection.empty() : selection.removeAllRanges();
    });

    window.PDFViewerApplication.eventBus.on('sidebarviewchanged', (e) => {
      // Delay until sidebar finishes transitioning
      // and allows us to properly position page popup
      if (e.view === 0) {
        setTimeout(() => {
          this.setState({});
        }, 300);
      }
      else {
        this.setState({});
      }
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

        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
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
    this.setState({ selectedAnnotationIds: [] });
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

  getAnnotationToSelectId(position, hasModifier) {
    if (this.state.recentlyUpdatedAnnotationId) {
      this.setState({ selectedAnnotationIds: [this.state.recentlyUpdatedAnnotationId] });
      return;
    }

    if (this.state.recentlyCreatedAnnotationId) {
      let annotation = this.state.annotations.find(x => x.id === this.state.recentlyCreatedAnnotationId);
      if (annotation && annotation.type !== 'note') {
        return;
      }
    }

    // if (this.hasSelectedText()) {
    //   this.setState({ selectedAnnotationIds: [] });
    //   return;
    // }

    let hl = this.state.annotations.find(x => this.state.selectedAnnotationIds.includes(x.id) );
    if (!hl) hl = {};

    let found = [];
    let x = position.rects[0][0];
    let y = position.rects[0][1];

    for (let annotation of this.state.annotations) {
      let isFound = false;
      for (let rect of annotation.position.rects) {
        if (annotation.position.pageIndex === position.pageIndex && rect[0] <= x && x <= rect[2] &&
          rect[1] <= y && y <= rect[3]) {
          found.push(annotation);
          isFound = true;
          break;
        }
      }

      if (isFound) continue;

      for (let i = 0; i < annotation.position.rects.length - 1; i++) {
        let rect = annotation.position.rects[i];
        let rectNext = annotation.position.rects[i + 1];

        if (annotation.position.pageIndex === position.pageIndex) {
          if (Math.max(rect[0], rectNext[0]) <= x && x <= Math.min(rect[2], rectNext[2]) &&
            rectNext[1] <= y && y <= rect[3] &&
            rect[3] - rect[1] >= rect[1] - rectNext[3] &&
            rectNext[3] - rectNext[1] >= rect[1] - rectNext[3]
          ) {
            found.push(annotation);
            break;
          }
        }
      }
    }

    let selectedId = null;

    if (!found.length) return;


    function getAnnotationAreaSize(annotation) {
      let areaSize = 0;
      for (let rect of annotation.position.rects) {
        areaSize += (rect[2]-rect[0]) * (rect[3] - rect[1]);
      }
      return areaSize;
    }

    found.sort((a, b) => {
      return getAnnotationAreaSize(a) - getAnnotationAreaSize(b);
    });

    if (hasModifier) {
      return found[0].id;
    }

    let indexOfCurrentId = found.indexOf(found.find(annotation => this.state.selectedAnnotationIds.slice(-1)[0] === annotation.id));

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

    return selectedId;
  }

  selectAnnotation(id, ctrl, shift) {
    let selectedIds = this.state.selectedAnnotationIds;
    if (shift && selectedIds.length) {
      let annotationIndex = this.state.annotations.findIndex(x => x.id === id);
      let lastSelectedIndex = this.state.annotations.findIndex(x => x.id === selectedIds.slice(-1)[0]);
      let selectedIndices = selectedIds.map(id => this.state.annotations.findIndex(annotation => annotation.id === id));
      let minSelectedIndex = Math.min(...selectedIndices);
      let maxSelectedIndex = Math.max(...selectedIndices);
      if (annotationIndex < minSelectedIndex) {
        for (let i = annotationIndex; i < minSelectedIndex; i++) {
          selectedIds.push(this.state.annotations[i].id);
        }
      }
      else if (annotationIndex > maxSelectedIndex) {
        for (let i = maxSelectedIndex; i <= annotationIndex; i++) {
          selectedIds.push(this.state.annotations[i].id);
        }
      }
      else {
        for (let i = Math.min(annotationIndex, lastSelectedIndex); i <= Math.max(annotationIndex, lastSelectedIndex); i++) {
          if (i === lastSelectedIndex) continue;
          selectedIds.push(this.state.annotations[i].id);
        }
      }
    }
    else if (ctrl && selectedIds.length) {
      let existingIndex = selectedIds.indexOf(id)
      if (existingIndex >= 0) {
        selectedIds.splice(existingIndex, 1);
      }
      else {
        selectedIds.push(id);
      }
    }
    else {
      selectedIds = [id];
    }

    this.setState({ selectedAnnotationIds: selectedIds });
  }

  isOver(position) {
    let found = [];
    let x = position.rects[0][0];
    let y = position.rects[0][1];

    for (let annotation of this.state.annotations) {
      for (let rect of annotation.position.rects) {
        if (annotation.position.pageIndex === position.pageIndex && rect[0] <= x && x <= rect[2] &&
          rect[1] <= y && y <= rect[3]) {
          return true;
        }
      }

      for (let i = 0; i < annotation.position.rects.length - 1; i++) {
        let rect = annotation.position.rects[i];
        let rectNext = annotation.position.rects[i + 1];

        if (annotation.position.pageIndex === position.pageIndex) {
          if (Math.max(rect[0], rectNext[0]) <= x && x <= Math.min(rect[2], rectNext[2]) &&
            rectNext[1] <= y && y <= rect[3] &&
            rect[3] - rect[1] >= rect[1] - rectNext[3] &&
            rectNext[3] - rectNext[1] >= rect[1] - rectNext[3]
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  handleDragStart = (event) => {
    // annotation.itemId = window.itemId;
    event.dataTransfer.setData('zotero/annotation', JSON.stringify(this.state.selectedAnnotationIds));
    event.dataTransfer.setData('text/plain', JSON.stringify(this.state.selectedAnnotationIds));
    var img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    event.dataTransfer.setDragImage(img, 0, 0);
  }

  render() {
    let {
      askImport, onImport, onDismissImport,
      onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation, onClickTags
    } = this.props;
    let { annotations } = this.state;

    return (
      <div>
        <Toolbar
          active={this.state.mode}
          onMode={(mode) => {
            this.toggleMode(mode);
          }}
          color={this.state.color}
          onColorPick={(x, y) => {
            this.props.onPopup("colorPopup", {
              x,
              y,
              selectedColor: this.state.color,
            });
          }}
        />
        <Findbar/>
        {this.state.contextMenu && this.state.contextMenu.type === 'globalColorMenu' && (
          <ContextMenu className="global-color-menu" x={this.state.contextMenu.x} y={this.state.contextMenu.y}>
            {annotationColors.map((color, index) => {
              return <div className="item" key={index} onClick={() => {
                this.setState({ color: color[1], contextMenu: null });
              }}>
                <div className={cx('check-box', { checked: color[1] === this.state.color })}/>
                <div className="color" style={{ backgroundColor: color[1] }}/>
                <div className="label">{color[0]}</div>
              </div>
            })}
          </ContextMenu>
        )}
        {this.state.contextMenu && this.state.contextMenu.type === 'moreMenu' && (
          <ContextMenu className="more-menu" x={this.state.contextMenu.x} y={this.state.contextMenu.y}>
            <div className="item delete" onClick={() => {
              this.props.onDeleteAnnotation(this.state.contextMenu.annotationId);
              this.setState({ contextMenu: null });
            }}>Delete
            </div>
            <hr/>
            {annotationColors.map((color, index) => {
              return <div className="item" key={index} onClick={() => {
                onUpdateAnnotation({
                  id: this.state.contextMenu.annotationId,
                  color: color[1]
                });
                this.setState({ contextMenu: null });
              }}>
                <div
                  className={cx('check-box', { checked: color[1] === this.state.annotations.find(x => x.id === this.state.contextMenu.annotationId).color })}/>
                <div className="color" style={{ backgroundColor: color[1] }}/>
                <div className="label">{color[0]}</div>
              </div>
            })}
          </ContextMenu>
        )}
        {this.state.contextMenu && this.state.contextMenu.type === 'pageMenu' && (
          <ContextMenu className="pageMenu" x={this.state.contextMenu.x} y={this.state.contextMenu.y}>
            <div className="item" onClick={() => {
              this.setState({ contextMenu: null })
            }}>Update this
            </div>
            <div className="item" onClick={() => {
              this.setState({ contextMenu: null })
            }}>Update all
            </div>
          </ContextMenu>
        )}
        {askImport && <ImportBar onImport={onImport} onDismiss={onDismissImport}/>}
        <AnnotationsView
          annotations={this.state.annotations}
          selectedAnnotationIds={this.state.selectedAnnotationIds}
          onSelectAnnotation={(id, ctrl, shift) => {
            if (ctrl) {
              let selectedIds = this.state.selectedAnnotationIds;
              if (!selectedIds.includes(id)) {
                selectedIds.push(id);
              }
              this.setState({ selectedAnnotationIds: selectedIds });
            }
            else {
              this.setState({ selectedAnnotationIds: [id] });
            }

            this.scrollViewerTo(this.state.annotations.find(x => x.id === id).position);
          }}
          onChange={(annotation) => {
            onUpdateAnnotation(annotation);
            this.setState({ recentlyUpdatedAnnotationId: annotation.id });
          }}
          onDragStart={this.handleDragStart}
          onResetPageLabels={this.props.onResetPageLabels}
          onDelete={(id) => {
            onDeleteAnnotation(id);
          }}
          onClickTags={onClickTags}
          onImport={onImport}
          onPageMenu={(id, x, y) => {
            this.setState({
              contextMenu: {
                type: 'pageMenu',
                annotationId: id,
                x,
                y
              }
            });
          }}
          onMoreMenu={(id, x, y) => {
            // this.setState({
            //   contextMenu: {
            //     type: 'moreMenu',
            //     annotationId: id,
            //     x,
            //     y
            //   }
            // });

            let selectedColor = this.state.annotations.find(x => x.id === id).color;

            this.props.onPopup('annotationPopup', {
              x,
              y,
              annotationId: id,
              selectedColor
            });
          }}
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
          enableAreaSelector={this.state.mode === 'area' && !this.state.selectedAnnotationIds.length}
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
          onPageMenu={(id, x, y) => {
            this.setState({
              contextMenu: {
                type: 'pageMenu',
                annotationId: id,
                x,
                y
              }
            });
          }}
          onMoreMenu={(id, x, y) => {
            // this.setState({
            //   contextMenu: {
            //     type: 'moreMenu',
            //     annotationId: id,
            //     x,
            //     y
            //   }
            // });

            let selectedColor = this.state.annotations.find(x => x.id === id).color;

            this.props.onPopup("annotationPopup", {
              x,
              y,
              annotationId: id,
              selectedColor,
            });
          }}
          onDelete={(id) => {
            onDeleteAnnotation(id);
          }}
          onPointerDown={(position) => {
            this.setState({
              recentlyCreatedAnnotationId: null,
              recentlyUpdatedAnnotationId: null
            });
            // if (!this.getAnnotationsAtPoint(position).length) {
            //   this.setState({ selectedAnnotationIds: [] });
            // }
          }}
          onPointerUp={(position, isRight, isCtrl, isShift, x, y, event) => {
            let selectId = this.getAnnotationToSelectId(position, isCtrl || isShift);

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
              this.setState({ selectedAnnotationIds: [annotation.id] });
              this.setState({ mode: null });
            }
            this.setState({ isLastClickRight: isRight });
            if (selectId) {

              this.selectAnnotation(selectId, isCtrl, isShift);

              if (isRight) {
                let selectedColor = this.state.annotations.find(x => x.id === selectId).color;
                this.props.onPopup('annotationPopup', {
                  x,
                  y,
                  annotationId: selectId,
                  selectedColor
                });
              }
            } else {
              this.setState({ selectedAnnotationIds: [] });
            }
          }}
          onMouseMove={(position) => {
            if (this.isOver(position)) {
              document.getElementById('viewer').classList.add('force-annotation-pointer');
            }
            else {
              document.getElementById('viewer').classList.remove('force-annotation-pointer');
            }
          }}
          onClickTags={onClickTags}
          onClickMarginNote={annotationId => {
            this.setState({ selectedAnnotationIds: [annotationId] });
          }}
          popupAnnotation={ this.state.selectedAnnotationIds.length < 2 && !this.state.isLastClickRight && !window.PDFViewerApplication.pdfSidebar.isOpen && this.state.selectedAnnotationIds.length ? this.state.annotations.find(x => this.state.selectedAnnotationIds.includes(x.id)) : null}
          popupSelection={this.state.selection ? { position: this.state.selection.position } : null}
          selectedAnnotationIds={this.state.selectedAnnotationIds}
          annotations={annotations}
          color={this.state.color}
          onDragStart={this.handleDragStart}
        >
        </Layer>
      </div>
    );
  }
}

export default Annotator;
