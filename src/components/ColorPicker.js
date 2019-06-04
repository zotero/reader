import React from "react";

import { annotationColors } from "../lib/colors";

import "../style/ColorPicker.css";

class ColorPicker extends React.Component {
  
  render() {
    const { onColorPick } = this.props;
    
    return (
      <div className="ColorPicker">{
        annotationColors.map((color, index) => {
          return <div
            key={index}
            style={{ backgroundColor: color }}
            onClick={() => {
              onColorPick(color);
            }}
          ></div>;
        })
      }</div>
    );
  }
}

export default ColorPicker;
