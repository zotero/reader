'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class ImportBar extends React.Component {
  state = {
    hidden: false
  }
  
  handleImport = () => {
    this.setState({ hidden: true });
    this.props.onImport();
  }
  
  handleDismiss = () => {
    this.setState({ hidden: true });
    this.props.onDismiss();
  }
  
  getContainerNode() {
    let container = document.getElementById('importBarContainer');
    if (!container) {
      let viewerContainer = document.getElementById('viewerContainer');
      container = document.createElement('div');
      container.id = 'importBarContainer';
      container.className = 'import-bar';
      viewerContainer.insertBefore(container, viewerContainer.firstChild);
    }
    return container;
  }
  
  removeContainerNode() {
    let container = document.getElementById('importBarContainer');
    if (container) {
      container.parentElement.removeChild(container);
    }
  }
  
  render() {
    if (this.state.hidden) {
      this.removeContainerNode();
      return null;
    }
    
    let containerNode = this.getContainerNode();
    return ReactDOM.createPortal(
      <React.Fragment>
        <span className="message">Import annotations from the PDF file</span>
        <button onClick={this.handleImport}>Import</button>
        <button onClick={this.handleDismiss}>Dismiss</button>
      </React.Fragment>,
      containerNode
    );
  }
}

export default ImportBar;
