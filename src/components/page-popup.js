'use strict';

import React from 'react';
import ReactDOM from 'react-dom';

class PagePopup extends React.Component {
  state = {
    popupPosition: null
  };

  componentDidMount() {
    this.updatePopupPosition();
  }

  componentDidUpdate() {
    if (!this.state.popupPosition) {
      this.updatePopupPosition();
    }
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (nextProps.id !== prevState.id) {
      return { id: nextProps.id, popupPosition: null };
    }
    else return null;
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

  updatePopupPosition() {
    let dimensions = {
      width: this.refs.container.offsetWidth,
      height: this.refs.container.offsetHeight
    };

    let annotationPosition = this.props.position;

    let node = PDFViewerApplication.pdfViewer.getPageView(annotationPosition.pageIndex).div;

    let left;
    let top;
    let rectMax = [];
    for (let rect of annotationPosition.rects) {
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

    this.setState({ popupPosition: { top, left } });
  }

  render() {
    return ReactDOM.createPortal(
      <div
        ref="container"
        className={'page-popup ' + this.props.className}
        style={this.state.popupPosition && { ...this.state.popupPosition }}
      >
        {this.props.children}
      </div>,
      this.getContainer()
    );
  }
}

export default PagePopup;
