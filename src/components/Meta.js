'use strict';

import React from 'react';
import ColorPicker from './ColorPicker';
import Editor from './Editor';

class Meta extends React.Component {
  state = {
    showing: 'main'
  };
  
  componentDidMount() {
    // if (!this.props.annotation.comment) {
    //   setTimeout(() => {
    //     this.refs.textarea.focus();
    //   }, 0);
    // }
  }
  
  render() {
    const { annotation, onColorChange, onChange, onDelete, onClick, active, onUpdate, onClickTags, isLayer, onDragStart } = this.props;
    const { showing } = this.state;
    let content = null;
    if (showing === 'main') {
      content = (
        <React.Fragment>
          <div
            className="Meta__toolbar__color"
            style={{ backgroundColor: annotation.color }}
            draggable={true}
            onDragStart={onDragStart}
          ></div>
          <div className="Meta__first_toolbar">
            <input
              type="edit"
              value={annotation.page}
              onChange={(e) => {
                onChange({ id: annotation.id, page: e.target.value });
              }}
            />
            <div>{annotation.label}</div>
            <div
              className="Meta__toolbar__settings"
              onClick={() => {
                this.setState({ showing: 'settings' });
              }}
            >
              ⚙
            </div>
          </div>
          {annotation.image && !isLayer ? (<img className="Sidebar-image" src={annotation.image}/>) : null}
          
          {annotation.type === 'highlight' ? (
            <Editor
              text={annotation.text}
              onChange={(text) => {
                onChange({ id: annotation.id, text });
              }}
              placeholder="Highlighted text.."
            />) : null}
          
          <Editor
            text={annotation.comment}
            onChange={(text) => {
              onChange({ id: annotation.id, comment: text });
            }}
            placeholder="Comment.."
          />
          <div
            className="Meta__toolbar__tags"
            onClick={(e) => {
              onClickTags(annotation.id, e.screenX, e.screenY);
            }}
          >{annotation.tags.map(tag => (
            <span style={{ color: tag.color }}>{tag.name}</span>
          ))
          }</div>
        </React.Fragment>
      );
    }
    else if (showing === 'settings') {
      content = (
        <React.Fragment>
          <div
            className="Meta__settings__back"
            onClick={() => {
              this.setState({ showing: 'main' });
            }}
          >←
          </div>
          
          <ColorPicker
            onColorPick={(color) => {
              this.setState({ showing: 'main' });
              onColorChange(color);
            }}
          />
          
          
          <div className="Meta__settings__button" onClick={onDelete}>Delete</div>
          
          <div>Author: {annotation.label}</div>
          <div>Created: {annotation.dateCreated.split('T')[0]}</div>
          <div>Modified: {annotation.dateModified.split('T')[0]}</div>
          <div>Imported: {annotation.imported ? 'yes' : 'no'}</div>
        </React.Fragment>
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
