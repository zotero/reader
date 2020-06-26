'use strict';

import React from 'react';
import { annotationColors } from '../lib/colors';

class SelectionMenu extends React.Component {
  handleColorPick = (color) => {
    this.props.onHighlight(color)
  }

  render() {
    return (
      <div className="selection-menu">
        {annotationColors.map((color, index) => (<button
          key={index}
          className="toolbarButton global-color"
          style={{ color: color[1] }}
          onClick={() => this.handleColorPick(color[1])}
        />))}
      </div>
    );
  }
}

export default SelectionMenu;
