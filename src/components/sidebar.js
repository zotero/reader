'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';
import AnnotationPreview from './annotation-preview';
import { searchAnnotations } from '../lib/search';

class SidebarSearch extends React.Component {
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

class SidebarItem extends React.Component {
  handleSelectAnnotation = () => {
    this.props.onSelect(this.props.annotation.id);
  }
  
  handleDelete = () => {
    this.props.onDelete(this.props.annotation.id);
  }
  
  render() {
    return (
      <div
        key={this.props.annotation.id}
        className={cx('item', { active: this.props.isActive })}
        data-sidebar-id={this.props.annotation.id}
        onClick={this.handleSelectAnnotation}
      >
        <AnnotationPreview
          annotation={this.props.annotation}
          onDelete={this.handleDelete}
          onFocus={() => {
          }}
          onClickTags={this.props.onClickTags}
          onChange={this.props.onChange}
          onResetPageLabels={this.props.onResetPageLabels}
          onDragStart={(event) => {
            let annotation = JSON.stringify(JSON.parse(this.props.annotation));
            annotation.itemId = window.itemId;
            event.dataTransfer.setData('zotero/annotation', JSON.stringify(this.props.annotation));
            event.dataTransfer.setData('text/plain', JSON.stringify(this.props.annotation));
          }}
        />
      </div>
    )
  }
}

class Sidebar extends React.Component {
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
      <div className="sidebar">
        <SidebarSearch
          query={this.state.query}
          onInput={this.handleSearchInput}
          onClear={this.handleSearchClear}
        />
        {annotations.map((annotation) => (
          <SidebarItem
            key={annotation.id}
            isActive={annotation.id === this.props.activeAnnotationId}
            annotation={annotation}
            onSelect={this.props.onSelectAnnotation}
            onChange={this.props.onChange}
            onResetPageLabels={this.props.onResetPageLabels}
            onDelete={this.props.onDelete}
            onClickTags={this.props.onClickTags}
          />
        ))}
      </div>,
      containerNode
    );
    
    return null;
  }
}

export default Sidebar;
