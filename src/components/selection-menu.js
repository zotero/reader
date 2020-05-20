'use strict';

import React from 'react';

class SelectionMenu extends React.Component {
  handleColorPick = (event) => {
    this.props.onColorPick(event.screenX, event.screenY)
  }

  render() {
    let { onCopy, onHighlight, color } = this.props;
    return (
      <div className="selection-menu">
        <button className="toolbarButton btn-copy" onClick={onCopy} data-l10n-id="copy">
          <span data-l10n-id="copy_label">Copy</span>
        </button>
        <div className="tool-group selection-tools">
          <button className="toolbarButton btn-highlight" onClick={onHighlight} data-l10n-id="highlight">
            <span data-l10n-id="highlight_label">Highlight</span>
          </button>
          <button
            data-l10n-id='global_color'
            className="toolbarButton global-color"
            style={{ color }}
            onClick={this.handleColorPick}
          >
            <span data-l10n-id="global_color_label">Global Color</span>
            <span className="dropmarker"></span>
          </button>
        </div>
      </div>
    );
  }
}

export default SelectionMenu;
