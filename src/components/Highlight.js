'use strict';

import React from 'react';
import cx from 'classnames';

class Highlight extends React.Component {
  render() {
    let { annotation, active } = this.props;
    
    return (
      <div id={'annotation-' + annotation.id} className="Highlight">
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
        className={cx({
          'Highlight__rect': true,
          'Highlight__rect-active': active
        })}
      />
    ))}
      </div>
    );
  }
}

export default Highlight;
