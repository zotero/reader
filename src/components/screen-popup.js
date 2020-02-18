'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class ScreenPopup extends React.Component {
  state = {
    dimensions: null
  };
  
  componentDidMount() {
    this.setState({
      dimensions: {
        width: this.container.offsetWidth,
        height: this.container.offsetHeight
      }
    });
  }
  
  getContainer() {
    let popupContainer = document.getElementById('popupScreenContainer');
    if (!popupContainer) {
      let viewerContainer = document.getElementById('mainContainer');
      if (!viewerContainer) return;
      popupContainer = document.createElement('div');
      popupContainer.className = 'screen-popup-container';
      popupContainer.id = 'popupScreenContainer';
      viewerContainer.insertBefore(popupContainer, viewerContainer.firstChild);
    }
    return popupContainer;
  }
  
  getPosition(parentId) {
    let node = document.getElementById(parentId);
    if (!node) return null;
    let rect = node.getBoundingClientRect();
    let top = rect.y + rect.height + 10;
    let left = rect.x;
    return { top, left };
  }
  
  render() {
    let { children, parentId, className } = this.props;
    let { dimensions } = this.state;
    
    return ReactDOM.createPortal(
      <div
        ref={el => (this.container = el)}
        className={'screen-popup ' + className}
        style={dimensions ? this.getPosition(parentId, dimensions) : {}}>
        {children}
      </div>,
      this.getContainer()
    );
  }
}

export default ScreenPopup;
