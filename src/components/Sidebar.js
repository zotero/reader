import React from "react";
import ReactDom from "react-dom";

import Meta from "./Meta";

import { searchAnnotations } from "../lib/search";

import "../style/Sidebar.css";

class Sidebar extends React.Component {
  state = {
    filteredAnnotations: null,
    query: ""
  };

  search(query) {
    const { annotations } = this.props;
    
    if (query) {
      console.time("annotations search");
      let filteredAnnotations = searchAnnotations(annotations, query);
      console.timeEnd("annotations search");
      this.setState({ filteredAnnotations });
    }
    else {
      this.setState({ filteredAnnotations: null });
    }
  }
  
  render() {
    let { annotations, onSelectAnnotation, onChange, onDelete, activeAnnotationId } = this.props;
    const annotationsView = document.getElementById('annotationsView');
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
      return ReactDom.createPortal(
        (
          <div>
            <div className="Sidebar-search">
              <div className="Sidebar-search-input">
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
              <div className="Sidebar-search-clear" onClick={() => {
                this.setState({ query: "" });
                this.search();
              }}>X
              </div>
            </div>
            {annotations.map((annotation, index) => (
              <div
                key={annotation.id}
                className={`Sidebar-block ${annotation.external ? "Sidebar-block-external" : ""} ${annotation.id === activeAnnotationId ? "Sidebar-block-active" : ""}`}
                data-sidebar-id={annotation.id}
                onClick={() => {
                  onSelectAnnotation(annotation.id);
                }}
              >
                <div className="Sidebar-page">
                  Page {annotation.position.pageNumber}
                </div>
                {annotation.image ? (<img className="Sidebar-image" src={annotation.image}/>) : null}
                {annotation.text ? (
                  <div className="Sidebar-text">
                    {annotation.text.slice(0, 120).trim() + (annotation.text.length > 120 ? "…" : "")}
                  </div>) : null}
                {annotation.external ? (
                  
                  annotation.comment ? (
                    <div>
                      {annotation.comment.slice(0, 90).trim() + (annotation.comment.length > 90 ? "…" : "")}
                    </div>) : null
                
                ) : (annotation.comment || annotation.id === activeAnnotationId) ? (<Meta
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
                />) : null}
              
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
