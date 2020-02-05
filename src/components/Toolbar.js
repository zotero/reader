import React from "react";
import ReactDom from "react-dom";

import "../style/Toolbar.css";

class Toolbar extends React.Component {
  getContainerNode() {
    return document.getElementById("toolbarViewerMiddle");
  }
  
  render() {
    const { active, onMode, color, onColorClick } = this.props;
    let containerNode = this.getContainerNode();
    return ReactDom.createPortal(
      <React.Fragment>
        <button
          id="globalColorButton"
          className="toolbarButton"
          style={{ backgroundColor: color }}
          onClick={onColorClick}
        />
        <button
          className={`toolbarButton ${active === "highlight" ? `active` : ``}`}
          onClick={() => {
            onMode("highlight");
          }}>H
        </button>
        <button
          className={`toolbarButton ${active === "text" ? `active` : ``}`}
          onClick={() => {
            onMode("text");
          }}>N
        </button>
        <button
          className={`toolbarButton ${active === "square" ? `active` : ``}`}
          onClick={() => {
            onMode("square");
          }}>A
        </button>
      </React.Fragment>,
      containerNode
    );
  }
}

export default Toolbar;
