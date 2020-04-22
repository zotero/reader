'use strict';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { getPageFromElement } from '../lib/pdfjs-dom';
import { deselect } from '../lib/utilities';

const PADDING_LEFT = 9;
const PADDING_TOP = 9;

function pointsToRect(startPoint, endPoint) {
  let left = Math.min(endPoint[0], startPoint[0]);
  let top = Math.min(endPoint[1], startPoint[1]);
  let right = left + Math.abs(endPoint[0] - startPoint[0]);
  let bottom = top + Math.abs(endPoint[1] - startPoint[1]);
  return [left, top, right, bottom];
}

function getPageRestrictedPoint(point, pageRect) {
  return [
    point[0] < pageRect[0] && pageRect[0] || point[0] > pageRect[2] && pageRect[2] || point[0],
    point[1] < pageRect[1] && pageRect[1] || point[1] > pageRect[3] && pageRect[3] || point[1]
  ]
}

//{ color, shouldStart, onSelection }
function AreaSelector(props) {
  const [areaStyle, setAreaStyle] = useState(null);
  
  const container = useRef(document.getElementById('viewerContainer'))
  const startPoint = useRef(null);
  const endPoint = useRef(null);
  const pageRect = useRef(null);
  const pageIndex = useRef(null);
  const scrollTimeout = useRef(null);
  
  const handlePointerDownCallback = useCallback(handlePointerDown, [props.shouldStart]);
  const handlePointerMoveCallback = useCallback(handlePointerMove, []);
  const handlePointerUpCallback = useCallback(handlePointerUp, []);
  
  useEffect(() => {
    container.current.addEventListener('mousedown', handlePointerDownCallback);
    window.addEventListener('mousemove', handlePointerMoveCallback);
    window.addEventListener('mouseup', handlePointerUpCallback);
    return () => {
      container.current.removeEventListener('mousedown', handlePointerDownCallback);
      window.removeEventListener('mousemove', handlePointerMoveCallback);
      window.removeEventListener('mouseup', handlePointerUpCallback);
    }
  }, [handlePointerDownCallback, handlePointerMoveCallback, handlePointerUpCallback]);
  
  const clientToContainerPoint = (clientX, clientY) => {
    let containerBoundingRect = container.current.getBoundingClientRect();
    return [
      clientX - containerBoundingRect.left + container.current.scrollLeft,
      clientY - containerBoundingRect.top + container.current.scrollTop
    ];
  };
  
  
  function scroll(x, y) {
    let br = container.current.getBoundingClientRect();
    
    let scrolled = false;
    let v = null;
    let h = null;
    if (y < br.y && pageRect.current[1] < container.current.scrollTop) {
      v = 'top';
    }
    else if (y > br.y + br.height && pageRect.current[3] > container.current.scrollTop + document.body.offsetHeight) {
      v = 'bottom';
    }
    
    if (x < br.x && pageRect.current[0] < container.current.scrollLeft) {
      h = 'left';
    }
    else if (x > br.x + br.width && pageRect.current[2] > container.current.scrollLeft + container.current.offsetWidth) {
      h = 'right';
    }
    
    if (v === 'top') {
      container.current.scrollTop -= 1;
      scrolled = true;
    }
    else if (v === 'bottom') {
      container.current.scrollTop += 1;
      scrolled = true;
    }
    
    if (h === 'left') {
      container.current.scrollLeft -= 1;
      scrolled = true;
    }
    else if (h === 'right') {
      container.current.scrollLeft += 1;
      scrolled = true;
    }
    
    if (scrolled) {
      scrollTimeout.current = window.requestAnimationFrame(() => {
        scroll(x, y);
      });
    }
  }
  
  function handlePointerMove(event) {
    if (!startPoint.current) {
      return;
    }
    
    deselect();
    window.cancelAnimationFrame(scrollTimeout.current);
    scroll(event.clientX, event.clientY);
    
    let point = clientToContainerPoint(event.clientX, event.clientY);
    endPoint.current = getPageRestrictedPoint(point, pageRect.current);
    let rect = pointsToRect(startPoint.current, endPoint.current);
    setAreaStyle({
      left: rect[0],
      top: rect[1],
      width: rect[2] - rect[0],
      height: rect[3] - rect[1]
    });
  }
  
  function handlePointerDown(event) {
    if (!props.shouldStart) {
      return;
    }
    
    window.cancelAnimationFrame(scrollTimeout.current);
    
    let page = getPageFromElement(event.target);
    if (!page) return;
    
    let { node, number } = page;
    
    pageRect.current = [
      node.offsetLeft + PADDING_LEFT,
      node.offsetTop + PADDING_TOP,
      node.offsetLeft + node.offsetWidth - PADDING_LEFT,
      node.offsetTop + node.offsetHeight - PADDING_TOP
    ];
    
    let point = clientToContainerPoint(event.clientX, event.clientY);
    let restrictedStartPoint = getPageRestrictedPoint(point, pageRect.current);
    if (JSON.stringify(point) !== JSON.stringify(restrictedStartPoint)) {
      return;
    }
    startPoint.current = point;
    pageIndex.current = number - 1;
  }
  
  function handlePointerUp(event) {
    if (!startPoint.current) return;
    
    window.cancelAnimationFrame(scrollTimeout.current);
    
    let endPoint = clientToContainerPoint(event.clientX, event.clientY);
    endPoint = getPageRestrictedPoint(endPoint, pageRect.current);
    let areaRect = pointsToRect(startPoint.current, endPoint);
    
    // If area size is more than zero
    if (areaRect[0] !== areaRect[2] || areaRect[1] !== areaRect[3]) {
      let position = {
        rects: [
          [
            areaRect[0] - pageRect.current[0],
            areaRect[1] - pageRect.current[1],
            areaRect[2] - pageRect.current[0],
            areaRect[3] - pageRect.current[1]
          ]
        ],
        pageIndex: pageIndex.current
      };
      
      props.onSelection(position);
    }
    
    startPoint.current = null;
    setAreaStyle(null);
  }
  
  if (!areaStyle) return null;
  
  return (
    <div
      className="area-selector"
      style={{
        ...areaStyle,
        borderColor: props.color
      }}
    />
  );
}

export default AreaSelector;
