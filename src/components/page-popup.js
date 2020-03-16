'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class PagePopup extends React.Component {
  state = {
    dimensions: null
  };
  
  componentDidMount() {
    this.setState({
      dimensions: {
        width: this.container.offsetWidth,
        height: this.container.offsetHeight
      }
    });
  }
  
  getContainer() {
    let popupContainer = document.getElementById('pagePopupContainer');
    if (!popupContainer) {
      let viewerContainer = document.getElementById('viewerContainer');
      if (!viewerContainer) return;
      popupContainer = document.createElement('div');
      popupContainer.className = 'page-popup-container';
      popupContainer.id = 'pagePopupContainer';
      viewerContainer.insertBefore(popupContainer, viewerContainer.firstChild);
    }
    
    return popupContainer;
  }
  
  getRect(position, dimensions) {
    let node = PDFViewerApplication.pdfViewer.getPageView(position.pageIndex).div;
    
    let left;
    let top;
    let rectMax = [];
    for (let rect of position.rects) {
      rectMax[0] = rectMax[0] ? Math.min(rectMax[0], rect[0]) : rect[0];
      rectMax[1] = rectMax[1] ? Math.min(rectMax[1], rect[1]) : rect[1];
      rectMax[2] = rectMax[2] ? Math.max(rectMax[2], rect[2]) : rect[2];
      rectMax[3] = rectMax[3] ? Math.max(rectMax[3], rect[3]) : rect[3];
    }
    
    let viewerScrollLeft = PDFViewerApplication.pdfViewer.container.scrollLeft;
    let viewerScrollTop = PDFViewerApplication.pdfViewer.container.scrollTop;
    let viewerWidth = PDFViewerApplication.pdfViewer.container.offsetWidth;
    let viewerHeight = PDFViewerApplication.pdfViewer.container.offsetHeight;
    
    let visibleRect = [viewerScrollLeft, viewerScrollTop, viewerScrollLeft + viewerWidth, viewerScrollTop + viewerHeight];
    
    let annotationCenterLeft = node.offsetLeft + 9 + rectMax[0] + ((rectMax[2] - rectMax[0])) / 2;
    
    left = annotationCenterLeft - dimensions.width / 2;
    
    if (node.offsetTop + 10 + rectMax[3] + 20 + dimensions.height <= visibleRect[3]) {
      top = node.offsetTop + 10 + rectMax[3] + 20;
    }
    else if (node.offsetTop + 10 + rectMax[1] - visibleRect[1] > dimensions.height) {
      top = node.offsetTop + 10 + rectMax[1] - dimensions.height - 20;
    }
    else {
      top = visibleRect[3] - dimensions.height;
    }
    
    return { left, top };
  }
  
  render() {
    let { position, children, className } = this.props;
    let { dimensions } = this.state;
    
    return ReactDOM.createPortal(
      <div
        ref={el => (this.container = el)}
        className={'page-popup ' + className}
        style={dimensions ? this.getRect(position, dimensions) : {}}
      >
        {children}
      </div>,
      this.getContainer()
    );
  }
}

export default PagePopup;
