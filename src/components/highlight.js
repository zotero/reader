'use strict';

import React from 'react';
import cx from 'classnames';

class Highlight extends React.Component {
  render() {
    let { annotation, active } = this.props;
    
    let rects = annotation.position.rects;
    let padding = 5;
    let squareRect = [
      Math.min(...rects.map(x => x[0])) - padding,
      Math.min(...rects.map(x => x[1])) - padding,
      Math.max(...rects.map(x => x[2])) + padding,
      Math.max(...rects.map(x => x[3])) + padding
    ];
    
    return (
      <div
        id={'annotation-' + annotation.id}
        className={cx('highlight-annotation', { active })}
      >
        <div
          className="square"
          style={{
            left: squareRect[0],
            top: squareRect[1],
            width: squareRect[2] - squareRect[0],
            height: squareRect[3] - squareRect[1]
          }}
        />
        {annotation.position.rects.map((rect, index) => (
          <div
            key={index}
            style={{
              left: rect[0],
              top: rect[1],
              width: rect[2] - rect[0],
              height: rect[3] - rect[1],
              backgroundColor: annotation.color
            }}
            className="rect"
          />
        ))}
      </div>
    );
  }
}

export default Highlight;
