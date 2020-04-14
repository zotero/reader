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
    activeAnnotationId: null,
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
        this.setState({ activeAnnotationId: null });
      }
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

    return selectedId;
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
          activeAnnotationId={this.state.activeAnnotationId}
          onSelectAnnotation={(id) => {
            this.setState({ activeAnnotationId: id });
            this.scrollViewerTo(this.state.annotations.find(x => x.id === id).position);
          }}
          onChange={(annotation) => {
            onUpdateAnnotation(annotation);
            this.setState({ recentlyUpdatedAnnotationId: annotation.id });
          }}
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
            if (!this.getAnnotationsAtPoint(position).length) {
              this.setState({ activeAnnotationId: null });
            }
          }}
          onPointerUp={(position, isRight, x, y) => {
            // console.log(position);
            let selectedId = this.inClick(position);
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
            this.setState({ isLastClickRight: isRight });
            if (selectedId && isRight) {
              let selectedColor = this.state.annotations.find(x => x.id === selectedId).color;
              this.props.onPopup('annotationPopup', {
                x,
                y,
                annotationId: selectedId,
                selectedColor
              });
            }
          }}
          onMouseMove={(position) => {
            // console.log('pp',position);
            if (this.isOver(position)) {
              document.getElementById('viewer').classList.add('force-annotation-pointer');
            }
            else {
              document.getElementById('viewer').classList.remove('force-annotation-pointer');
            }
          }}
          onClickTags={onClickTags}
          onClickMarginNote={annotationId => {
            this.setState({ activeAnnotationId: annotationId });
          }}
          popupAnnotation={ !this.state.isLastClickRight && !window.PDFViewerApplication.pdfSidebar.isOpen && this.state.activeAnnotationId ? this.state.annotations.find(x => x.id === this.state.activeAnnotationId) : null}
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
