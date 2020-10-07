'use strict';

import React from 'react';
import { annotationColors } from '../lib/colors';

class SelectionMenu extends React.Component {
  handleColorPick = (color) => {
    this.props.onHighlight(color)
  }

  handleAddToNote = (event) => {

  }

  render() {
    return (
      <div className="selection-menu">
        <div className="colors">
          {annotationColors.map((color, index) => (<button
            key={index}
            className="toolbarButton global-color"
            style={{ color: color[1] }}
            onClick={() => this.handleColorPick(color[1])}
          />))}
        </div>
        <div className="wide-button" onClick={this.props.onAddToNote}>Add to Note</div>
      </div>
    );
  }
}

export default SelectionMenu;
