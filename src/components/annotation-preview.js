'use strict';

import React from 'react';
import cx from 'classnames';
import ColorPicker from './color-picker';
import Editor from './editor';

class AnnotationPreview extends React.Component {
  state = {
    showing: 'main',
    editingText: false,
    editingPage: false
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
    let textElement = null;
    if (annotation.type === 'highlight' && !isLayer) {
      if (this.state.editingText) {
        textElement = <Editor
          id={annotation.id}
          text={annotation.text}
          placeholder="Extracted text.."
          onChange={(text) => {
            onChange({ id: annotation.id, text: text });
          }}
          onBlur={() => {
            this.setState({ editingText: false });
          }
          }
        />
      }
      else {
        
        let text = annotation.text.slice(0, 70).trim();
        if (annotation.text.length > 70) {
          text += '..';
        }
        
        textElement = (
          <React.Fragment>
            <div className="text-preview">
              {text}
              <span
                className="text-edit"
                onClick={() => {
                  this.setState({ editingText: true })
                }}
              >edit</span>
            </div>
          
          </React.Fragment>
        )
      }
    }
    
    return (
      <div className="main-view">
        <div
          className="color-line"
          style={{ backgroundColor: annotation.color }}
          draggable={true}
          onDragStart={onDragStart}
        ></div>
        <div className="header">
          {
            this.state.editingPage ? (<input
              className="page-edit"
              type="edit"
              value={annotation.page}
              onChange={(e) => {
                onChange({ id: annotation.id, page: e.target.value });
              }}
            />) : (<span className="page-display" onClick={() => {
              this.setState({ editingPage: true })
            }}>{annotation.page}</span>)
          }
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
        
        {textElement}
        
        <Editor
          id={annotation.id}
          text={annotation.comment}
          placeholder="Comment.."
          plainTextOnly={true}
          onChange={(text) => {
            onChange({ id: annotation.id, comment: text });
          }}
          onBlur={() => {
          }}
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
        
        <div>Modified: {annotation.dateModified.split('T')[0]}</div>
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
