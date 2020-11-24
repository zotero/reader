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
        {this.props.enableAddToNote[0] && !this.props.enableAddToNote[1] &&
        <div className="wide-button" onClick={() => {
          this.props.onAddToNote(0)
        }}>Add to Note</div>
        || !this.props.enableAddToNote[0] && this.props.enableAddToNote[1] &&
        <div className="wide-button" onClick={() => {
          this.props.onAddToNote(1)
        }}>Add to Note</div>
        || this.props.enableAddToNote[0] && [<div key="1" className="wide-button" onClick={() => {
          this.props.onAddToNote(0)
        }}>Add to Top Note</div>,
          <div key="2" className="wide-button" onClick={() => {
            this.props.onAddToNote(1)
          }}>Add to Bottom Note</div>]
        }
      </div>
    );
  }
}

export default SelectionMenu;
