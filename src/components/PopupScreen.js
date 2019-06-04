import React from "react";
import ReactDom from "react-dom";

import "../style/PopupScreen.css";

class PopupScreen extends React.Component {
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
  
  getPosition(parentId) {
    let node = document.getElementById(parentId);
    if (!node) return null;
    let rect = node.getBoundingClientRect();
    let top = rect.y + rect.height + 10;
    let left = rect.x;
    return { top, left };
  }
  
  render() {
    const { children, parentId, className } = this.props;
    const { dimensions } = this.state;
    
    let popupContainer = document.getElementById("popupScreenContainer");
    if (!popupContainer) {
      let viewerContainer = document.getElementById("mainContainer");
      if (!viewerContainer) return;
      popupContainer = document.createElement("div");
      popupContainer.className = "PopupScreenContainer";
      popupContainer.id = "popupScreenContainer";
      viewerContainer.insertBefore(popupContainer, viewerContainer.firstChild);
    }
    
    return ReactDom.createPortal(
      <div
        ref={el => (this.container = el)}
        className={"PopupScreen "+className}
        style={dimensions ? this.getPosition(parentId, dimensions) : {}}>
        {children}
      </div>,
      popupContainer);
  }
}

export default PopupScreen;
