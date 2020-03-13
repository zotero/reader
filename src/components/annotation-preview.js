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
  
  handleTagsClick = (event) => {
    let rect = event.currentTarget.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    this.props.onClickTags(this.props.annotation.id, event.screenX - x, event.screenY - y);
  }
  
  handleDelete = () => {
    this.props.onDelete();
  }
  
  handleColorPick = (color) => {
    this.setState({ showing: 'main' });
    this.props.onChange({ id: this.props.annotation.id, color });
  }
  
  handlePageEdit = (event) => {
    this.props.onChange({ id: this.props.annotation.id, page: event.target.value });
  }
  
  handleTextChange = (text) => {
    this.props.onChange({ id: this.props.annotation.id, text });
  }
  
  handleCommentChange = (text) => {
    this.props.onChange({ id: this.props.annotation.id, comment: text });
  }
  
  handleBeginEditingText = () => {
    this.setState({ editingText: true })
  }
  
  handleEndEditingText = () => {
    this.setState({ editingText: false })
  }
  
  handleBeginEditingPage = () => {
    this.setState({ editingPage: true })
  }
  
  handleShowMain = () => {
    this.setState({ showing: 'main' });
  }
  
  handleShowSettings = () => {
    this.setState({ showing: 'settings' });
  }
  
  sliceText(text) {
    let slicedText = text.slice(0, 70).trim();
    if (text.length > 70) {
      slicedText += '..';
    }
    return slicedText;
  }
  
  mainView() {
    let { annotation, isLayer, onDragStart } = this.props;
    let page;
    if (this.state.editingPage) {
      page = <input
        className="page-edit" type="edit"
        value={annotation.page} onChange={this.handlePageEdit}
      />;
    }
    else {
      page = <span className="page-display"
                   onClick={this.handleBeginEditingPage}>Page {annotation.page}</span>
    }
    
    let text;
    if (annotation.type === 'highlight' && !isLayer) {
      if (this.state.editingText) {
        text = <Editor
          id={annotation.id}
          text={annotation.text}
          placeholder="Extracted text.."
          isReadOnly={!!annotation.ownerName}
          onChange={this.handleTextChange}
          onBlur={this.handleEndEditingText}
        />
      }
      else {
        if (annotation.text) {
          text = (
            <div className="text-preview">
              {this.sliceText(annotation.text)}
              {!annotation.ownerName && <span className="text-edit" onClick={this.handleBeginEditingText}
              >edit</span>}
            </div>
          )
        }
      }
    }
    
    let tags = annotation.tags.map((tag, index) => (
      <span className="tag" key={index} style={{ color: tag.color }}
      >{tag.name}</span>
    ));
    
    let comment = <Editor
      id={annotation.id} text={annotation.comment} placeholder="Comment.."
      plainTextOnly={true} onChange={this.handleCommentChange}
      onBlur={() => {
      }}
      isReadOnly={!!annotation.ownerName}
    />;
    
    return (
      <div className="main-view">
        <div
          className="color-line" style={{ backgroundColor: annotation.color }}
          draggable={true} onDragStart={onDragStart}
        />
        <div className="header" title={'Modified on ' + annotation.dateModified.split('T')[0]}>
          {page}
          <div>{annotation.ownerName}</div>
          {annotation.ownerName ? <div></div> : <div className="settings" onClick={this.handleShowSettings}>⚙</div>}
        </div>
        {!isLayer && annotation.image && (<img className="image" src={annotation.image}/>)}
        {text}
        {comment}
        <div className="tags" onClick={this.handleTagsClick}>{tags}</div>
      </div>
    );
  }
  
  settingsView() {
    return (
      <div className="settings-view">
        <div className="back" onClick={this.handleShowMain}>←</div>
        <ColorPicker onColorPick={this.handleColorPick}/>
        <div className="button" onClick={this.handleDelete}>Delete</div>
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
      <div className={cx('annotation-preview', { 'read-only': annotation.ownerName })}>
        {content}
      </div>
    );
  }
}

export default AnnotationPreview;
