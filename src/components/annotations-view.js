'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';
import { SidebarPreview } from './preview';
import { searchAnnotations } from '../lib/search';
import { formatAnnotationText } from '../lib/utilities';

class AnnotationsViewSearch extends React.Component {
  handleInput = (event) => {
    this.props.onInput(event.target.value);
  }

  handleClear = () => {
    this.props.onClear();
  }

  render() {
    return (
      <div className="search">
        <div className="input-container">
          <input
            type="text" placeholder="Search.."
            value={this.props.query} onChange={this.handleInput}
          />
        </div>
        <button className="clear" onClick={this.handleClear}>X</button>
      </div>
    );
  }
}

class Annotation extends React.Component {

  state = {
    isDown: false
  }

  componentDidMount() {
    window.addEventListener('mouseup', this.handleMouseUp);
  }

  componentWillUnmount() {
    window.removeEventListener('mouseup', this.handleMouseUp);
  }

  handleClickAnnotation = (event) => {
    if (event.button === 0) {
      this.props.onSelect(this.props.annotation.id, event.ctrlKey || event.metaKey, event.shiftKey);
    }
  }

  handleEditPage = () => {
    this.props.onPageMenu(this.props.annotation.id);
  }

  handleDragStart = (event) => {
    if (!this.props.isSelected) {
      event.preventDefault();
      return;
    }
    this.props.onDragStart(event);
  }

  handleMouseDown = () => {
    this.setState({ isDown: true });
  }

  handleMouseUp = () => {
    this.setState({ isDown: false });
  }

  render() {
    let annotation = this.props.annotation;
    return (
      <div
        key={this.props.annotation.id}
        className={cx('annotation', { selected: this.props.isSelected, down: this.state.isDown })}
        data-sidebar-id={this.props.annotation.id}
        // draggable={true}
        ref="asdf"
        // onDragStart={(event) => {event.preventDefault();return;event.dataTransfer.setData('text/plain', 'dfd')}}
        onMouseDown={this.handleMouseDown}
        onDragEnd={this.handleMouseUp}
      >
        <SidebarPreview
          state={this.props.expansionState}
          annotation={this.props.annotation}
          selected={this.props.isSelected}
          onClickSection={this.props.onClickAnnotationSection}
          onDoubleClickHighlight={this.props.onDoubleClickHighlight}
          onPageMenu={this.props.onPageMenu}
          onMoreMenu={this.props.onMoreMenu}
          onChange={this.props.onChange}
          onEditorBlur={this.props.onAnnotationEditorBlur}
        />
      </div>
    )
  }
}

class AnnotationsView extends React.Component {
  state = {
    filteredAnnotations: null,
    query: ''
  };

  getContainerNode() {
    return document.getElementById('annotationsView');
  }

  search(query) {
    let { annotations } = this.props;
    if (query) {
      let filteredAnnotations = searchAnnotations(annotations, query);
      this.setState({ filteredAnnotations });
    }
    else {
      this.setState({ filteredAnnotations: null });
    }
  }

  handleSearchInput = (query) => {
    this.setState({ query });
    this.search(query);
  }

  handleSearchClear = () => {
    this.setState({ query: '' });
    this.search();
  }

  render() {
    let containerNode = this.getContainerNode();
    if (!containerNode) return null;

    let { annotations } = this.props;
    if (this.state.filteredAnnotations) {
      let newFilteredAnnotations = [];
      for (let filteredAnnotation of this.state.filteredAnnotations) {
        let annotation = annotations.find(x => x.id === filteredAnnotation.id);
        if (annotation) {
          newFilteredAnnotations.push(annotation);
        }
      }
      annotations = newFilteredAnnotations;
    }

    return ReactDOM.createPortal(
      <React.Fragment>
        <AnnotationsViewSearch
          query={this.state.query}
          onInput={this.handleSearchInput}
          onClear={this.handleSearchClear}
        />
        {annotations.map((annotation) => (
          <Annotation
            key={annotation.id}
            isSelected={this.props.selectedAnnotationIds.includes(annotation.id)}
            annotation={annotation}
            expansionState={this.props.selectedAnnotationIds.includes(annotation.id) && this.props.expansionState}
            onSelect={this.props.onSelectAnnotation}
            onChange={this.props.onChange}
            onClickAnnotationSection={this.props.onClickAnnotationSection}
            onDoubleClickHighlight={this.props.onDoubleClickHighlight}
            onPageMenu={this.props.onPageMenu}
            onMoreMenu={this.props.onMoreMenu}
            onDragStart={this.props.onDragStart}
            onAnnotationEditorBlur={this.props.onAnnotationEditorBlur}
          />
        ))}
      </React.Fragment>,
      containerNode
    );

    return null;
  }
}

export default AnnotationsView;
