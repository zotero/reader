'use strict';

import React from 'react';
import cx from 'classnames';
import ColorPicker from './color-picker';
import Editor from './editor';

class AnnotationPreview extends React.Component {
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
  
  mainView() {
    let { annotation, isLayer, onChange, onClickTags, onDragStart } = this.props;
    return (
      <div className="main-view">
        <div
          className="color-line"
          style={{ backgroundColor: annotation.color }}
          draggable={true}
          onDragStart={onDragStart}
        ></div>
        <div className="header">
          <input
            className="page"
            type="edit"
            value={annotation.page}
            onChange={(e) => {
              onChange({ id: annotation.id, page: e.target.value });
            }}
          />
          <div>{!annotation.isOwner && annotation.displayName}</div>
          <div
            className="settings"
            onClick={() => {
              this.setState({ showing: 'settings' });
            }}
          >
            ⚙
          </div>
        </div>
        {annotation.image && !isLayer ? (<img className="image" src={annotation.image}/>) : null}
        
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
          className="tags"
          onClick={(e) => {
            onClickTags(annotation.id, e.screenX, e.screenY);
          }}
        >{annotation.tags.map(tag => (
          <span style={{ color: tag.color }}>{tag.name}</span>
        ))
        }</div>
      </div>
    );
  }
  
  settingsView() {
    let { annotation, onColorChange, onDelete } = this.props;
    
    return (
      <div className="settings-view">
        <div
          className="back"
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
        
        
        <div className="button" onClick={onDelete}>Delete</div>
        
        <div>Created: {annotation.dateCreated.split('T')[0]}</div>
        <div>Modified: {annotation.dateModified.split('T')[0]}</div>
        <div>Imported: {annotation.imported ? 'yes' : 'no'}</div>
      </div>
    );
  }
  
  render() {
    let { annotation } = this.props;
    let { showing } = this.state;
    let content = null;
    if (showing === 'main') {
      content = this.mainView();
    }
    else if (showing === 'settings') {
      content = this.settingsView();
    }
    
    return (
      <div className={cx('annotation-preview', { owner: annotation.isOwner })}>
        {content}
      </div>
    );
  }
}

export default AnnotationPreview;
