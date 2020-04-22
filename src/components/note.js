'use strict';

import React, { Fragment } from 'react';
import cx from 'classnames'
import { wx, hy } from '../lib/coordinates';
import DraggableBox from './draggable-box';

const PADDING = 5;

class Note extends React.Component {
  state = {
    changed: false,
    dragged: false
  };
  
  handleDragStart = () => {
    this.setState({ dragged: false });
    this.setState({ changed: true });
  }
  handleDragStop = (_, data) => {
    let { annotation, onChangePosition } = this.props;
    let rect = [
      data.x,
      data.y,
      data.x + wx(annotation.position.rects[0]),
      data.y + hy(annotation.position.rects[0])
    ];
    
    if (this.state.dragged) {
      onChangePosition({ pageIndex: annotation.position.pageIndex, rects: [rect] });
    }
  }
  
  handleDrag = () => {
    this.setState({ dragged: true });
  }
  draggableRef = React.createRef();
  
  render() {
    let { annotation, active } = this.props;
    
    let width = 20 * PDFViewerApplication.pdfViewer._currentScale;
    let height = 20 * PDFViewerApplication.pdfViewer._currentScale;
    
    let rect = annotation.position.rects[0];
    
    // disableDragging={!enableInactiveDragging && !active || annotation.readOnly}
    return (
      <Fragment>
        <div
          className={cx('note-annotation', { active })}
          style={{
            backgroundColor: annotation.color,
            left: Math.round(annotation.position.rects[0][0]),
            top: Math.round(annotation.position.rects[0][1]),
            width: width,
            height: height
          }}
        >
          <div
            ref={this.draggableRef}
            className="square"
            style={{
              left: -PADDING,
              top: -PADDING,
              width: width + PADDING * 2,
              height: height + PADDING * 2
            }}
            draggable={true}
          />
        
        </div>
        
        <DraggableBox
          draggableRef={this.draggableRef}
          pageIndex={this.props.annotation.position.pageIndex}
          onDragStart={this.props.onDragStart}
          onDragEnd={this.props.onDragEnd}
          onMove={(rect) => {
            let left = rect[0] + PADDING;
            let top = rect[1] + PADDING;
            rect = [left, top, left + width, top + height];
            this.props.onChangePosition({ ...annotation.position, rects: [rect] });
          }}
        >
          {this.props.move && <div
            style={{
              border: '2px dashed gray',
              width: width + PADDING * 2,
              height: height + PADDING * 2
            }}
          />}
        </DraggableBox>
      </Fragment>
    );
  }
}

export default Note;
