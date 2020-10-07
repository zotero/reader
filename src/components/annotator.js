'use strict';

import React, { useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import Layer from './layer';
import AnnotationsView from './annotations-view';
import Toolbar from './toolbar';
import Findbar from './findbar';
import ImportBar from './import-bar';
import { annotationColors, selectionColor } from '../lib/colors';
import {
  setLayerSelectionDragPreview,
  setLayerSingleDragPreview,
  setSidebarSingleDragPreview,
  setMultiDragPreview
} from './drag-preview';

import {
  copyToClipboard,
  intersectPositions,
  intersectBoundingPositions,
  setCaretToEnd,
  useRefState,
  getAnnotationsFromSelectionRanges,
  setDataTransferAnnotations
} from '../lib/utilities';

import { extractRange } from '../lib/extract';

// All rects in annotator.js are stored in [left, top, right, bottom] order
// where the Y axis starts from the bottom:
// [231.284, 402.126, 293.107, 410.142]

async function getSelectionRangesRef(positionFrom, positionTo) {

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
      i.toString().padStart(5, '0'),
      offset.toString().padStart(6, '0'),
      '00000'
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

const Annotator = React.forwardRef((props, ref) => {
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
  const [_isSelectedOnPointerDown, isSelectedOnPointerDownRef, setIsSelectedOnPointerDown] = useRefState(false);
  const [_promptImport, promptImport, setPromptImport] = useRefState(props.promptImport);

  const lastSelectedAnnotationIdRef = useRef(null);
  const pointerDownPositionRef = useRef(null);
  const selectionRangesRef = useRef([]);

  useImperativeHandle(ref, () => ({
    navigate,
    setAnnotations,
    setColor,
    setPromptImport
  }));

  function setSelectionRangesRef(ranges) {
    setSelectionPositions(ranges.map(r => r.position));
    selectionRangesRef.current = ranges;
  }

  function scrollSidebarTo(id) {
    let sidebarItem = document.querySelector(`div[data-sidebar-id="${id}"]`);
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

  function scrollViewerTo(position) {
    let x = position.rects[0][0];
    let y = position.rects[0][3] + 100;

    window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
      pageNumber: position.pageIndex + 1,
      destArray: [
        null,
        { name: 'XYZ' },
        x,
        y,
        null
      ]
    });
  }

  function scrollTo(location, sidebar, viewer) {
    if (sidebar && location.id) {
      scrollSidebarTo(location.id);
    }

    if (viewer && location.position) {
      scrollViewerTo(location.position);
    }
  }

  let navigate = (location) => {
    let annotation = location.id && annotationsRef.current.find(x => x.id === location.id);
    if (annotation) {
      selectAnnotation(location.id, true, false, true, true);
      if (!location.position) {
        location.position = annotation.position;
      }
    }

    makeBlink(location.position);
    scrollTo(location, true, true);
  }

  function makeBlink(position) {
    setBlink({
      id: Math.random(),
      position: position
    });
  }

  const handleKeyDownCallback = useCallback(handleKeyDown, []);
  const handlePointerUpCallback = useCallback(handlePointerUp, []);
  const handleDragEndCallback = useCallback(handleDragEnd, []);
  const handleDragStartCallback = useCallback(handleDragStart, []);
  const handleCopyCallback = useCallback(handleCopy, []);
  const handleSidebarViewChangeCallback = useCallback(handleSidebarViewChange, []);

  useEffect(() => {
    document.getElementById('viewer').setAttribute('draggable', true);

    // viewer.eventBus.off('pagesinit', onDocumentReady);
    window.addEventListener('keydown', handleKeyDownCallback);
    window.addEventListener('pointerup', handlePointerUpCallback);
    window.addEventListener('dragend', handleDragEndCallback);
    window.addEventListener('dragstart', handleDragStartCallback);
    window.addEventListener('copy', handleCopyCallback);
    window.PDFViewerApplication.eventBus.on('sidebarviewchanged', handleSidebarViewChangeCallback);

    return () => {
      window.removeEventListener('keydown', handleKeyDownCallback);
      window.removeEventListener('pointerup', handlePointerUpCallback);
      window.removeEventListener('dragend', handleDragEndCallback);
      window.removeEventListener('dragstart', handleDragStartCallback);
      window.removeEventListener('copy', handleCopyCallback);
      window.PDFViewerApplication.eventBus.off('sidebarviewchanged', handleSidebarViewChangeCallback);
    }
  }, []);

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
    if (e.key === 'c') return;
    if (e.key === 'Escape') {
      if (selectedIdsRef.current.length) {
        selectAnnotation(null);
      }
      else if (modeRef.current) {
        setMode(null);
      }

      setSelectionRangesRef([]);
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

  function handleCopy(event) {
    if (document.activeElement === document.getElementById('viewerContainer')
      || document.activeElement === document.body) {

      let annotations = [];

      if (selectionRangesRef.current.length) {
        annotations = getAnnotationsFromSelectionRanges(selectionRangesRef.current);
      }
      else if (selectedIdsRef.current.length) {
        annotations = annotationsRef.current.filter(x => selectedIdsRef.current.includes(x.id));
      }

      if (annotations.length) {
        setDataTransferAnnotations(event.clipboardData, annotations);
      }

      event.preventDefault();
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
    let isShift = event.shiftKey;
    setIsSelectedOnPointerDown(false);

    if (event.target === document.getElementById('viewer')) {

      let pointerInSelection = false;

      for (let range of selectionRangesRef.current) {
        if (intersectBoundingPositions(pointerDownPositionRef.current, range.position)) {
          pointerInSelection = true;
          break;
        }
      }

      let selectId = getAnnotationToSelectId(pointerDownPositionRef.current);
      if (selectId && !isShift && !pointerInSelection) {
        let selectAnnotation = annotationsRef.current.find(x => x.id === selectId);
        if (selectAnnotation.type !== 'note' || !selectedIdsRef.current.includes(selectId)) {
          handleLayerAnnotationDragStart(event);
          return;
        }
      }

      if (enableSelectionRef.current
        || selectionRangesRef.current.length < 1
        || !pointerInSelection) {
        event.preventDefault();
        return;
      }
    }
    else {
      return;
    }

    handleSelectionDragStart(event, pointerDownPositionRef.current);
  }

  function handleSelectionDragStart(event, pointerPosition) {
    let annotations = getAnnotationsFromSelectionRanges(selectionRangesRef.current);

    if (annotations.length > 1) {
      setMultiDragPreview(event, annotations.length);
    }
    else {
      setLayerSelectionDragPreview(event, annotations[0].position.rects, selectionColor, pointerPosition);
    }

    setDataTransferAnnotations(event.dataTransfer, annotations);
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

  function handleLayerAnnotationDragStart(event) {
    let annotations = annotationsRef.current.filter(x => selectedIdsRef.current.includes(x.id));
    if (annotations.length > 1) {
      setMultiDragPreview(event, selectedIdsRef.current.length);
    }
    else if (annotations.length) {
      setLayerSingleDragPreview(event, annotations[0]);
    }

    if (annotations.length) {
      setIsDraggingAnnotation(true);
      setEnableSelection(false);
      setDataTransferAnnotations(event.dataTransfer, annotations);
    }
  }

  function handleSidebarAnnotationDragStart(event, id) {
    setIsDraggingAnnotation(true);

    let annotations;
    if (selectedIdsRef.current.includes(id) && selectedIdsRef.current.length > 1) {
      setMultiDragPreview(event, selectedIdsRef.current.length);
      annotations = annotationsRef.current.filter(x => selectedIdsRef.current.includes(x.id));
    }
    else {
      setSidebarSingleDragPreview(event);
      annotations = [annotationsRef.current.find(x => x.id === id)];
    }

    setDataTransferAnnotations(event.dataTransfer, annotations);
  }

  function handleAnnotationDragEnd() {
  }

  function handleToolbarModeChange(mode) {
    toggleMode(mode);
  }

  function handleToolbarColorClick(x, y) {
    props.onPopup('openColorPopup', {
      x,
      y,
      colors: annotationColors,
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
    
      if (section === 'comment' && expansionStateRef.current === 3) {
        setExpansionState(2);
      }

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

  function handleSidebarAnnotationMenuOpen(id, x, y) {
    let selectedColor = annotationsRef.current.find(x => x.id === id).color;
    props.onPopup('openAnnotationPopup', { x, y, id, colors: annotationColors, selectedColor });
  }

  function handleLayerAreaSelectionStart() {
    setIsSelectingArea(true);
  }

  function handleLayerAreaCreation(position) {
    props.onAddAnnotation({
      type: 'image',
      color: colorRef.current,
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
    props.onPopup('openAnnotationPopup', { x, y, id, colors: annotationColors, selectedColor });
  }

  function handleLayerPointerDown(position, event) {
    let isLeft = event.button === 0;
    let isCtrl = event.ctrlKey || event.metaKey;
    let isShift = event.shiftKey;
    pointerDownPositionRef.current = position;

    if (!event.target.closest('.canvasWrapper')
      && !event.target.closest('.note-annotation')
      && !event.target.closest('.selectionCanvas')) {
      return;
    }

    for (let range of selectionRangesRef.current) {
      if (intersectBoundingPositions(pointerDownPositionRef.current, range.position)) {
        return;
      }
    }

    let intersectsWithSelectedAnnotations = false;
    let selectedAnnotations = annotationsRef.current.filter(x => selectedIdsRef.current.includes(x.id));
    for (let annotation of selectedAnnotations) {
      if (intersectBoundingPositions(position, annotation.position)) {
        intersectsWithSelectedAnnotations = true;
        break;
      }
    }

    let selectId = getAnnotationToSelectId(position, isCtrl || isShift);
    if (selectId && isLeft && !isShift && !intersectsWithSelectedAnnotations) {
      setSelectionRangesRef([]);
      selectAnnotation(selectId, isCtrl, isShift, true, false);
      setIsSelectedOnPointerDown(true);
      return;
    }

    // let intersectsWithSelected = false;
    // let selectedAnnotations = annotationsRef.current.filter(x => selectedIdsRef.current.includes(x.id));
    // for (let annotation of selectedAnnotations) {
    //   if (intersectPositions(position, annotation.position)) {
    //     return;
    //   }
    // }

    if (['note', 'image'].includes(modeRef.current)) {
      return;
    }

    setEnableSelection(true);
    setSelectionRangesRef([]);
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
        setSelectionRangesRef([]);
      }
    }

    if (event.target === document.getElementById('viewer')) {
      selectAnnotation(null);
      setSelectionRangesRef([]);
    }

    setIsSelectingText(false);
    setIsResizingArea(false);
    setIsSelectingArea(false);
    setEnableSelection(false);
    setIsSelectedOnPointerDown(false);

    pointerDownPositionRef.current = null;
  }

  // Layer PointerUp is called before Window PointerUp
  function handleLayerPointerUp(position, event) {
    let isRight = event.button === 2;
    let isCtrl = event.ctrlKey || event.metaKey;
    let isShift = event.shiftKey;

    if (isSelectingAreaRef.current
      || isResizingAreaRef.current
      || isSelectingTextRef.current
      || isSelectedOnPointerDownRef.current) {
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
      setSelectionRangesRef([]);
      selectAnnotation(selectId, isCtrl, isShift, true, false);

      // TODO: Right click shouldn't switch to the next annotation
      if (isRight) {
        let selectedColor = annotationsRef.current.find(x => x.id === selectId).color;
        props.onPopup('openAnnotationPopup', {
          x: event.screenX,
          y: event.screenY,
          id: selectId,
          colors: annotationColors,
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
        let selectionRangesRef = await getSelectionRangesRef(pointerDownPositionRef.current, selectionEndPosition);
        // Check enableSelectionRef.current again after await
        if (enableSelectionRef.current) {
          setSelectionRangesRef(selectionRangesRef);
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

  function handleLayerSelectionPopupHighlight(color) {
    if (selectionRangesRef.current.length === 1) {

      let selectionRange = selectionRangesRef.current[0];
      props.onAddAnnotation({
        type: 'highlight',
        color,
        sortIndex: selectionRange.sortIndex,
        position: selectionRange.position,
        text: selectionRange.text
      });

      setSelectionRangesRef([]);
    }
  }

  function handleLayerSelectionPopupCopy() {
    let text = '';
    for (let selectionRange of selectionRangesRef.current) {
      text += selectionRange.text + '\n';
    }
    copyToClipboard(text);
  }

  function handleLayerSelectionPopupAddToNote() {
    let partialAnnotations = getAnnotationsFromSelectionRanges(selectionRangesRef.current);
    let annotations = partialAnnotations.map(annotation => ({
      ...annotation,
      itemId: window.itemId,
      type: 'highlight'
    }))
    if (annotations.length) {
      props.onAddToNote(annotations);
      setSelectionRangesRef([]);
    }
  }

  return (
    <div>
      {_promptImport && <ImportBar onImport={props.onImport} onDismiss={props.onDismissImport}/>}
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
        onDragStart={handleSidebarAnnotationDragStart}
        onMenu={handleSidebarAnnotationMenuOpen}
        onMoreMenu={handleSidebarAnnotationMenuOpen}
      />
      <Layer
        selectionColor={_mode === 'highlight' ? _color : selectionColor}
        selectionPositions={_selectionPositions}
        enableSelectionPopup={!_isSelectingText && !_mode}
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
        enableAreaSelector={_mode === 'image' && !_selectedIds.length}
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
        onDragStart={handleLayerAnnotationDragStart}
        onDragEnd={handleAnnotationDragEnd}
        onHighlightSelection={handleLayerSelectionPopupHighlight}
        onCopySelection={handleLayerSelectionPopupCopy}
        onAddToNoteSelection={handleLayerSelectionPopupAddToNote}
      >
      </Layer>
    </div>
  );
});

Annotator.propTypes = {
  onAddAnnotation: PropTypes.func.isRequired,
  onUpdateAnnotation: PropTypes.func.isRequired,
  onDeleteAnnotations: PropTypes.func.isRequired,
  onPopup: PropTypes.func.isRequired,
  onClickTags: PropTypes.func.isRequired,
  promptImport: PropTypes.bool.isRequired,
  onImport: PropTypes.func.isRequired,
  onDismissImport: PropTypes.func.isRequired
}

export default Annotator;
