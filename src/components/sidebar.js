'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';
import AnnotationPreview from './annotation-preview';
import { searchAnnotations } from '../lib/search';

class Sidebar extends React.Component {
  state = {
    filteredAnnotations: null,
    query: ''
  };
  
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
  
  render() {
    let { importableAnnotationsNum, annotations, onSelectAnnotation, onChange, onDelete, activeAnnotationId, onClickTags, onImport } = this.props;
    let annotationsView = document.getElementById('annotationsView');
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
    
    if (annotationsView) {
      return ReactDOM.createPortal(
        (
          <div className="sidebar">
            <div className="search">
              <div className="input-container">
                <input
                  type="text"
                  placeholder="Search.."
                  value={this.state.query}
                  onChange={(e) => {
                    this.setState({ query: e.target.value });
                    this.search(e.target.value);
                  }}
                />
              </div>
              <div className="clear" onClick={() => {
                this.setState({ query: '' });
                this.search();
              }}>X
              </div>
            </div>
            <button
              className="import"
              onClick={onImport}
            >
              Import annotations ({importableAnnotationsNum})
            </button>
            {annotations.map((annotation, index) => (
              <div
                key={annotation.id}
                className={cx('block', { active: annotation.id === activeAnnotationId })}
                data-sidebar-id={annotation.id}
                onClick={() => {
                  onSelectAnnotation(annotation.id);
                }}
                // draggable={false}
                // onDragStart={(event)=> {
                //   // annotation.itemId = window.itemId;
                //   // event.dataTransfer.setData('zotero/annotation', JSON.stringify(annotation));
                //   // event.dataTransfer.setData('text/plain', JSON.stringify(annotation));
                // }}
              >
                <AnnotationPreview
                  annotation={annotation}
                  onUpdate={(comment) => {
                    onChange({ id: annotation.id, comment });
                  }}
                  onColorChange={(color) => {
                    onChange({ id: annotation.id, color });
                  }}
                  onDelete={() => {
                    onDelete(annotation.id);
                  }}
                  
                  onFocus={() => {
                  }}
                  onClickTags={onClickTags}
                  onChange={onChange}
                  onDragStart={(event) => {
                    annotation.itemId = window.itemId;
                    event.dataTransfer.setData('zotero/annotation', JSON.stringify(annotation));
                    event.dataTransfer.setData('text/plain', JSON.stringify(annotation));
                  }}
                />
              </div>
            ))}
          
          </div>
        ),
        annotationsView
      );
    }
    
    return null;
  }
}

export default Sidebar;
