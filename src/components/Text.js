import React from "react";
import { Rnd } from "react-rnd";

import { wx, hy } from "../lib/coordinates";

class Text extends React.Component {
  state = {
    changed: false,
    dragged: false
  };
  
  render() {
    const {
      annotation,
      active,
      enableInactiveDragging,
      onChangePosition
    } = this.props;
    
    return (
      <Rnd
        className={`Text ${active ? "Text-active" : ""}`}
        style={{ backgroundColor: annotation.color }}
        disableDragging={!(enableInactiveDragging || active)}
        enableResizing={false}
        onDragStart={() => {
          this.setState({ dragged: false });
          this.setState({ changed: true });
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
        onDrag={() => {
          this.setState({ dragged: true });
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

export default Text;
