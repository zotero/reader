'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class Findbar extends React.Component {
  getContainerNode() {
    return document.getElementById('findbar');
  }

  handleClose() {
    PDFViewerApplication.findBar.close();
  }

  render() {
    let containerNode = this.getContainerNode();
    return ReactDOM.createPortal(
      <React.Fragment>
        <div className="close-container">
          <button
            className="close"
            onClick={this.handleClose}
            tabIndex={-1}
          />
        </div>
      </React.Fragment>,
      containerNode
    );
  }
}

export default Findbar;
