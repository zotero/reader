'use strict';

import React from 'react';
import { Rnd } from 'react-rnd';
import cx from 'classnames';
import { wx, hy } from '../lib/coordinates';

class Area extends React.Component {
  state = {
    changed: false,
    dragged: false,
    resized: false
  }
  
  handleDragStart = () => {
    this.setState({
      changed: true,
      resized: false,
      dragged: false
    });
  }
  
  handleDrag = () => {
    this.setState({ dragged: true });
  }
  
  handleDragStop = (_, data) => {
    let { annotation } = this.props;
    let rect = [
      data.x,
      data.y,
      data.x + wx(annotation.position.rects[0]),
      data.y + hy(annotation.position.rects[0])
    ];
    if (this.state.dragged) {
      this.props.onChangePosition({
        pageIndex: annotation.position.pageIndex,
        rects: [rect]
      });
    }
  }
  
  handleResizeStart = () => {
    this.setState({ changed: true });
    this.setState({ resized: false, dragged: false });
  }
  
  handleResize = () => {
    this.setState({ resized: true });
  }
  
  handleResizeStop = (_, direction, ref, delta, position) => {
    let { annotation, onChangePosition } = this.props;
    
    let rect = [
      position.x,
      position.y,
      position.x + ref.offsetWidth,
      position.y + ref.offsetHeight
    ];
    
    if (this.state.resized) {
      onChangePosition({ pageIndex: annotation.position.pageIndex, rects: [rect] });
    }
  }
  
  render() {
    let { annotation, active } = this.props;
    
    let bounds = `div[data-page-number="${(annotation.position.pageIndex + 1)}"] > .textLayer`;
    
    let position = this.state.changed ? null : {
      x: Math.round(annotation.position.rects[0][0]),
      y: Math.round(annotation.position.rects[0][1])
    };
    
    let size = {
      width: wx(annotation.position.rects[0]),
      height: hy(annotation.position.rects[0])
    };
    
    return (
      <Rnd
        className={cx('area-annotation', {
          active,
          comment: !!annotation.comment
        })}
        style={{ backgroundColor: annotation.color }}
        onDragStart={this.handleDragStart}
        onDrag={this.handleDrag}
        onDragStop={this.handleDragStop}
        onResizeStart={this.handleResizeStart}
        onResize={this.handleResize}
        onResizeStop={this.handleResizeStop}
        bounds={bounds}
        position={position}
        size={size}
        disableDragging={annotation.readOnly}
        enableResizing={!annotation.readOnly && undefined}
      />
    );
  }
}

export default Area;
