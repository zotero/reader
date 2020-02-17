'use strict';

import React from 'react';

class SelectionMenu extends React.Component {
  render() {
    let { onCopy, onHighlight } = this.props;
    return (
      <div className="SelectionMenu">
        <button onClick={onCopy}>Copy</button>
        <button onClick={onHighlight}>Highlight</button>
      </div>
    );
  }
}

export default SelectionMenu;
