import React from "react";

import ColorPicker from "./ColorPicker";

import "../style/Meta.css";

class Meta extends React.Component {
  state = {
    showing: "main"
  };
  
  componentDidMount() {
    if (!this.props.annotation.comment) {
      setTimeout(() => {
        this.refs.textarea.focus();
      }, 0);
    }
  }
  
  render() {
    const { annotation, onColorChange, onChange, onDelete, onClick, active, onUpdate } = this.props;
    const { showing } = this.state;
    let content = null;
    if (showing === "main") {
      content = (
        <React.Fragment>
         <textarea
           ref="textarea"
           value={annotation.comment}
           onChange={(e) => {
             onUpdate(e.target.value);
           }}
           placeholder="Comment.."
         />
          <div className="Meta__toolbar">
            <button
              className="Meta__toolbar__delete"
              onClick={onDelete}
            >Delete
            </button>
            <div
              className="Meta__toolbar__color"
              style={{ backgroundColor: annotation.color }}
              onClick={() => {
                this.setState({ showing: "picker" });
              }}></div>
          </div>
        </React.Fragment>
      );
    }
    else if (showing === "picker") {
      content = (
        <ColorPicker
          onColorPick={(color) => {
            this.setState({ showing: "main" });
            onColorChange(color);
          }}
        />
      );
    }
    
    return (
      <div className="Meta">
        {content}
      </div>
    );
  }
}

export default Meta;
