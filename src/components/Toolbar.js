import React from "react";
import ReactDom from "react-dom";

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
          style={{ color: color }}
          onClick={onColorClick}
        />
        <button
          className={`toolbarButton highlight ${active === "highlight" ? `active` : ``}`}
          onClick={() => {
            onMode("highlight");
          }} />
        <button
          className={`toolbarButton note ${active === "text" ? `active` : ``}`}

          onClick={() => {
            onMode("text");
          }} />
        <button
          className={`toolbarButton area ${active === "square" ? `active` : ``}`}
          onClick={() => {
            onMode("square");
          }} />
      </React.Fragment>,
      containerNode
    );
  }
}

export default Toolbar;
