import React, { Component } from "react";

class Highlight extends Component {
  render() {
    const { annotation, active } = this.props;
    return (
      <div className="Highlight" id={'annotation-'+annotation.id}>
        {annotation.position.rects.map((rect, index) => (
          <div
            key={index}
            style={{
              left: rect[0],
              top: rect[1],
              width: rect[2] - rect[0],
              height: rect[3] - rect[1],
              backgroundColor: annotation.color
            }}
            className={`Highlight__rect ${active ? "Highlight__rect-active" : ""} ${(annotation.comment && index === 0) ? "Highlight__rect-comment" : ""}`}
          />
        ))}
      </div>
    );
  }
}

export default Highlight;
