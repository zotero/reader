'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class ScreenPopup extends React.Component {
  state = {
    popupPosition: null
  };
  
  componentDidMount() {
    this.updatePopupPosition();
  }
  
  componentDidUpdate() {
    if (!this.state.popupPosition) {
      this.updatePopupPosition();
    }
  }
  
  static getDerivedStateFromProps(nextProps, prevState) {
    // Trigger popup re-positioning only if another popup
    // with a different class name is being opened
    if (nextProps.className !== prevState.className) {
      return { className: nextProps.className, popupPosition: null };
    }
    return null;
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
  
  updatePopupPosition() {
    let node = document.getElementById(this.props.parentId);
    if (!node) return;
    let rect = node.getBoundingClientRect();
    let top = rect.y + rect.height + 10;
    let left = rect.x + rect.width / 2 - this.refs.container.offsetWidth / 2;
    this.setState({ popupPosition: { top, left } });
  }
  
  render() {
    return ReactDOM.createPortal(
      <div
        ref="container"
        className={'screen-popup ' + this.props.className}
        style={this.state.popupPosition && { ...this.state.popupPosition }}>
        {this.props.children}
      </div>,
      this.getContainer()
    );
  }
}

export default ScreenPopup;
