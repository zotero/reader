'use strict';

import React, { Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { wx, hy } from '../lib/coordinates';

const PADDING_LEFT = 9;
const PADDING_TOP = 9;

function DraggableBox({ draggableRef, pageIndex, children, onDragStart, onDragEnd, onMove }) {
  
  const container = useRef();
  const innerDraggableRef = useRef();
  const viewerContainer = useRef(document.getElementById('viewerContainer'));
  
  const dragging = useRef(false);
  const visible = useRef();
  const [rendering, setRendering] = useState(false);
  
  const pageRect = useRef();
  const boxRect = useRef();
  const cursorPoint = useRef();
  
  const handleDragStartCallback = useCallback(handleDragStart, []);
  const handleDragEndCallback = useCallback(handleDragEnd, []);
  const handleDragLeaveCallback = useCallback(handleDragLeave, []);
  
  const handleDragOverCallback = useCallback(handleDragOver, []);
  const handleScrollCallback = useCallback(handleScroll, []);
  
  useLayoutEffect(() => {
    container.current = getContainer();
    innerDraggableRef.current = draggableRef.current;
    innerDraggableRef.current.addEventListener('dragstart', handleDragStartCallback);
    innerDraggableRef.current.addEventListener('dragend', handleDragEndCallback);
    window.addEventListener('dragleave', handleDragLeaveCallback);
    window.addEventListener('dragover', handleDragOverCallback);
    viewerContainer.current.addEventListener('scroll', handleScrollCallback);
    
    return () => {
      innerDraggableRef.current.removeEventListener('dragstart', handleDragStartCallback);
      innerDraggableRef.current.removeEventListener('dragend', handleDragEndCallback);
      window.removeEventListener('dragleave', handleDragLeaveCallback);
      window.removeEventListener('dragover', handleDragOverCallback);
      viewerContainer.current.removeEventListener('scroll', handleScrollCallback);
    }
  }, [
    handleDragStartCallback,
    handleDragEndCallback,
    handleDragLeaveCallback,
    handleDragOverCallback,
    handleScrollCallback
  ]);
  
  function updatePage() {
    let page = document.querySelector('div.page[data-page-number="' + (pageIndex + 1) + '"]');
    let rect = page.getBoundingClientRect();
    pageRect.current = [rect.left, rect.top, rect.right, rect.bottom];
  }
  
  function handleScroll(event) {
    if (!dragging.current) return;
    updatePage();
  }
  
  function handleDragStart(event) {
    onDragStart(event);
    
    updatePage();
    
    cursorPoint.current = [event.offsetX, event.offsetY];
    
    let clientRect = draggableRef.current.getBoundingClientRect();
    boxRect.current = [0, 0, clientRect.width, clientRect.height];
    
    document.getElementById('viewer').classList.add('disable-pointer-events');
    
    updatePosition(event.clientX, event.clientY);
    dragging.current = true;
    setRendering(true);
  }
  
  function handleDragEnd(event) {
    setRendering(false);
    dragging.current = false;
    
    if (visible.current) {
      onMove(boxRect.current);
    }
    
    document.getElementById('viewer').classList.remove('disable-pointer-events');
    onDragEnd();
  }
  
  function handleDragLeave(event) {
    if (!dragging.current) return;
    visible.current = false;
    container.current.style.opacity = 0;
  }
  
  function handleDragOver(event) {
    if (!dragging.current) return;
    updatePosition(event.clientX, event.clientY);
  }
  
  function updatePosition(clientX, clientY) {
    let x = clientX - pageRect.current[0] - cursorPoint.current[0] - PADDING_LEFT;
    let y = clientY - pageRect.current[1] - cursorPoint.current[1] - PADDING_TOP;
    
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    
    if (x + wx(boxRect.current) > wx(pageRect.current) - PADDING_LEFT * 2) x = wx(pageRect.current) - wx(boxRect.current) - PADDING_LEFT * 2;
    if (y + hy(boxRect.current) > hy(pageRect.current) - PADDING_TOP * 2) y = hy(pageRect.current) - hy(boxRect.current) - PADDING_TOP * 2;
    
    boxRect.current = [x, y, x + wx(boxRect.current), y + hy(boxRect.current)];
    
    container.current.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    
    visible.current = clientX >= pageRect.current[0] + PADDING_LEFT && clientX <= pageRect.current[2] - PADDING_LEFT;
    container.current.style.opacity = visible.current ? 1 : 0;
  }
  
  function getContainer() {
    let page = document.querySelector('div.page[data-page-number="' + (pageIndex + 1) + '"]');
    let container = page.querySelector('.draggable-box');
    if (!container) {
      container = document.createElement('div');
      container.className = 'draggable-box';
      container.id = 'draggableBox';
      page.insertBefore(container, page.firstChild);
    }
    return container;
  }
  
  if (!rendering) return null;
  
  return ReactDOM.createPortal(
    <Fragment>
      {children}
    </Fragment>,
    container.current
  );
}

export default DraggableBox;
