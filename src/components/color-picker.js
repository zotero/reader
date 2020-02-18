'use strict';

import React from 'react';
import { annotationColors } from '../lib/colors';

class ColorPicker extends React.Component {
  
  render() {
    let { onColorPick } = this.props;
    
    return (
      <div className="color-picker">{
        annotationColors.map((color, index) => {
          return <div
            key={index}
            style={{ backgroundColor: color }}
            onClick={() => {
              onColorPick(color);
            }}
          />;
        })
      }</div>
    );
  }
}

export default ColorPicker;
