'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class ContextMenu extends React.Component {
  
  getContainer() {
    let popupContainer = document.getElementById('popupScreenContainer');
    if (!popupContainer) {
      let viewerContainer = document.getElementById('outerContainer');
      if (!viewerContainer) return;
      popupContainer = document.createElement('div');
      popupContainer.className = 'context-menu-container';
      popupContainer.id = 'popupScreenContainer';
      viewerContainer.insertBefore(popupContainer, viewerContainer.firstChild);
    }
    return popupContainer;
  }
  
  render() {
    return ReactDOM.createPortal(
      <div
        ref="container"
        className={'context-menu ' + this.props.className}
        style={{ left: this.props.x, top: this.props.y + 10 }}>
        {this.props.children}
      </div>,
      this.getContainer()
    );
  }
}

export default ContextMenu;
