'use strict';

import React from 'react';
import { Rnd } from 'react-rnd';
import cx from 'classnames'
import { wx, hy } from '../lib/coordinates';

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
  
  render() {
    let {
      annotation, active,
      enableInactiveDragging, onChangePosition
    } = this.props;
    
    let bounds = `div[data-page-number="${(annotation.position.pageIndex + 1)}"] > .textLayer`;
    
    let position = this.state.changed ? null : {
      x: annotation.position.rects[0][0],
      y: annotation.position.rects[0][1]
    }
    
    let size = {
      width: wx(annotation.position.rects[0]),
      height: hy(annotation.position.rects[0])
    }
    
    return (
      <Rnd
        className={cx({ 'Note': true, 'Note-active': active })}
        style={{ backgroundColor: annotation.color }}
        disableDragging={!(enableInactiveDragging || active)}
        enableResizing={false}
        onDragStart={this.handleDragStart}
        onDragStop={this.handleDragStop}
        onDrag={this.handleDrag}
        bounds={bounds}
        position={position}
        size={size}
      />
    );
  }
}

export default Note;
