'use strict';

import React, {
  useLayoutEffect,
  useRef,
  useCallback
} from 'react';

import cx from 'classnames'
import { wx, hy } from '../lib/coordinates';

const PADDING = 5;

const PADDING_LEFT = 9;
const PADDING_TOP = 9;

function Note({ annotation, isSelected, enableMoving, onDragStart, onDragEnd, onChangePosition }) {
  const draggableRef = useRef(null);

  let width = 20 * PDFViewerApplication.pdfViewer._currentScale;
  let height = 20 * PDFViewerApplication.pdfViewer._currentScale;

  const container = useRef();
  const viewerContainer = useRef(document.getElementById('viewerContainer'));

  const dragging = useRef(false);
  const visible = useRef();

  const pageRect = useRef();
  const boxRect = useRef();
  const cursorPoint = useRef();

  const handleDragLeaveCallback = useCallback(handleDragLeave, []);
  const handleDragOverCallback = useCallback(handleDragOver, []);
  const handleScrollCallback = useCallback(handleScroll, []);

  useLayoutEffect(() => {
    container.current = getDragContainer();
    window.addEventListener('dragleave', handleDragLeaveCallback);
    window.addEventListener('dragover', handleDragOverCallback);
    viewerContainer.current.addEventListener('scroll', handleScrollCallback);

    return () => {
      window.removeEventListener('dragleave', handleDragLeaveCallback);
      window.removeEventListener('dragover', handleDragOverCallback);
      viewerContainer.current.removeEventListener('scroll', handleScrollCallback);
      dragging.current = false;
      container.current.style.opacity = 0;
    }
  }, [
    handleDragLeaveCallback,
    handleDragOverCallback,
    handleScrollCallback,
    enableMoving
  ]);

  function getDragContainer() {
    let page = document.querySelector('div.page[data-page-number="' + (annotation.position.pageIndex + 1) + '"]');
    let container = page.querySelector('draggableNoteBox');
    if (!container) {
      container = document.createElement('div');
      container.id = 'draggableNoteBox';
      container.style.width = (width + PADDING * 2) + 'px';
      container.style.height = (height + PADDING * 2) + 'px';
      container.style.opacity = 0;
      page.insertBefore(container, page.firstChild);
    }
    return container;
  }

  function updatePage() {
    let page = document.querySelector('div.page[data-page-number="' + (annotation.position.pageIndex + 1) + '"]');
    let rect = page.getBoundingClientRect();
    pageRect.current = [rect.left, rect.top, rect.right, rect.bottom];
  }

  function handleScroll(event) {
    if (!dragging.current) return;
    updatePage();
  }

  function handleDragStart(event) {
    onDragStart(event);

    if (!enableMoving) {
      return;
    }

    updatePage();

    cursorPoint.current = [event.offsetX, event.offsetY];

    let clientRect = draggableRef.current.getBoundingClientRect();
    boxRect.current = [0, 0, clientRect.width, clientRect.height];

    cursorPoint.current = [clientRect.width / 2, clientRect.height / 2];


    document.getElementById('viewer').classList.add('disable-pointer-events');

    updatePosition(event.clientX, event.clientY);
    dragging.current = true;
  }

  function handleDragEnd(event) {
    onDragEnd();
    
    // This seems to only have an effect in Firefox
    let isCancelled = event.dataTransfer.dropEffect === 'none';
    
    if (!enableMoving) {
      return;
    }

    dragging.current = false;
    container.current.style.opacity = 0;

    if (visible.current && !isCancelled) {
      let rect = boxRect.current.slice();
      let left = rect[0] + PADDING;
      let top = rect[1] + PADDING;
      rect = [left, top, left + width, top + height];
      onChangePosition({ ...annotation.position, rects: [rect] });
    }

    document.getElementById('viewer').classList.remove('disable-pointer-events');
  }

  function handleDragLeave(event) {
    if (!dragging.current) return;
    // Delay the event to allow `dragend` shoot first
    setTimeout(() => {
      if (!dragging.current) return;
      visible.current = false;
      container.current.style.opacity = 0;
    }, 0)
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

  return (

    <div
      className={cx('note-annotation', { selected: isSelected })}
      style={{
        backgroundColor: annotation.color,
        left: Math.round(annotation.position.rects[0][0]),
        top: Math.round(annotation.position.rects[0][1]),
        width: width,
        height: height
      }}
    >
      <div
        ref={draggableRef}
        className="square"
        style={{
          left: -PADDING,
          top: -PADDING,
          width: width + PADDING * 2,
          height: height + PADDING * 2
        }}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />
    </div>
  );
}

export default Note;
