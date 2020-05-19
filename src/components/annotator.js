'use strict';

import React, { useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Layer from './layer';
import AnnotationsView from './annotations-view';
import Toolbar from './toolbar';
import Findbar from './findbar';
import ImportBar from './import-bar';
import { annotationColors } from '../lib/colors';

import {
  copyToClipboard,
  intersectPositions,
  intersectBoundingPositions,
  setCaretToEnd,
  useRefState
} from '../lib/utilities';

import { extractRange } from '../lib/extract';

// All rects in annotator.js are stored in [left, top, right, bottom] order
// where the Y axis starts from the bottom:
// [231.284, 402.126, 293.107, 410.142]

const DEFAULT_SELECTION_COLOR = '#f0f0f0';

async function getselectionRangesRef(positionFrom, positionTo) {

  let getPageSelectionRange = async (pageIndex, startPoint, endPoint) => {
    let rect = (await PDFViewerApplication.pdfDocument.getPage(pageIndex + 1)).view.slice();

    if (startPoint[1] >= endPoint[1]) {
      if (startPoint) {
        rect[0] = startPoint[0];
        rect[3] = startPoint[1];
      }

      if (endPoint) {
        rect[2] = endPoint[0];
        rect[1] = endPoint[1];
      }
    }
    else {
      if (startPoint) {
        rect[0] = endPoint[0];
        rect[3] = endPoint[1];
      }

      if (endPoint) {
        rect[2] = startPoint[0];
        rect[1] = startPoint[1];
      }
    }

    let position = {
      pageIndex,
      rects: [rect]
    }

    let extractedRange = await extractRange(position);
    if (extractedRange) {
      return extractedRange;
    }
    return null;
  }

  let selectionRangesRef = []

  for (let i = positionFrom.pageIndex; i <= positionTo.pageIndex; i++) {

    let first = i === positionFrom.pageIndex;
    let last = i === positionTo.pageIndex;

    let startPoint = first && [positionFrom.rects[0][0], positionFrom.rects[0][1]];
    let endPoint = last && [positionTo.rects[0][0], positionTo.rects[0][1]];
    let selectionRange = await getPageSelectionRange(i, startPoint, endPoint);
    if (!selectionRange) continue;

    // TODO: Unify all annotations sort index calculation
    let offset = selectionRange.offset;
    selectionRange.sortIndex = [
      i.toString().padStart(6, '0'),
      offset.toString().padStart(7, '0'),
      '0'.padStart(10, '0') // TODO: Fix missing dot
    ].join('|');

    delete selectionRange.offset;

    selectionRangesRef.push(selectionRange);
  }

  return selectionRangesRef;
}

function isOver(position, annotations) {
  let x = position.rects[0][0];
  let y = position.rects[0][1];

  for (let annotation of annotations) {
    for (let rect of annotation.position.rects) {
      if (annotation.position.pageIndex === position.pageIndex && rect[0] <= x && x <= rect[2] &&
        rect[1] <= y && y <= rect[3]) {
        return true;
      }
    }

    for (let i = 0; i < annotation.position.rects.length - 1; i++) {
      let rect = annotation.position.rects[i];
      let rectNext = annotation.position.rects[i + 1];

      if (annotation.position.pageIndex === position.pageIndex) {
        if (Math.max(rect[0], rectNext[0]) <= x && x <= Math.min(rect[2], rectNext[2]) &&
          rectNext[1] <= y && y <= rect[3] &&
          rect[3] - rect[1] >= rect[1] - rectNext[3] &&
          rectNext[3] - rectNext[1] >= rect[1] - rectNext[3]
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function Annotator(props) {
  // useRefState synchronously sets ref value and asynchronously sets state value.
  // Annotator component uses reference variables everywhere to immediately access
  // the latest value and eliminate the complexity of rebinding custom events.
  // useRefState state variables are used only for rendering

  const [_annotations, annotationsRef, setAnnotations] = useRefState([]);
  const [_selectedIds, selectedIdsRef, setSelectedIds] = useRefState([]);
  const [_expansionState, expansionStateRef, setExpansionState] = useRefState(0);
  const [_mode, modeRef, setMode] = useRefState(null);
  const [_color, colorRef, setColor] = useRefState(annotationColors[1][1]);
  const [_selectionPositions, selectionPositionsRef, setSelectionPositions] = useRefState([]);
  const [_enableSelection, enableSelectionRef, setEnableSelection] = useRefState(false);
  const [_blink, blinkRef, setBlink] = useRefState(null);
  const [_isSidebarOpen, isSidebarOpenRef, setIsSidebarOpen] = useRefState(window.PDFViewerApplication.pdfSidebar.isOpen);
  const [_isSelectingText, isSelectingTextRef, setIsSelectingText] = useRefState(false);
  const [_isDraggingAnnotation, isDraggingAnnotationRef, setIsDraggingAnnotation] = useRefState(false);
  const [_isSelectingArea, isSelectingAreaRef, setIsSelectingArea] = useRefState(false);
  const [_isResizingArea, isResizingAreaRef, setIsResizingArea] = useRefState(false);
  const [_isLastClickRight, isLastClickRightRef, setIsLastClickRight] = useRefState(false);

  const lastSelectedAnnotationIdRef = useRef(null);
  const pointerDownPositionRef = useRef(null);
  const dragCanvasRef = useRef();
  const dragContextRef = useRef();
  const dragNoteRef = useRef();
  const selectionRangesRef = useRef([]);

  function setselectionRangesRef(ranges) {
    setSelectionPositions(ranges.map(r => r.position));
    selectionRangesRef.current = ranges;
  }

  function scrollSidebarTo(annotation) {
    let sidebarItem = document.querySelector(`div[data-sidebar-id="${annotation.id}"]`);
    let container = document.getElementById('annotationsView');
    if (sidebarItem && container) {
      if (
        window.PDFViewerApplication.pdfSidebar.isOpen &&
        window.PDFViewerApplication.pdfSidebar.active !== 9
      ) {
        window.PDFViewerApplication.pdfSidebar.switchView(9);
      }

      setTimeout(() => {
        sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }, 50)
    }
  }

  function scrollViewerTo(annotation) {
    let x = annotation.position.rects[0][0];
    let y = annotation.position.rects[0][3] + 100;

    window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
      pageNumber: annotation.position.pageIndex + 1,
      destArray: [
        null,
        { name: 'XYZ' },
        x,
        y,
        null
      ]
    });
  }

  function scrollTo(annotation, sidebar, viewer) {
    if (sidebar) {
      scrollSidebarTo(annotation);
    }

    if (viewer) {
      scrollViewerTo(annotation);
    }
  }

  let navigate = (annotation) => {
    let existingAnnotation = annotationsRef.current.find(x => x.id === annotation.id);
    if (existingAnnotation) {
      selectAnnotation(annotation.id, true, false, true, true);
    }

    makeBlink(annotation.position);
    scrollTo(annotation, true, true);
  }

  function makeBlink(position) {
    setBlink({
      id: Math.random(),
      position: position
    });
  }

  function initCanvas() {
    let canvas = document.createElement('canvas');
    canvas.className = 'drag-canvas';
    document.body.appendChild(canvas)
    dragCanvasRef.current = canvas;
    dragContextRef.current = canvas.getContext('2d');

    let icon = document.createElement('div');
    icon.className = 'drag-note';
    document.body.appendChild(icon);
    dragNoteRef.current = icon;
  }

  function deinitCanvas() {
    dragCanvasRef.current.parentNode.removeChild(dragCanvasRef.current);
    dragNoteRef.current.parentNode.removeChild(dragNoteRef.current);
  }

  const handleKeyDownCallback = useCallback(handleKeyDown, []);
  const handlePointerUpCallback = useCallback(handlePointerUp, []);
  const handleDragEndCallback = useCallback(handleDragEnd, []);
  const handleDragStartCallback = useCallback(handleDragStart, []);
  const handleSidebarViewChangeCallback = useCallback(handleSidebarViewChange, []);

  useEffect(() => {
    document.getElementById('viewer').setAttribute('draggable', true);

    props.navigateRef(navigate);
    props.setAnnotationsRef(setAnnotations);
    props.setColorRef(setColor);

    // viewer.eventBus.off('pagesinit', onDocumentReady);
    window.addEventListener('keydown', handleKeyDownCallback);
    window.addEventListener('pointerup', handlePointerUpCallback);
    window.addEventListener('dragend', handleDragEndCallback);
    window.addEventListener('dragstart', handleDragStartCallback);
    window.PDFViewerApplication.eventBus.on('sidebarviewchanged', handleSidebarViewChangeCallback);

    return () => {
      window.removeEventListener('keydown', handleKeyDownCallback);
      window.removeEventListener('pointerup', handlePointerUpCallback);
      window.removeEventListener('dragend', handleDragEndCallback);
      window.removeEventListener('dragstart', handleDragStartCallback);
      window.PDFViewerApplication.eventBus.off('sidebarviewchanged', handleSidebarViewChangeCallback);
    }
  }, []);

  useEffect(() => {
    initCanvas();
    props.onInitialized();
  }, [])


  let focusSidebarHighlight = (annotationId) => {
    setTimeout(function () {
      let content = document.querySelector(
        `#annotationsView .annotation[data-sidebar-id='${annotationId}'] .highlight .content`
      );
      if (content) {
        setCaretToEnd(content);
      }
    }, 100);
  }

  let focusComment = (annotationId) => {
    setTimeout(function () {
      let content;
      if (PDFViewerApplication.pdfSidebar.isOpen) {
        content = document.querySelector(
          `#annotationsView .annotation[data-sidebar-id='${annotationId}'] .comment .content`
        );
      }
      else {
        content = document.querySelector(`#pagePopupContainer .comment .content`);
      }
      if (content) {
        setCaretToEnd(content);
      }
    }, 100);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (selectedIdsRef.current.length) {
        selectAnnotation(null);
      }
      else if (modeRef.current) {
        setMode(null);
      }

      setselectionRangesRef([]);
      setEnableSelection(false);
    }

    if (e.target === document.getElementById('viewerContainer') || e.target === document.body) {


      if (e.key === 'Enter') {
        // this.setState({expansionState: 1});
        let id = selectedIdsRef.current[0];
        if (id) {
          focusComment(id)
        }
        else {
          if (lastSelectedAnnotationIdRef.current) {
            selectAnnotation(lastSelectedAnnotationIdRef.current, false, false, true, true);
          }
          else if (annotationsRef.current.length) {
            selectAnnotation(annotationsRef.current[0].id, false, false, true, true);
          }
        }
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        props.onDeleteAnnotations(selectedIdsRef.current);
      }
      else if (e.key === 'ArrowUp') {
        if (selectedIdsRef.current.length) {
          let annotation = selectPrevAnnotation(false, e.shiftKey);
          if (annotation) {
            scrollTo(annotation, true, true);
          }
          e.preventDefault();
        }
      }
      else if (e.key === 'ArrowDown') {
        if (selectedIdsRef.current.length) {
          let annotation = selectNextAnnotation(false, e.shiftKey);
          if (annotation) {
            scrollTo(annotation, true, true);
          }
          e.preventDefault();
        }
      }
    }
  }

  function handleDragEnd(event) {
    setEnableSelection(false);
    setIsDraggingAnnotation(false);
  }

  function handleSidebarViewChange(event) {
    // Delay until sidebar finishes transitioning
    // and allows us to properly position page popup
    if (event.view === 0) {
      setTimeout(() => {
        setIsSidebarOpen(window.PDFViewerApplication.pdfSidebar.isOpen);
      }, 300);
    }
    else {
      setIsSidebarOpen(window.PDFViewerApplication.pdfSidebar.isOpen);
    }
  }

  function handleDragStart(event) {
    if (event.target === document.getElementById('viewer')) {
      if (enableSelectionRef.current || selectionRangesRef.current.length !== 1 || !intersectBoundingPositions(pointerDownPositionRef.current, selectionRangesRef.current[0].position)) {
        event.preventDefault();
        return;
      }
    }
    else {
      return;
    }

    let range = JSON.parse(JSON.stringify(selectionRangesRef.current[0]));

    handleSelectionDragStart(event, range, pointerDownPositionRef.current);
  }

  function handleSelectionDragStart(event, selectionRange, pointerPosition) {
    let annotation = {
      itemId: window.itemId,
      text: selectionRange.text,
      position: selectionRange.position
    };

    let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
    if (pageLabels && pageLabels[annotation.position.pageIndex]) {
      annotation.pageLabel = pageLabels[annotation.position.pageIndex];
    }
    else {
      annotation.pageLabel = annotation.position.pageIndex + 1;
    }

    event.dataTransfer.setData('zotero/annotation', JSON.stringify(annotation));
    event.dataTransfer.setData('text/plain', JSON.stringify(annotation));


    let { width, height } = renderHighlight({
      color: DEFAULT_SELECTION_COLOR,
      position: selectionRange.position
    });

    // let width = event.target.offsetWidth - 10;
    // let height = event.target.offsetHeight - 10;
    //
    // let x = offsetX * this.dragCanvasRef.width / width;
    // let y = offsetY * this.dragCanvasRef.height / height;
    //
    // if (event.target.closest('#annotationsView')) {
    //   x = this.dragCanvasRef.width / 2;
    //   y = this.dragCanvasRef.height / 2;
    // }
    //

    let boundingRect = [
      Math.min(...annotation.position.rects.map(x => x[0])),
      Math.min(...annotation.position.rects.map(x => x[1])),
      Math.max(...annotation.position.rects.map(x => x[2])),
      Math.max(...annotation.position.rects.map(x => x[3]))
    ];

    let x = pointerPosition.rects[0][0] - boundingRect[0];
    let y = pointerPosition.rects[0][1] - boundingRect[1];
    x = x * dragCanvasRef.current.width / width;
    y = y * dragCanvasRef.current.height / height;

    event.dataTransfer.setDragImage(dragCanvasRef.current, x, y);
  }

  function toggleMode(m) {
    if (modeRef.current === m) {
      setMode(null);
    }
    else {
      setMode(m);
    }

    selectAnnotation(null);
  }

  function getAnnotationToSelectId(position, hasModifier) {
    let found = [];
    let x = position.rects[0][0];
    let y = position.rects[0][1];

    for (let annotation of annotationsRef.current) {
      let isFound = false;
      for (let rect of annotation.position.rects) {
        if (annotation.position.pageIndex === position.pageIndex && rect[0] <= x && x <= rect[2] &&
          rect[1] <= y && y <= rect[3]) {
          found.push(annotation);
          isFound = true;
          break;
        }
      }

      if (isFound) continue;

      for (let i = 0; i < annotation.position.rects.length - 1; i++) {
        let rect = annotation.position.rects[i];
        let rectNext = annotation.position.rects[i + 1];

        if (annotation.position.pageIndex === position.pageIndex) {
          if (Math.max(rect[0], rectNext[0]) <= x && x <= Math.min(rect[2], rectNext[2]) &&
            rectNext[1] <= y && y <= rect[3] &&
            rect[3] - rect[1] >= rect[1] - rectNext[3] &&
            rectNext[3] - rectNext[1] >= rect[1] - rectNext[3]
          ) {
            found.push(annotation);
            break;
          }
        }
      }
    }

    let selectedId = null;
    if (!found.length) return;

    function getAnnotationAreaSize(annotation) {
      let areaSize = 0;
      for (let rect of annotation.position.rects) {
        areaSize += (rect[2] - rect[0]) * (rect[3] - rect[1]);
      }
      return areaSize;
    }

    found.sort((a, b) => {
      return getAnnotationAreaSize(a) - getAnnotationAreaSize(b);
    });

    if (hasModifier) {
      return found[0].id;
    }

    let indexOfCurrentId = found.indexOf(found.find(annotation => selectedIdsRef.current.slice(-1)[0] === annotation.id));

    if (indexOfCurrentId >= 0) {
      if (indexOfCurrentId < found.length - 1) {
        selectedId = found[indexOfCurrentId + 1].id;
      }
      else {
        if (found.length) {
          selectedId = found[0].id;
        }
        // selectedId = null;
      }
    }
    else {
      if (found.length) {
        selectedId = found[0].id;
      }
    }

    return selectedId;
  }

  function selectPrevAnnotation(ctrl, shift) {
    let lastId = selectedIdsRef.current.slice(-1)[0];
    if (lastId) {
      let annotationIndex = annotationsRef.current.findIndex(x => x.id === lastId);
      if (annotationIndex - 1 >= 0) {
        let nextAnnotation = annotationsRef.current[annotationIndex - 1]
        let prevId = nextAnnotation.id;
        selectAnnotation(prevId, ctrl, shift, true, true);
        return nextAnnotation;
      }
      else {
        scrollTo(annotationsRef.current.find(x => x.id === lastId), true, true);
      }
    }
  }

  function selectNextAnnotation(ctrl, shift) {
    let lastId = selectedIdsRef.current.slice(-1)[0];
    if (lastId) {
      let annotationIndex = annotationsRef.current.findIndex(x => x.id === lastId);
      if (annotationsRef.current.length > annotationIndex + 1) {
        let nextAnnotation = annotationsRef.current[annotationIndex + 1]
        let nextId = nextAnnotation.id;
        selectAnnotation(nextId, ctrl, shift, true, true);
        return nextAnnotation;
      }
      else {
        scrollTo(annotationsRef.current.find(x => x.id === lastId), true, true);
      }
    }
  }

  function selectAnnotation(id, ctrl, shift, focusSidebar, focusViewer) {
    if (!id) {
      setSelectedIds([]);
      return 0;
    }
    let selectedIds = selectedIdsRef.current.slice();
    if (shift && selectedIds.length) {
      let annotationIndex = annotationsRef.current.findIndex(x => x.id === id);
      let lastSelectedIndex = annotationsRef.current.findIndex(x => x.id === selectedIds.slice(-1)[0]);
      let selectedIndices = selectedIds.map(id => annotationsRef.current.findIndex(annotation => annotation.id === id));
      let minSelectedIndex = Math.min(...selectedIndices);
      let maxSelectedIndex = Math.max(...selectedIndices);
      if (annotationIndex < minSelectedIndex) {
        for (let i = annotationIndex; i < minSelectedIndex; i++) {
          selectedIds.push(annotationsRef.current[i].id);
        }
      }
      else if (annotationIndex > maxSelectedIndex) {
        for (let i = maxSelectedIndex; i <= annotationIndex; i++) {
          selectedIds.push(annotationsRef.current[i].id);
        }
      }
      else {
        for (let i = Math.min(annotationIndex, lastSelectedIndex); i <= Math.max(annotationIndex, lastSelectedIndex); i++) {
          if (i === lastSelectedIndex) continue;
          selectedIds.push(annotationsRef.current[i].id);
        }
      }
    }
    else if (ctrl && selectedIds.length) {
      let existingIndex = selectedIds.indexOf(id)
      if (existingIndex >= 0) {
        selectedIds.splice(existingIndex, 1);
      }
      else {
        selectedIds.push(id);
      }
    }
    else {
      selectedIds = [id];
    }

    if (JSON.stringify(selectedIdsRef.current) === JSON.stringify(selectedIds)) return 0;

    setSelectedIds(selectedIds);
    if (selectedIds.length >= 2) {
      setExpansionState(0);
    }
    else {
      setExpansionState(1);
    }

    lastSelectedAnnotationIdRef.current = selectedIds.slice(-1)[0];

    if (focusSidebar || focusViewer) {
      let annotation = annotationsRef.current.find(x => x.id === selectedIds.slice(-1)[0]);
      scrollTo(annotation, focusSidebar, focusViewer);
    }

    return selectedIds.length;
  }

  function renderHighlight(annotation) {
    let rects = annotation.position.rects.slice();
    let imageRect = [
      Math.min(...rects.map(x => x[0])),
      Math.min(...rects.map(x => x[1])),
      Math.max(...rects.map(x => x[2])),
      Math.max(...rects.map(x => x[3]))
    ];

    rects = rects.map(rect => [
      rect[0] - imageRect[0],
      rect[1] - imageRect[1],
      rect[2] - imageRect[0],
      rect[3] - imageRect[1]
    ]);

    rects = rects.map(rect => [
      rect[0],
      (imageRect[3] - imageRect[1]) - rect[1],
      rect[2],
      (imageRect[3] - imageRect[1]) - rect[3]
    ]);

    let width = imageRect[2] - imageRect[0];
    let height = imageRect[3] - imageRect[1];

    dragCanvasRef.current.width = width;
    dragCanvasRef.current.height = height;

    dragContextRef.current.fillStyle = annotation.color;
    for (let rect of rects) {
      dragContextRef.current.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    }

    // let width = 200;
    // let height = 200 * img.height / img.width;
    return { width, height };
  }

  let handleAnnotationDragStart = (event) => {

    setIsDraggingAnnotation(true);

    setEnableSelection(false);

    let isSidebar = event.target.closest('#annotationsView');

    // annotation.itemId = window.itemId;
    event.dataTransfer.setData('zotero/annotation', JSON.stringify(selectedIdsRef.current));
    event.dataTransfer.setData('text/plain', JSON.stringify(selectedIdsRef.current));

    if (selectedIdsRef.current.length >= 2) {
      event.dataTransfer.setDragImage(dragCanvasRef.current, 0, 0);
    }
    else {
      let annotation = annotationsRef.current.find(x => x.id === selectedIdsRef.current[0]);
      let br = event.target.getBoundingClientRect();
      let offsetX = event.clientX - br.left;
      let offsetY = event.clientY - br.top;

      if (annotation.type === 'area') {
        let x = 0;
        let y = 0;
        let img = document.querySelector('div[data-sidebar-id="' + selectedIdsRef.current[0] + '"] img');
        if (img) {
          let width = 200;
          let height = 200 * img.height / img.width;
          dragCanvasRef.current.width = width;
          dragCanvasRef.current.height = height;
          dragContextRef.current.drawImage(img, 0, 0, width, height);
          let width1 = event.target.offsetWidth;
          let height1 = event.target.offsetHeight;

          x = offsetX * dragCanvasRef.current.width / width1;
          y = offsetY * dragCanvasRef.current.height / height1;

          if (isSidebar) {
            x = dragCanvasRef.current.width / 2;
            y = dragCanvasRef.current.height / 2;
          }
        }
        else {
          dragContextRef.current.clearRect(0, 0, dragCanvasRef.current.width, dragCanvasRef.current.height);
        }
        event.dataTransfer.setDragImage(dragCanvasRef.current, x, y);
      }
      else if (annotation.type === 'highlight') {
        renderHighlight(annotation);
        let width = event.target.offsetWidth - 10;
        let height = event.target.offsetHeight - 10;

        let x = offsetX * dragCanvasRef.current.width / width;
        let y = offsetY * dragCanvasRef.current.height / height;

        if (isSidebar) {
          x = dragCanvasRef.current.width / 2;
          y = dragCanvasRef.current.height / 2;
        }

        event.dataTransfer.setDragImage(dragCanvasRef.current, x, y);
      }
      else if (annotation.type === 'note') {

        let width = event.target.offsetWidth - 10;
        let height = event.target.offsetHeight - 10;

        let x = offsetX * 20 / width;
        let y = offsetY * 20 / height;

        x = 20 / 2;
        y = 20 / 2;

        dragNoteRef.current.style.backgroundColor = annotation.color;
        event.dataTransfer.setDragImage(dragNoteRef.current, x, y);
      }
    }
  }

  function handleAnnotationDragEnd() {
  }

  function handleToolbarModeChange(mode) {
    toggleMode(mode);
  }

  function handleToolbarColorClick(x, y) {
    props.onPopup('colorPopup', {
      x,
      y,
      selectedColor: _color
    });
  }

  function handleSidebarAnnotationSectionClick(id, section, event) {
    let ctrl = event.ctrlKey || event.metaKey;
    let shift = event.shiftKey;

    if (section === 'tags' && !ctrl && !shift) {
      return props.onClickTags(id, event);
    }

    if (section === 'highlight' && selectedIdsRef.current.length === 1 &&
      selectedIdsRef.current[0] === id) {
      if (expansionStateRef.current >= 1 && expansionStateRef.current <= 2) {
        setExpansionState(2);
      }
    }
    else {
      let selected = selectAnnotation(id, ctrl, shift, true, true);
      if (selected === 1) {
        scrollTo(annotationsRef.current.find(x => x.id === id), true, true);
        // if (section !== 'header') this.focusSidebarComment(id);
      }
    }
  }

  function handleSidebarAnnotationEditorBlur() {
    setExpansionState(1);
    document.getElementById('annotationsView').focus();
  }

  function handleSidebarAnnotationDoubleClick(id) {
    if (selectedIdsRef.current.length === 1 &&
      selectedIdsRef.current[0] === id) {
      if (expansionStateRef.current >= 1 && expansionStateRef.current <= 2) {
        setExpansionState(3);
        focusSidebarHighlight(id);
      }
    }
  }

  function handleSidebarAnnotationChange(annotation) {
    props.onUpdateAnnotation(annotation);
  }

  function handleSidebarAnnotationMenuOpen(annotationId, x, y) {
    let selectedColor = annotationsRef.current.find(x => x.id === id).color;

    props.onPopup('annotationPopup', {
      x,
      y,
      annotationId: id,
      selectedColor
    });
  }

  function handleLayerAreaSelectionStart() {
    setIsSelectingArea(true);
  }

  function handleLayerAreaCreation(position) {
    props.onAddAnnotation({
      type: 'area',
      color: _color,
      position: position
    });
  }

  function handleLayerAreaResizeStart() {
    setIsResizingArea(true);
  }

  function handleLayerAnnotationChange(annotation) {
    props.onUpdateAnnotation(annotation);
  }

  function handleLayerAnnotationMoreMenu(id, x, y) {
    let selectedColor = annotationsRef.current.find(x => x.id === id).color;

    props.onPopup('annotationPopup', {
      x,
      y,
      annotationId: id,
      selectedColor
    });
  }

  function handleLayerPointerDown(position, event) {
    pointerDownPositionRef.current = position;

    if (!event.target.closest('.canvasWrapper')) {
      return;
    }

    let intersectsWithSelected = false;
    let selectedAnnotations = annotationsRef.current.filter(x => selectedIdsRef.current.includes(x.id));

    for (let annotation of selectedAnnotations) {
      if (intersectPositions(position, annotation.position)) {
        return;
      }
    }

    if (selectionRangesRef.current.length === 1) {
      if (intersectBoundingPositions(position, selectionRangesRef.current[0].position)) {
        return;
      }
    }

    if (['note', 'area'].includes(modeRef.current)) {
      return;
    }

    setEnableSelection(true);
    setselectionRangesRef([]);
  }

  function handlePointerUp(event) {
    if (selectionRangesRef.current.length === 1) {
      if (modeRef.current === 'highlight') {
        let selectionRange = selectionRangesRef.current[0];
        props.onAddAnnotation({
          type: 'highlight',
          color: colorRef.current,
          sortIndex: selectionRange.sortIndex,
          position: selectionRange.position,
          text: selectionRange.text
        });
        setselectionRangesRef([]);
      }
    }

    if (event.target === document.getElementById('viewer')) {
      selectAnnotation(null);
      setselectionRangesRef([]);
    }

    setIsSelectingText(false);
    setIsResizingArea(false);
    setIsSelectingArea(false);
    setEnableSelection(false);

    pointerDownPositionRef.current = null;
  }

  // Layer PointerUp is called before Window PointerUp
  function handleLayerPointerUp(position, event) {
    let isRight = event.button === 2;
    let isCtrl = event.ctrlKey || event.metaKey;
    let isShift = event.shiftKey;

    if (isSelectingAreaRef.current
      || isResizingAreaRef.current
      || isSelectingTextRef.current) {
      return;
    }

    if (modeRef.current === 'note') {
      (async () => {
        // TODO: No need to hardcode note dimensions, set central point only
        position.rects[0][0] -= 10;
        position.rects[0][1] -= 10;
        position.rects[0][2] += 10;
        position.rects[0][3] += 10;

        let annotation = await props.onAddAnnotation({
          type: 'note',
          position: position,
          color: colorRef.current
        });
        // TODO: Fix delay between annotation creation and comment focus
        selectAnnotation(annotation.id, false, false, true, false);
        focusComment(annotation.id);
      })();
      setMode(null);
    }

    setIsLastClickRight(isRight);

    let selectId = getAnnotationToSelectId(position, isCtrl || isShift);
    if (selectId) {
      setselectionRangesRef([]);
      selectAnnotation(selectId, isCtrl, isShift, true, false);

      // TODO: Right click shouldn't switch to the next annotations
      if (isRight) {
        let selectedColor = annotationsRef.current.find(x => x.id === selectId).color;
        props.onPopup('annotationPopup', {
          x: event.screenX,
          y: event.screenY,
          annotationId: selectId,
          selectedColor
        });
      }
    }
    else {
      selectAnnotation(null);
    }
  }

  function handleLayerPointerMove(position) {
    // TODO: Fix selection
    if (isOver(position, annotationsRef.current)) {
      document.getElementById('viewer').classList.add('force-annotation-pointer');
      let id = getAnnotationToSelectId(position, 0);
    }
    else {
      document.getElementById('viewer').classList.remove('force-annotation-pointer');
    }

    if (pointerDownPositionRef.current && enableSelectionRef.current) {
      let selectionEndPosition = position;
      // restrictTextSelectionToPage
      if (modeRef.current === 'highlight' && selectionEndPosition.pageIndex !== pointerDownPositionRef.current.pageIndex) {
        let p = pointerDownPositionRef.current;
        selectionEndPosition = {
          pageIndex: p.pageIndex,
          rects: [[9999, 0, 9999, 0]]
        }
      }

      (async () => {
        let selectionRangesRef = await getselectionRangesRef(pointerDownPositionRef.current, selectionEndPosition);
        // Check enableSelectionRef.current again after await
        if (enableSelectionRef.current) {
          setselectionRangesRef(selectionRangesRef);
          if (selectionRangesRef.length && !isSelectingTextRef.current) {
            setIsSelectingText(true);
            selectAnnotation(null);
          }
        }
      })();
    }
  }

  function handleLayerEdgeNoteClick(id) {
    selectAnnotation(id, false, false, true, false);
  }

  function handleLayerSelectionPopupHighlight() {
    if (selectionRangesRef.current.length === 1) {

      let selectionRange = selectionRangesRef.current[0];
      props.onAddAnnotation({
        type: 'highlight',
        color: colorRef.current,
        sortIndex: selectionRange.sortIndex,
        position: selectionRange.position,
        text: selectionRange.text
      });

      setselectionRangesRef([]);
    }
  }

  function handleLayerSelectionPopupCopy() {
    let text = '';
    for (let selectionRange of selectionRangesRef.current) {
      text += selectionRange.text + '\n';
    }
    copyToClipboard(text);
  }

  return (
    <div>
      {props.askImport && <ImportBar onImport={props.onImport} onDismiss={props.onDismissImport}/>}
      <Toolbar
        toggled={_mode}
        onMode={handleToolbarModeChange}
        color={_color}
        onColorPick={handleToolbarColorClick}
      />
      <Findbar/>
      <AnnotationsView
        annotations={_annotations}
        selectedAnnotationIds={_selectedIds}
        expansionState={_expansionState}
        onClickAnnotationSection={handleSidebarAnnotationSectionClick}
        onAnnotationEditorBlur={handleSidebarAnnotationEditorBlur}
        onDoubleClickHighlight={handleSidebarAnnotationDoubleClick}
        onChange={handleSidebarAnnotationChange}
        onDragStart={handleAnnotationDragStart}
        onMenu={handleSidebarAnnotationMenuOpen}
      />
      <Layer
        selectionColor={_mode === 'highlight' ? _color : DEFAULT_SELECTION_COLOR}
        selectionPositions={_selectionPositions}
        enableSelectionPopup={!_mode}
        popupAnnotation={
          !_isSelectingText &&
          !_isDraggingAnnotation &&
          !_isSelectingArea &&
          !_isResizingArea &&
          !_isLastClickRight &&
          !_isSidebarOpen &&
          _selectedIds.length < 2 &&
          _selectedIds.length && _annotations.find(x => _selectedIds.includes(x.id))}
        annotations={_annotations}
        color={_color}
        selectedAnnotationIds={_selectedIds}
        blink={_blink}
        enableEdgeNotes={!_isResizingArea} // TODO: disable only for the current note
        enableAreaSelector={_mode === 'area' && !_selectedIds.length}
        onAreaSelectionStart={handleLayerAreaSelectionStart}
        onAreaSelection={handleLayerAreaCreation}
        onAreaResizeStart={handleLayerAreaResizeStart}
        onChange={handleLayerAnnotationChange}
        onMoreMenu={handleLayerAnnotationMoreMenu}
        onPointerDown={handleLayerPointerDown}
        onPointerUp={handleLayerPointerUp}
        onPointerMove={handleLayerPointerMove}
        onClickTags={props.onClickTags}
        onClickEdgeNote={handleLayerEdgeNoteClick}
        onDragStart={handleAnnotationDragStart}
        onDragEnd={handleAnnotationDragEnd}
        onHighlightSelection={handleLayerSelectionPopupHighlight}
        onCopySelection={handleLayerSelectionPopupCopy}
      >
      </Layer>
    </div>
  );

}

Annotator.propTypes = {
  navigateRef: PropTypes.func.isRequired,
  setAnnotationsRef: PropTypes.func.isRequired,
  setColorRef: PropTypes.func.isRequired,
  onAddAnnotation: PropTypes.func.isRequired,
  onUpdateAnnotation: PropTypes.func.isRequired,
  onDeleteAnnotations: PropTypes.func.isRequired,
  onInitialized: PropTypes.func.isRequired,
  onPopup: PropTypes.func.isRequired,
  onClickTags: PropTypes.func.isRequired,
  askImport: PropTypes.bool.isRequired,
  onImport: PropTypes.func.isRequired,
  onDismissImport: PropTypes.func.isRequired
}

export default Annotator;
