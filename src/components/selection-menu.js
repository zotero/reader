'use strict';

import React from 'react';

class SelectionMenu extends React.Component {
  render() {
    let { onCopy, onHighlight } = this.props;
    return (
      <div className="selection-menu">
        <button className="toolbarButton btn-copy" onClick={onCopy} data-l10n-id="copy">
          <span data-l10n-id="copy_label">Copy</span>
        </button>
        <button className="toolbarButton btn-highlight" onClick={onHighlight} data-l10n-id="highlight">
          <span data-l10n-id="highlight_label">Highlight</span>
        </button>
      </div>
    );
  }
}

export default SelectionMenu;
