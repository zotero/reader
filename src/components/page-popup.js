'use strict';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';

function PagePopup({ id, position, updateOnPositionChange, className, children }) {
	const [popupPosition, setPopupPosition] = useState(null);
	const [update, setUpdate] = useState();
	const containerRef = useRef();

	useEffect(() => {
		setUpdate({});
	}, [id]);

	useEffect(() => {
		if (updateOnPositionChange) {
			setUpdate({});
		}
	}, [position]);

	useLayoutEffect(() => {
		if (update) {
			updatePopupPosition();
		}
	}, [update]);

	function getContainer() {
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

	function updatePopupPosition() {
		let dimensions = {
			width: containerRef.current.offsetWidth,
			height: containerRef.current.offsetHeight
		};

		let annotationPosition = position;

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

		let isTop = true;

		if (node.offsetTop + 10 + rectMax[3] + 20 + dimensions.height <= visibleRect[3]) {
			top = node.offsetTop + 10 + rectMax[3] + 20;
			isTop = false;
		}
		else if (node.offsetTop + 10 + rectMax[1] - visibleRect[1] > dimensions.height) {
			top = node.offsetTop + 10 + rectMax[1] - dimensions.height - 20;
		}
		else {
			top = visibleRect[3] - dimensions.height;
		}

		setPopupPosition({ top, left, isTop });
	}

	let topBottom = {};
	if (popupPosition) {
		topBottom['page-popup-' + (popupPosition.isTop ? 'top' : 'bottom')] = true;
	}

	return ReactDOM.createPortal(
		<div
			ref={containerRef}
			className={cx('page-popup', className, { ...topBottom })}
			style={popupPosition && { ...popupPosition }}
		>
			{children}
		</div>,
		getContainer()
	);
}

export default PagePopup;
