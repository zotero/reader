import React from "react";
import { Rnd } from "react-rnd";

import { wx, hy } from "../lib/coordinates";

import "../style/Square.css";

class Square extends React.Component {
  state = {
    changed: false,
    dragged: false,
    resized: false
  };
  
  render() {
    const {
      annotation,
      active,
      onChangePosition
    } = this.props;
    
    return (
      <Rnd
        className={`Square ${active ? "Square-active" : ""} ${annotation.comment ? "Square-comment" : ""}`}
        style={{ backgroundColor: annotation.color }}
        onDragStart={() => {
          this.setState({ changed: true });
          this.setState({ resized: false, dragged: false });
        }}
        onDrag={() => {
          this.setState({ dragged: true });
        }}
        onDragStop={(_, data) => {
          let rect = [
            data.x,
            data.y,
            data.x + wx(annotation.position.rects[0]),
            data.y + hy(annotation.position.rects[0])
          ];
          if (this.state.dragged) {
            onChangePosition({ pageNumber: annotation.position.pageNumber, rects: [rect] });
          }
        }}
        onResizeStart={() => {
          this.setState({ changed: true });
          this.setState({ resized: false, dragged: false });
        }}
        onResize={() => {
          this.setState({ resized: true });
        }}
        onResizeStop={(_, direction, ref, delta, position) => {
          let rect = [
            position.x,
            position.y,
            position.x + ref.offsetWidth,
            position.y + ref.offsetHeight
          ];
          
          if (this.state.resized) {
            onChangePosition({ pageNumber: annotation.position.pageNumber, rects: [rect] });
          }
        }}
        bounds={"div[data-page-number=\"" + annotation.position.pageNumber + "\"] > .textLayer"}
        position={this.state.changed ? null : {
          x: annotation.position.rects[0][0],
          y: annotation.position.rects[0][1]
        }}
        size={{
          width: wx(annotation.position.rects[0]),
          height: hy(annotation.position.rects[0])
        }}
      />
    );
  }
}

export default Square;
