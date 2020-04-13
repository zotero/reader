'use strict';

import React from 'react';
import cx from 'classnames';
import Editor from './editor';
import ExpandableEditor from './expandable-editor';

class Preview extends React.Component {

  handleTagsClick = (event) => {
    let rect = event.currentTarget.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    this.props.onClickTags(this.props.annotation.id, event.screenX - x, event.screenY - y);
  }

  handleTextChange = (text) => {
    this.props.onChange({ id: this.props.annotation.id, text });
  }

  handleCommentChange = (text) => {
    this.props.onChange({ id: this.props.annotation.id, comment: text });
  }

  handleClickPage = (event) => {
    if (!this.props.annotation.readOnly) {
      event.stopPropagation();
      this.props.onPageMenu(this.props.annotation.id, event.screenX, event.screenY);
    }
  }

  handleClickMore = (event) => {
    if (!this.props.annotation.readOnly) {
      event.stopPropagation();
      this.props.onMoreMenu(this.props.annotation.id, event.screenX, event.screenY);
    }
  }

  render() {
    let { annotation } = this.props;

    let text;
    if (annotation.type === 'highlight' && this.props.enableText) {
      text = (
        <div className="highlight">
          <ExpandableEditor
            id={annotation.id}
            text={annotation.text}
            placeholder="Add extracted text.."
            isReadOnly={!!annotation.readOnly}
            onChange={this.handleTextChange}
          />
        </div>
      )
    }

    let tags = this.props.enableTags && annotation.tags.map((tag, index) => (
      <span
        className="tag" key={index}
        style={{ color: tag.color }}
      >{tag.name}</span>
    ));

    let comment;
    if (this.props.isExpandable) {
      comment = this.props.enableComment && !(annotation.readOnly && !annotation.comment) &&
        <div className="comment"><ExpandableEditor
          id={annotation.id} text={annotation.comment} placeholder="Add comment.."
          isPlainText={false} onChange={this.handleCommentChange}
          isReadOnly={annotation.readOnly}
        /></div>;
    }
    else {
      comment = !(annotation.readOnly && !annotation.comment) && <Editor
        id={annotation.id}
        text={annotation.comment}
        placeholder="Add comment.."
        isPlainText={false}
        isReadOnly={annotation.readOnly}
        onChange={this.handleCommentChange}
      />;
    }

    return (
      <div className={cx('preview', { 'read-only': annotation.readOnly })}>
        <header
          title={'Modified on ' + annotation.dateModified.split('T')[0]}
          draggable={true}
          onDragStart={this.props.onDragStart}
        >
          <div className="left">
            <div className="color" style={{ backgroundColor: annotation.color }}/>
            <div className="page" onClick={this.handleClickPage}>Page {annotation.pageLabel}</div>
          </div>
          {annotation.authorName && (
            <div className="center">
              <div className="author">{annotation.authorName}</div>
            </div>
          )}
          <div className="right">
            <div className="more" onClick={this.handleClickMore}/>
          </div>
        </header>
        {this.props.enableImage && annotation.image && (<img className="image" src={annotation.image}/>)}
        {text}
        {comment}
        {this.props.enableTags &&
        <div className="tags" onClick={this.handleTagsClick} placeholder="Add tags..">{tags}</div>}

      </div>
    );
  }
}

export default Preview;
