'use strict';

import React, { useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import Layer from './layer';
import AnnotationsView from './annotations-view';
import Toolbar from './toolbar';
import { annotationColors, selectionColor } from '../lib/colors';
import LabelPopup from './label-popup';
import {
	setLayerSelectionDragPreview,
	setLayerSingleDragPreview,
	setSidebarSingleDragPreview,
	setMultiDragPreview
} from './drag-preview';
import {
	copyToClipboard,
	setCaretToEnd,
	useRefState,
	getAnnotationsFromSelectionRanges,
	setDataTransferAnnotations,
	intersectAnnotationWithPoint,
	getPositionBoundingRect,
	isMac,
	isLinux
} from '../lib/utilities';

// Note: All rects in annotator.js are stored in [left, top, right, bottom] order
// where the Y axis starts from the bottom:
// [231.284, 402.126, 293.107, 410.142]

const NOTE_DIMENSIONS = 22;

function getModifiedSelectionRanges(selectionRanges, modifier) {
	if (!selectionRanges.length) {
		return [];
	}

	let range = selectionRanges.find(x => x.anchor);
	let anchor = {
		pageIndex: range.position.pageIndex,
		offset: range.anchorOffset
	};

	range = selectionRanges.find(x => x.head);
	let head = {
		pageIndex: range.position.pageIndex,
		offset: range.headOffset
	};
	if (modifier === 'left') {
		head.offset--;
	}
	else if (modifier === 'right') {
		head.offset++;
	}
	else if (modifier === 'up') {
		head.offset = window.extractor.getPrevLineClosestOffset(head.pageIndex, head.offset);
		if (head.offset === null) {
			return [];
		}
	}
	else if (modifier === 'down') {
		head.offset = window.extractor.getNextLineClosestOffset(head.pageIndex, head.offset);
		if (head.offset === null) {
			return [];
		}
	}
	else if (typeof modifier === 'object') {
		let position = modifier;
		head = position;
	}
	return getSelectionRanges(anchor, head);
}

function getWordSelectionRanges(position) {
	let res = window.extractor.getClosestWord(position);
	if (!res) {
		return [];
	}
	let { anchorOffset, headOffset } = res;

	let anchor = {
		pageIndex: position.pageIndex,
		offset: anchorOffset
	};

	let head = {
		pageIndex: position.pageIndex,
		offset: headOffset
	};
	return getSelectionRanges(anchor, head);
}

function getLineSelectionRanges(position) {
	let res = window.extractor.getClosestLine(position);
	if (!res) {
		return [];
	}
	let { anchorOffset, headOffset } = res;

	let anchor = {
		pageIndex: position.pageIndex,
		offset: anchorOffset
	};

	let head = {
		pageIndex: position.pageIndex,
		offset: headOffset
	};
	return getSelectionRanges(anchor, head);
}

function getSelectionRanges(anchor, head) {
	let selectionRanges = [];
	let fromPageIndex = Math.min(anchor.pageIndex, head.pageIndex);
	let toPageIndex = Math.max(anchor.pageIndex, head.pageIndex);
	let reverse = anchor.pageIndex > head.pageIndex;
	for (let i = fromPageIndex; i <= toPageIndex; i++) {
		let a, h;
		if (i === anchor.pageIndex) {
			a = anchor.offset !== undefined ? anchor.offset : [anchor.rects[0][0], anchor.rects[0][1]];
		}

		if (i === head.pageIndex) {
			h = head.offset !== undefined ? head.offset : [head.rects[0][0], head.rects[0][1]];
		}

		let selectionRange = window.extractor.extractRange({
			pageIndex: i,
			anchor: a,
			head: h,
			reverse
		});
		if (!selectionRange) {
			return [];
		}

		if (i === anchor.pageIndex) {
			selectionRange.anchor = true;
		}

		if (i === head.pageIndex) {
			selectionRange.head = true;
		}

		if (!selectionRange.collapsed) {
			// We can synchronously get page viewbox from page view, because it's already loaded when selecting
			let pageHeight = PDFViewerApplication.pdfViewer.getPageView(selectionRange.position.pageIndex).viewport.viewBox[3];
			let top = pageHeight - selectionRange.position.rects[0][3];
			if (top < 0) {
				top = 0;
			}

			// TODO: Unify all annotations sort index calculation
			let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
			selectionRange.sortIndex = [
				i.toString().slice(0, 5).padStart(5, '0'),
				offset.toString().slice(0, 6).padStart(6, '0'),
				Math.floor(top).toString().slice(0, 5).padStart(5, '0')
			].join('|');
		}

		selectionRanges.push(selectionRange);
	}
	return selectionRanges;
}

const Annotator = React.forwardRef((props, ref) => {
	// useRefState synchronously sets ref value and asynchronously sets state value.
	// Annotator component uses reference variables everywhere to immediately access
	// the latest value and eliminate the complexity of rebinding custom events.
	// useRefState state variables are used only for rendering

	const [_annotations, annotationsRef, setAnnotations] = useRefState([]);
	const [_selectedIDs, selectedIDsRef, setSelectedIDs] = useRefState([]);
	const [_expansionState, expansionStateRef, setExpansionState] = useRefState(0);
	const [_mode, modeRef, setMode] = useRefState(null);
	const [_color, colorRef, setColor] = useRefState(annotationColors[0][1]);
	const [_selectionPositions, selectionPositionsRef, setSelectionPositions] = useRefState([]);
	const [_enableSelection, enableSelectionRef, setEnableSelection] = useRefState(false);
	const [_blink, blinkRef, setBlink] = useRefState(null);
	const [_isSidebarOpen, isSidebarOpenRef, setIsSidebarOpen] = useRefState(window.PDFViewerApplication.pdfSidebar.isOpen);
	const [_isSelectingText, isSelectingTextRef, setIsSelectingText] = useRefState(false);
	const [_isDraggingAnnotation, isDraggingAnnotationRef, setIsDraggingAnnotation] = useRefState(false);
	const [_isPopupDisabled, isPopupDisabledRef, setIsPopupDisabled] = useRefState(false);
	const [_isSelectingArea, isSelectingAreaRef, setIsSelectingArea] = useRefState(false);
	const [_isResizingArea, isResizingAreaRef, setIsResizingArea] = useRefState(false);
	const [_isLastClickRight, isLastClickRightRef, setIsLastClickRight] = useRefState(false);
	const [_isSelectedOnPointerDown, isSelectedOnPointerDownRef, setIsSelectedOnPointerDown] = useRefState(false);
	const [_enableAddToNote, enableAddToNote, setEnableAddToNote] = useRefState(false);
	const [_labelPopup, labelPopup, setLabelPopup] = useRefState(null);

	const annotationsViewRef = useRef();
	const lastSelectedAnnotationIDRef = useRef(null);
	const pointerDownPositionRef = useRef(null);
	const selectionRangesRef = useRef([]);

	useImperativeHandle(ref, () => ({
		navigate,
		setAnnotations,
		setColor,
		setEnableAddToNote,
		openPageLabelPopup,
		editHighlightedText,
		clearSelector: annotationsViewRef.current.clearSelector
	}));

	function setSelectionRangesRef(ranges) {
		setSelectionPositions(ranges.filter(x => !x.collapsed).map(x => x.position));
		selectionRangesRef.current = ranges;
	}

	function hasSelection() {
		return !!selectionRangesRef.current.filter(x => !x.collapsed).length;
	}

	function scrollSidebarTo(id) {
		let sidebarItem = document.querySelector(`div[data-sidebar-id="${id}"]`);
		let container = document.getElementById('annotationsView');
		if (sidebarItem && container) {
			if (
				window.PDFViewerApplication.pdfSidebar.isOpen
				&& window.PDFViewerApplication.pdfSidebar.active !== 9
			) {
				window.PDFViewerApplication.pdfSidebar.switchView(9);
			}

			setTimeout(() => {
				sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
			}, 50);
		}
	}

	function scrollViewerTo(position) {
		let rect = getPositionBoundingRect(position);
		let spacing = 30;
		rect = [
			rect[0] - spacing,
			rect[1] - spacing,
			rect[2] + spacing,
			rect[3] + spacing
		];

		window.PDFViewerApplication.pdfLinkService.goToDestination([
			position.pageIndex,
			{ name: 'FitR' },
			...rect
		]);
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

		let id = location.id || location.annotationKey;
		let annotation = id && annotationsRef.current.find(x => x.id === id);
		if (annotation) {
			// selectAnnotation(id, true, false, true, true);
			makeBlink(annotation.position);
			scrollTo({ id, position: annotation.position }, true, true);
			return;
		}

		if (Number.isInteger(location.pageIndex)) {
			window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
				pageNumber: location.pageIndex + 1
			});
			return;
		}

		if (location.pageLabel) {
			(async function () {
				let pageIndex = await window.extractor.getPageIndexByLabel(location.pageLabel);
				if (pageIndex !== null) {
					window.PDFViewerApplication.pdfViewer.scrollPageIntoView({
						pageNumber: pageIndex + 1
					});
				}
			})();
			return;
		}

		makeBlink(location.position);
		scrollTo(location, true, true);
	};

	function makeBlink(position) {
		setBlink({
			id: Math.random(),
			position: position
		});
	}

	useEffect(() => {
		document.getElementById('viewer').setAttribute('draggable', true);

		// viewer.eventBus.off('pagesinit', onDocumentReady);
		window.addEventListener('keydown', handleKeyDown, true);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('dragend', handleDragEnd);
		window.addEventListener('dragstart', handleDragStart);
		window.addEventListener('copy', handleCopy);
		window.PDFViewerApplication.eventBus.on('sidebarviewchanged', handleSidebarViewChange);
		window.PDFViewerApplication.eventBus.on('pagerendered', handlePageRendered);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('dragend', handleDragEnd);
			window.removeEventListener('dragstart', handleDragStart);
			window.removeEventListener('copy', handleCopy);
			window.PDFViewerApplication.eventBus.off('sidebarviewchanged', handleSidebarViewChange);
			window.PDFViewerApplication.eventBus.off('pagerendered', handlePageRendered);
		};
	}, []);

	let focusSidebarHighlight = (annotationID) => {
		setTimeout(function () {
			let content = document.querySelector(
				`#annotationsView .annotation[data-sidebar-id='${annotationID}'] .highlight .content`
			);
			if (content) {
				setCaretToEnd(content);
			}
		}, 100);
	};

	let focusComment = (annotationID) => {
		setTimeout(function () {
			let content;
			if (PDFViewerApplication.pdfSidebar.isOpen) {
				content = document.querySelector(
					`#annotationsView .annotation[data-sidebar-id='${annotationID}'] .comment .content`
				);
			}
			else {
				content = document.querySelector(`#pagePopupContainer .comment .content`);
			}
			if (content) {
				setCaretToEnd(content);
			}
		}, 100);
	};

	const handleKeyDown = useCallback((e) => {
		let isMod = e.ctrlKey || e.metaKey;
		let isCtrl = e.ctrlKey;
		let isCmd = e.metaKey && isMac();
		let isAlt = e.altKey;
		let isShift = e.shiftKey;

		// This is not ideal, but the goal is to keep focus on `selectionBox`
		// when a speak out keyboard shortcut is pressed, and focus to
		// `viewerContainer` when other keys are pressed
		if (document.activeElement === window.selectionBox
			&& !isMod && !isAlt && !isShift) {
			document.getElementById('viewerContainer').focus();
		}

		if (isMod && e.key === 'c') {
			return;
		}

		if (isMod && e.key === 'a'
			&& document.activeElement
			&& document.activeElement.nodeName !== 'INPUT'
			&& !isSelectingTextRef.current
			&& !labelPopup.current) {
			setSelectedIDs(annotationsViewRef.current.getAnnotations().map(x => x.id));
		}

		if (isShift && selectionRangesRef.current.length) {
			if (e.key === 'ArrowLeft') {
				let selectionRanges = getModifiedSelectionRanges(selectionRangesRef.current, 'left');
				setSelectionRangesRef(selectionRanges);
			}
			else if (e.key === 'ArrowRight') {
				let selectionRanges = getModifiedSelectionRanges(selectionRangesRef.current, 'right');
				setSelectionRangesRef(selectionRanges);
			}
			else if (e.key === 'ArrowUp') {
				let selectionRanges = getModifiedSelectionRanges(selectionRangesRef.current, 'up');
				setSelectionRangesRef(selectionRanges);
			}
			else if (e.key === 'ArrowDown') {
				let selectionRanges = getModifiedSelectionRanges(selectionRangesRef.current, 'down');
				setSelectionRangesRef(selectionRanges);
			}
		}

		if ((isCmd || isCtrl && isLinux()) && e.key === '['
			|| (isAlt && !isMac() || isCmd) && e.key === 'ArrowLeft') {
			window.history.back();
		}

		if ((isCmd || isCtrl && isLinux()) && e.key === ']'
			|| (isAlt && !isMac() || isCmd) && e.key === 'ArrowRight') {
			window.history.forward();
		}

		// Prevent PDF.js keyboard shortcuts for unsupported operations
		// https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-shortcuts
		if (isMod && ['o', 's'].includes(e.key)) {
			e.stopPropagation();
			e.preventDefault();
		}

		if (isMod && isAlt && e.key === 'p') {
			e.stopPropagation();
		}

		if (e.key === 'Tab' && e.target === document.getElementById('viewerContainer')) {
			document.body.focus();
			e.preventDefault();
		}

		if (e.key === 'Escape') {
			PDFViewerApplication.pdfCursorTools.handTool.deactivate();

			if (selectedIDsRef.current.length) {
				selectAnnotation(null);
			}
			else if (modeRef.current) {
				setMode(null);
			}

			setSelectionRangesRef([]);
			setEnableSelection(false);
			setLabelPopup(null);
		}

		if ((e.key === 'Delete' || e.key === 'Backspace')
			&& !e.repeat
			&& e.target.closest('.comment')) {
			let id = selectedIDsRef.current[0];
			let annotation = annotationsRef.current.find(x => x.id === id);
			if (annotation && !annotation.comment) {
				props.onDeleteAnnotations([id]);
			}
		}

		if (e.target === document.getElementById('viewerContainer') || e.target === document.body) {
			// Prevent Mod + A, as it selects random things in viewer container and makes them draggable
			if (isMod && !isShift && e.key === 'a') {
				e.preventDefault();
			}
			else if (e.key === 'Enter') {
				// this.setState({expansionState: 1});
				let id = selectedIDsRef.current[0];
				if (id) {
					focusComment(id);
				}
				else if (lastSelectedAnnotationIDRef.current) {
					selectAnnotation(lastSelectedAnnotationIDRef.current, false, false, true, true);
				}
				else if (annotationsRef.current.length) {
					selectAnnotation(annotationsRef.current[0].id, false, false, true, true);
				}
			}
			else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.repeat) {
				// TODO: Auto-select the next annotation after deletion in sidebar
				let hasReadOnly = !!annotationsRef.current.find(x => selectedIDsRef.current.includes(x.id) && x.readOnly);
				if (!hasReadOnly) {
					props.onDeleteAnnotations(selectedIDsRef.current);
				}
			}
			else if (e.key === 'ArrowUp') {
				if (selectedIDsRef.current.length) {
					let annotation = selectPrevAnnotation(false, e.shiftKey);
					if (annotation) {
						scrollTo(annotation, true, true);
					}
					e.preventDefault();
				}
			}
			else if (e.key === 'ArrowDown') {
				if (selectedIDsRef.current.length) {
					let annotation = selectNextAnnotation(false, e.shiftKey);
					if (annotation) {
						scrollTo(annotation, true, true);
					}
					e.preventDefault();
				}
			}
		}
	}, []);

	const handleCopy = useCallback((event) => {
		if (document.activeElement === document.getElementById('viewerContainer')
			|| document.activeElement === document.body) {
			let annotations = [];

			if (hasSelection()) {
				annotations = getAnnotationsFromSelectionRanges(selectionRangesRef.current);
			}
			else if (selectedIDsRef.current.length) {
				annotations = annotationsRef.current.filter(x => selectedIDsRef.current.includes(x.id));
			}

			if (annotations.length) {
				setDataTransferAnnotations(event.clipboardData, annotations);
			}

			event.preventDefault();
		}
	}, []);

	const handleDragEnd = useCallback((event) => {
		setEnableSelection(false);
		setIsDraggingAnnotation(false);
	}, []);

	const handleSidebarViewChange = useCallback((event) => {
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
	}, []);

	const handlePageRendered = useCallback((event) => {
		// For now just deselect text when page is re-rendered
		// TODO: Re-render selection layer after page zoom change or resize,
		//  figure out what to do when multiple pages are selected
		//  and some of them are unloaded
		for (let selectionRange of selectionRangesRef.current) {
			if (selectionRange.position.pageIndex === event.pageNumber - 1) {
				setSelectionRangesRef([]);
			}
		}
	}, []);

	const handleDragStart = useCallback((event) => {
		let isShift = event.shiftKey;
		setIsSelectedOnPointerDown(false);

		if (!pointerDownPositionRef.current) {
			// Prevent dragging the gray area of #viewer
			if (event.target === document.getElementById('viewer')) {
				event.preventDefault();
			}
			return;
		}

		if (event.target === document.getElementById('viewer')) {
			let pointerInSelection = false;

			for (let range of selectionRangesRef.current) {
				if (intersectAnnotationWithPoint(range.position, pointerDownPositionRef.current)) {
					pointerInSelection = true;
					break;
				}
			}

			let selectID = getAnnotationToSelectID(pointerDownPositionRef.current);
			if (selectID && !isShift && !pointerInSelection) {
				let selectAnnotation = annotationsRef.current.find(x => x.id === selectID);
				if (selectAnnotation.type !== 'note' || !selectedIDsRef.current.includes(selectID)) {
					handleLayerAnnotationDragStart(event);
					return;
				}
			}

			if (enableSelectionRef.current
				|| !hasSelection()
				|| !pointerInSelection) {
				event.preventDefault();
				return;
			}
		}
		else {
			return;
		}

		handleSelectionDragStart(event, pointerDownPositionRef.current);
	}, []);

	const handleSelectionDragStart = useCallback((event, pointerPosition) => {
		let annotations = getAnnotationsFromSelectionRanges(selectionRangesRef.current);

		if (annotations.length > 1) {
			setMultiDragPreview(event, annotations.length);
		}
		else {
			setLayerSelectionDragPreview(event, annotations[0].position.rects, selectionColor, pointerPosition);
		}

		setDataTransferAnnotations(event.dataTransfer, annotations);
	}, []);

	function toggleMode(m) {
		if (modeRef.current === m) {
			setMode(null);
		}
		else {
			setMode(m);
		}

		selectAnnotation(null);
	}

	function getAnnotationToSelectID(position, hasModifier) {
		let found = annotationsRef.current.filter(x => intersectAnnotationWithPoint(x.position, position));
		if (!found.length) {
			return;
		}

		let selectedID = null;

		function getAnnotationAreaSize(annotation) {
			let areaSize = 0;
			for (let rect of annotation.position.rects) {
				areaSize += (rect[2] - rect[0]) * (rect[3] - rect[1]);
			}
			return areaSize;
		}

		found.sort((a, b) => {
			let aSize, bSize;

			if (a.position.rects) {
				aSize = getAnnotationAreaSize(a);
			}
			else if (a.position.paths) {
				aSize = 0;
			}

			if (b.position.rects) {
				bSize = getAnnotationAreaSize(b);
			}
			else if (b.position.paths) {
				bSize = 0;
			}

			return aSize - bSize;
		});

		if (hasModifier) {
			return found[0].id;
		}

		let indexOfCurrentID = found.indexOf(found.find(annotation => selectedIDsRef.current.slice(-1)[0] === annotation.id));

		if (indexOfCurrentID >= 0) {
			if (indexOfCurrentID < found.length - 1) {
				selectedID = found[indexOfCurrentID + 1].id;
			}
			else {
				if (found.length) {
					selectedID = found[0].id;
				}
				// selectedID = null;
			}
		}
		else if (found.length) {
			selectedID = found[0].id;
		}

		return selectedID;
	}

	function selectPrevAnnotation(ctrl, shift) {
		let lastID = selectedIDsRef.current.slice(-1)[0];
		if (lastID) {
			let annotationIndex = annotationsRef.current.findIndex(x => x.id === lastID);
			if (annotationIndex - 1 >= 0) {
				let nextAnnotation = annotationsRef.current[annotationIndex - 1];
				let prevID = nextAnnotation.id;
				selectAnnotation(prevID, ctrl, shift, true, true);
				return nextAnnotation;
			}
			else {
				scrollTo(annotationsRef.current.find(x => x.id === lastID), true, true);
			}
		}
	}

	function selectNextAnnotation(ctrl, shift) {
		let lastID = selectedIDsRef.current.slice(-1)[0];
		if (lastID) {
			let annotationIndex = annotationsRef.current.findIndex(x => x.id === lastID);
			if (annotationsRef.current.length > annotationIndex + 1) {
				let nextAnnotation = annotationsRef.current[annotationIndex + 1];
				let nextID = nextAnnotation.id;
				selectAnnotation(nextID, ctrl, shift, true, true);
				return nextAnnotation;
			}
			else {
				scrollTo(annotationsRef.current.find(x => x.id === lastID), true, true);
			}
		}
	}

	function selectAnnotation(id, ctrl, shift, focusSidebar, focusViewer) {
		if (!id) {
			setSelectedIDs([]);
			return 0;
		}
		let selectedIDs = selectedIDsRef.current.slice();
		if (shift && selectedIDs.length) {
			let annotationIndex = annotationsRef.current.findIndex(x => x.id === id);
			let lastSelectedIndex = annotationsRef.current.findIndex(x => x.id === selectedIDs.slice(-1)[0]);
			let selectedIndices = selectedIDs.map(id => annotationsRef.current.findIndex(annotation => annotation.id === id));
			let minSelectedIndex = Math.min(...selectedIndices);
			let maxSelectedIndex = Math.max(...selectedIndices);
			if (annotationIndex < minSelectedIndex) {
				for (let i = annotationIndex; i < minSelectedIndex; i++) {
					selectedIDs.push(annotationsRef.current[i].id);
				}
			}
			else if (annotationIndex > maxSelectedIndex) {
				for (let i = maxSelectedIndex + 1; i <= annotationIndex; i++) {
					selectedIDs.push(annotationsRef.current[i].id);
				}
			}
			else {
				for (let i = Math.min(annotationIndex, lastSelectedIndex); i <= Math.max(annotationIndex, lastSelectedIndex); i++) {
					if (i === lastSelectedIndex) continue;
					let id = annotationsRef.current[i].id;
					if (!selectedIDs.includes(id)) {
						selectedIDs.push(id);
					}
				}
			}
		}
		else if (ctrl && selectedIDs.length) {
			let existingIndex = selectedIDs.indexOf(id);
			if (existingIndex >= 0) {
				selectedIDs.splice(existingIndex, 1);
			}
			else {
				selectedIDs.push(id);
			}
		}
		else {
			selectedIDs = [id];
		}

		if (JSON.stringify(selectedIDsRef.current) === JSON.stringify(selectedIDs)) return 0;

		setSelectedIDs(selectedIDs);
		if (selectedIDs.length >= 2) {
			setExpansionState(0);
		}
		else {
			setExpansionState(1);
		}

		lastSelectedAnnotationIDRef.current = selectedIDs.slice(-1)[0];

		if (focusSidebar || focusViewer) {
			let annotation = annotationsRef.current.find(x => x.id === selectedIDs.slice(-1)[0]);
			scrollTo(annotation, focusSidebar, focusViewer);
		}

		return selectedIDs.length;
	}

	const handleLayerAnnotationDragStart = useCallback((event) => {
		let isCtrl = event.ctrlKey || event.metaKey;

		if (isCtrl) {
			event.preventDefault();
			return;
		}

		let annotations = annotationsRef.current.filter(x => selectedIDsRef.current.includes(x.id));
		// If some annotations are ink and some not, filter only ink annotations
		// and allow to drag, otherwise cancel
		let forceMulti = false;
		if (annotations.some(x => x.type === 'ink')) {
			if (annotations.some(x => x.type !== 'ink')) {
				annotations = annotations.filter(x => x.type !== 'ink');
				forceMulti = true;
			}
			else {
				event.preventDefault();
				return;
			}
		}

		if (annotations.length > 1 || forceMulti) {
			setMultiDragPreview(event, selectedIDsRef.current.length);
		}
		else if (annotations.length) {
			setLayerSingleDragPreview(event, annotations[0]);
		}

		if (annotations.length) {
			setIsDraggingAnnotation(true);
			setIsPopupDisabled(true);
			setEnableSelection(false);
			setDataTransferAnnotations(event.dataTransfer, annotations);
		}
	}, []);

	const handleSidebarAnnotationDragStart = useCallback((event, id) => {
		setIsDraggingAnnotation(true);

		let annotations;
		if (selectedIDsRef.current.includes(id) && selectedIDsRef.current.length > 1) {
			annotations = annotationsRef.current.filter(x => selectedIDsRef.current.includes(x.id));
		}
		else {
			annotations = [annotationsRef.current.find(x => x.id === id)];
		}

		// If some annotations are ink and some not, filter only ink annotations
		// and allow to drag, otherwise cancel
		let forceMulti = false;
		if (annotations.some(x => x.type === 'ink')) {
			if (annotations.some(x => x.type !== 'ink')) {
				annotations = annotations.filter(x => x.type !== 'ink');
				forceMulti = true;
			}
			else {
				event.preventDefault();
				return;
			}
		}

		if (annotations.length > 1 || forceMulti) {
			setMultiDragPreview(event, annotations.length);
		}
		else {
			setSidebarSingleDragPreview(event);
		}

		setDataTransferAnnotations(event.dataTransfer, annotations);
	}, []);

	const handleAnnotationDragEnd = useCallback(() => {
	}, []);

	const handleToolbarModeChange = useCallback((mode) => {
		PDFViewerApplication.pdfCursorTools.handTool.deactivate();
		toggleMode(mode);
	}, []);

	const handleToolbarColorClick = useCallback((elementID) => {
		props.onPopup('openColorPopup', {
			elementID,
			colors: annotationColors,
			selectedColor: colorRef.current
		});
	}, []);

	const handleSidebarAnnotationSectionClick = useCallback((id, section, event) => {
		let ctrl = event.ctrlKey || event.metaKey;
		let shift = event.shiftKey;

		let annotation = annotationsRef.current.find(x => x.id === id);
		if (section === 'tags' && !ctrl && !shift && !annotation.readOnly) {
			return props.onClickTags(id, event);
		}

		if (section === 'highlight' && selectedIDsRef.current.length === 1
			&& selectedIDsRef.current[0] === id) {
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
	}, []);

	const handleSidebarAnnotationEditorBlur = useCallback(() => {
		setExpansionState(1);
		document.getElementById('annotationsView').focus();
	}, []);

	const handleSidebarAnnotationDoubleClick = useCallback((id) => {
		if (selectedIDsRef.current.length === 1
			&& selectedIDsRef.current[0] === id) {
			if (expansionStateRef.current >= 1 && expansionStateRef.current <= 2) {
				setExpansionState(3);
				focusSidebarHighlight(id);
			}
		}
	}, []);

	const handleSidebarAnnotationChange = useCallback((annotation) => {
		props.onUpdateAnnotations([annotation]);
	}, []);

	const handleSidebarAnnotationMenuOpen = useCallback((id, x, y, moreButton) => {
		let selectedColor;
		let ids = [id];

		if (moreButton || selectedIDsRef.current.length === 1) {
			selectedColor = annotationsRef.current.find(x => x.id === id).color;
		}

		if (!moreButton && selectedIDsRef.current.includes(id)) {
			ids = selectedIDsRef.current;
		}

		let readOnly = annotationsRef.current.some(x => ids.includes(x.id) && x.readOnly);
		let enableAddToNote = !annotationsRef.current.some(x => ids.includes(x.id) && x.type === 'ink');
		let enableEditHighlightedText = ids.length === 1 && annotationsRef.current.find(x => x.id === ids[0] && x.type === 'highlight');

		props.onPopup('openAnnotationPopup', {
			x,
			y,
			standalone: moreButton,
			currentID: id,
			inPage: false,
			ids,
			colors: annotationColors,
			selectedColor,
			readOnly,
			enableAddToNote,
			enableEditPageNumber: true,
			enableEditHighlightedText,
		});
	}, []);

	const handleLayerAreaSelectionStart = useCallback(() => {
		setIsSelectingArea(true);
	}, []);

	const handleLayerAreaCreation = useCallback((position) => {
		props.onAddAnnotation({
			type: 'image',
			color: colorRef.current,
			position: position
		});
	}, []);

	const handleLayerAreaResizeStart = useCallback(() => {
		setIsResizingArea(true);
	}, []);

	const handleLayerAnnotationChange = useCallback((annotation) => {
		props.onUpdateAnnotations([annotation]);
	}, []);

	const handleLayerAnnotationMoreMenu = useCallback((id, x, y) => {
		let annotation = annotationsRef.current.find(x => x.id === id);
		let selectedColor = annotation.color;
		let enableAddToNote = annotation.type !== 'ink';
		props.onPopup('openAnnotationPopup', {
			x,
			y,
			standalone: true,
			inPage: true,
			currentID: id,
			ids: [id],
			colors: annotationColors,
			selectedColor,
			enableAddToNote,
			enableEditPageNumber: true,
		});
	}, []);

	function openPagePopup(hasSelection, event) {
		props.onPopup('openPagePopup', {
			x: event.screenX,
			y: event.screenY,
			text: hasSelection && selectionRangesRef.current.map(range => range.text).join('\n'),
			isZoomAuto: PDFViewerApplication.pdfViewer.currentScaleValue === 'auto',
			isZoomPageWidth: PDFViewerApplication.pdfViewer.currentScaleValue === 'page-width',
			isZoomPageHeight: PDFViewerApplication.pdfViewer.currentScaleValue === 'page-fit',
			enablePrevPage: PDFViewerApplication.pdfViewer.currentPageNumber > 1,
			enableNextPage: PDFViewerApplication.pdfViewer.currentPageNumber < PDFViewerApplication.pdfViewer.pagesCount
		});
	}

	function intersectsWithSelectedAnnotations(position) {
		return !!annotationsRef.current
		.filter(x => selectedIDsRef.current.includes(x.id))
		.find(x => intersectAnnotationWithPoint(x.position, position));
	}

	function intersectsWithSelectedText(position) {
		for (let range of selectionRangesRef.current) {
			if (intersectAnnotationWithPoint(range.position, position)) {
				return true;
			}
		}
		return false;
	}

	const handleLayerPointerDown = useCallback((position, event) => {
		let isRight = event.button === 2;
		let isLeft = event.button === 0;
		let isCtrl = event.ctrlKey || event.metaKey;
		let isShift = event.shiftKey;

		pointerDownPositionRef.current = position;

		setIsPopupDisabled(false);

		if (event.detail === 2) {
			let selectionRanges = getWordSelectionRanges(position);
			setSelectionRangesRef(selectionRanges);
			return;
		}
		else if (event.detail === 3) {
			let selectionRanges = getLineSelectionRanges(position);
			setSelectionRangesRef(selectionRanges);
			return;
		}

		if (isShift && selectionRangesRef.current.length) {
			setIsSelectingText(true);
			setEnableSelection(true);
			let selectionRanges = getModifiedSelectionRanges(selectionRangesRef.current, position);
			setSelectionRangesRef(selectionRanges);
			return;
		}

		if (PDFViewerApplication.pdfCursorTools.handTool.active) {
			return true;
		}

		if (!event.target.closest('.page')
			&& !event.target.closest('.note-annotation')) {
			return;
		}

		if (event.target.classList.contains('internalLink')) {
			setIsSelectedOnPointerDown(true);
			return;
		}

		setIsLastClickRight(isRight);

		if (isLeft && modeRef.current === 'note') {
			(async () => {
				position.rects[0][0] -= NOTE_DIMENSIONS / 2;
				position.rects[0][1] -= NOTE_DIMENSIONS / 2;
				position.rects[0][2] += NOTE_DIMENSIONS / 2;
				position.rects[0][3] += NOTE_DIMENSIONS / 2;

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
			return;
		}

		if (intersectsWithSelectedText(position)) {
			if (isRight) {
				openPagePopup(true, event);
			}
			return;
		}

		let selectID = getAnnotationToSelectID(position, isCtrl || isShift);
		if ((isLeft || isRight)
			&& selectID
			&& (!isShift || selectedIDsRef.current.length)
			&& (isCtrl || !intersectsWithSelectedAnnotations(position))) {
			let selected = selectAnnotation(selectID, isCtrl, isShift, true, false);
			if (selected === 1) {
				let annotation = annotationsRef.current.find(x => x.id === selectedIDsRef.current[0]);
				if (!annotation.comment) {
					focusComment(annotation.id);
				}
			}
			setIsSelectedOnPointerDown(true);
		}

		if (!isCtrl && !selectID) {
			selectAnnotation(null);
		}

		if (isRight && selectID) {
			let readOnly = !!annotationsRef.current.find(x => selectedIDsRef.current.includes(x.id) && x.readOnly);
			let enableAddToNote = !annotationsRef.current.some(x => selectedIDsRef.current.includes(x.id) && x.type === 'ink');
			let selectedColor;
			if (annotationsRef.current.length === 1) {
				selectedColor = annotationsRef.current[0].color;
			}
			props.onPopup('openAnnotationPopup', {
				x: event.screenX,
				y: event.screenY,
				clientX: event.clientX,
				clientY: event.clientY,
				standalone: false,
				inPage: true,
				currentID: selectID,
				ids: selectedIDsRef.current,
				readOnly,
				colors: annotationColors,
				selectedColor,
				enableAddToNote
			});
		}

		if (isRight && !selectedIDsRef.current.length) {
			openPagePopup(false, event);
		}

		if (isLeft
			&& !isCtrl
			&& !['note', 'image'].includes(modeRef.current)
			&& (!selectedIDsRef.current.length || isShift)) {
			setEnableSelection(true);
		}

		setSelectionRangesRef([]);
	}, []);

	const handlePointerUp = useCallback((event) => {
		if (modeRef.current === 'highlight') {
			let ranges = selectionRangesRef.current.filter(x => !x.collapsed);
			for (let range of ranges) {
				props.onAddAnnotation({
					type: 'highlight',
					color: colorRef.current,
					sortIndex: range.sortIndex,
					position: range.position,
					text: range.text
				});
			}
			setSelectionRangesRef([]);
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
	}, []);

	// Layer PointerUp is called before Window PointerUp
	const handleLayerPointerUp = useCallback((position, event) => {
		let isLeft = event.button === 0;
		let isRight = event.button === 2;
		let isCtrl = event.ctrlKey || event.metaKey;
		let isShift = event.shiftKey;

		// Make selected text available for screen readers
		let text = '';
		for (let selectionRange of selectionRangesRef.current) {
			text += selectionRange.text + '\n';
		}
		window.selectionBox.value = text;
		if (text) {
			window.selectionBox.select();
		}

		// Trigger async page label extraction to already have the label in case
		// dragging would be initiated
		window.extractor.getPageLabel(position.pageIndex);

		if (isSelectingAreaRef.current
			|| isResizingAreaRef.current
			|| isSelectingTextRef.current
			|| isSelectedOnPointerDownRef.current) {
			return;
		}

		// This does annotation selection (or switches to the next overlapped annotation)
		// when it can be done on pointer down because we don't know yet whether
		// the current annotation or text selection will be dragged or just clicked
		let selectID = getAnnotationToSelectID(position, isCtrl || isShift);
		if (isLeft && selectID) {
			setSelectionRangesRef([]);
			selectAnnotation(selectID, isCtrl, isShift, true, false);
		}
	}, []);

	const handleLayerPointerMove = useCallback((position, event) => {
		let isShift = event.shiftKey;

		let overAnnotation = (
			(!isShift || selectedIDsRef.current.length)
			&& annotationsRef.current.find(x => intersectAnnotationWithPoint(x.position, position))
		);

		let textPosition = window.pageTextPositions[position.pageIndex];
		let overText = (
			!['note', 'image'].includes(modeRef.current)
			&& (!intersectsWithSelectedText(position) || isShift)
			&& (textPosition && intersectAnnotationWithPoint(textPosition, position))
			|| isSelectingTextRef.current
		);

		let viewer = document.getElementById('viewer');
		if (overAnnotation) {
			viewer.classList.add('cursor-pointer');
			viewer.classList.remove('cursor-text');
			viewer.classList.remove('cursor-text-selecting');
		}
		else if (overText) {
			viewer.classList.add('cursor-text');
			if (isSelectingTextRef.current) {
				viewer.classList.add('cursor-text-selecting');
			}
			viewer.classList.remove('cursor-pointer');
		}
		else {
			viewer.classList.remove('cursor-pointer');
			viewer.classList.remove('cursor-text');
			viewer.classList.remove('cursor-text-selecting');
		}

		if (pointerDownPositionRef.current && enableSelectionRef.current) {
			setIsSelectingText(true);
			if (selectionRangesRef.current.length) {
				let selectionRanges = getModifiedSelectionRanges(selectionRangesRef.current, position);
				setSelectionRangesRef(selectionRanges);
			}
			else {
				let selectionRanges = getSelectionRanges(pointerDownPositionRef.current, position);
				setSelectionRangesRef(selectionRanges);
			}
		}
	}, []);

	const handleLayerEdgeNoteClick = useCallback((id) => {
		selectAnnotation(id, false, false, true, false);
	}, []);

	const handleLayerSelectionPopupHighlight = useCallback((color) => {
		let ranges = selectionRangesRef.current.filter(x => !x.collapsed);
		for (let range of ranges) {
			props.onAddAnnotation({
				type: 'highlight',
				color,
				sortIndex: range.sortIndex,
				position: range.position,
				text: range.text
			});
		}
		setSelectionRangesRef([]);
	}, []);

	const handleLayerSelectionPopupCopy = useCallback(() => {
		let text = '';
		for (let selectionRange of selectionRangesRef.current) {
			text += selectionRange.text + '\n';
		}
		copyToClipboard(text);
	}, []);

	const handleLayerSelectionPopupAddToNote = useCallback(() => {
		let partialAnnotations = getAnnotationsFromSelectionRanges(selectionRangesRef.current);
		let annotations = partialAnnotations.map(annotation => ({
			...annotation,
			attachmentItemID: window.itemID,
			type: 'highlight'
		}));
		if (annotations.length) {
			props.onAddToNote(annotations);
			setSelectionRangesRef([]);
		}
	}, []);

	const handlePageLabelDoubleClick = useCallback((id) => {
		openPageLabelPopup({
			standalone: true,
			currentID: id,
			inPage: !isSidebarOpenRef.current
		});
	}, []);

	const handlePageLabelPopupClose = useCallback(() => {
		setLabelPopup(null);
	}, []);

	const handlePageLabelPopupUpdate = useCallback(async (type, pageLabel) => {
		let annotationsToUpdate = [];
		if (type === 'auto') {
			// TODO: Don't reset page labels if they can't be reliably extracted from text
			setLabelPopup(null);
			let annotations = annotationsRef.current;
			for (let annotation of annotations) {
				annotationsToUpdate.push({
					id: annotation.id,
					pageLabel: await window.extractor.getPageLabel(annotation.position.pageIndex)
				});
			}
			props.onUpdateAnnotations(annotationsToUpdate);
			return;
		}

		if (!pageLabel) {
			return;
		}

		let annotation = annotationsRef.current.find(x => x.id === labelPopup.current.currentID);
		if (!annotation) {
			return;
		}
		let pageIndex = annotation.position.pageIndex;

		let isNumeric = parseInt(pageLabel) == pageLabel;

		if (type === 'single' || !isNumeric && type !== 'selected') {
			if (!annotation.readOnly) {
				annotation.pageLabel = pageLabel;
				annotationsToUpdate = [annotation];
			}
		}
		else if (type === 'selected' && !isNumeric) {
			let annotations = annotationsRef.current.filter(x => !x.readOnly);
			annotationsToUpdate = annotations.filter(x => selectedIDsRef.current.includes(x.id));
			for (let annotation of annotationsToUpdate) {
				annotation.pageLabel = pageLabel;
			}
		}
		else {
			let annotations = annotationsRef.current.filter(x => !x.readOnly);
			switch (type) {
				case 'selected':
					annotationsToUpdate = annotations.filter(x => selectedIDsRef.current.includes(x.id));
					break;
				case 'page':
					annotationsToUpdate = annotations.filter(x => x.position.pageIndex === pageIndex);
					break;
				case 'from':
					annotationsToUpdate = annotations.filter(x => x.position.pageIndex >= pageIndex);
					break;
				case 'all':
					annotationsToUpdate = annotations;
					break;
			}

			pageLabel = parseInt(pageLabel);

			for (let annotation of annotationsToUpdate) {
				let newPageLabel = pageLabel + (annotation.position.pageIndex - pageIndex);
				if (newPageLabel < 1) {
					continue;
				}
				annotation.pageLabel = newPageLabel.toString();
			}
		}

		setLabelPopup(null);

		props.onUpdateAnnotations(annotationsToUpdate);
	}, []);

	async function openPageLabelPopup({ currentID, standalone, clientX, clientY, inPage }) {
		let annotations = [];

		let annotation = annotationsRef.current.find(x => x.id === currentID);
		if (!annotation) {
			return;
		}
		if (standalone || !selectedIDsRef.current.length) {
			annotations = [annotation];
		}
		else {
			annotations = annotationsRef.current.filter(x => selectedIDsRef.current.includes(x.id));
		}

		if (annotations.some(x => x.readOnly)) {
			return;
		}

		annotations.sort((a, b) => a.position.pageIndex - b.position.pageIndex);

		let single = annotations.length === 1;
		let selected = annotations.length > 1;

		let currentPageAnnotations = annotationsRef.current.filter(x => x.position.pageIndex === annotations[0].position.pageIndex);
		let fromCurrentPageAnnotations = annotationsRef.current.filter(x => x.position.pageIndex >= annotations[0].position.pageIndex);

		let page = currentPageAnnotations.some(x => !annotations.includes(x));
		let from = fromCurrentPageAnnotations.some(x => !annotations.includes(x));
		let all = annotationsRef.current.length !== currentPageAnnotations.length && annotationsRef.current.length !== fromCurrentPageAnnotations.length;

		let checked;

		if (from) {
			checked = 'from';
		}
		else if (all) {
			checked = 'all';
		}
		else if (page) {
			checked = 'page';
		}
		else if (selected) {
			checked = 'selected';
		}
		else {
			checked = 'single';
		}
		let rect;

		if (inPage) {
			let anchorNode = document.querySelector(`#viewerContainer [data-annotation-id="${currentID}"] .page .label`);
			if (annotations.length > 1 || !anchorNode) {
				rect = [clientX, clientY, clientX, clientY];
			}
			else {
				rect = anchorNode.getBoundingClientRect();
				rect = [rect.left, rect.top, rect.right, rect.bottom];
			}
		}
		else if (isSidebarOpenRef.current) {
			let anchorNode = document.querySelector(`#sidebarContainer [data-annotation-id="${currentID}"] .page .label`);
			rect = anchorNode.getBoundingClientRect();
			rect = [rect.left, rect.top, rect.right, rect.bottom];
		}

		let autoPageLabel = await window.extractor.getPageLabel(annotation.position.pageIndex);

		setLabelPopup({
			rect,
			currentID,
			standalone,
			checked,
			pageLabel: annotation.pageLabel,
			autoPageLabel,
			single,
			selected,
			page,
			from,
			all
		});
	}

	function editHighlightedText({ currentID }) {
		window.PDFViewerApplication.pdfSidebar.open();
		selectAnnotation(currentID, false, false, true, true);
		setTimeout(() => {
			let node = document.querySelector(`#sidebarContainer [data-annotation-id="${currentID}"] .content`);
			var clickEvent = document.createEvent('MouseEvents');
			clickEvent.initEvent('dblclick', true, true);
			node.dispatchEvent(clickEvent);
			node.focus();
		}, 50);
	}

	function handleSelectorMenuOpen(data) {
		props.onPopup('openSelectorPopup', data);
	}

	return (
		<div>
			<Toolbar
				toggled={_mode}
				onMode={handleToolbarModeChange}
				color={_color}
				onColorPick={handleToolbarColorClick}
			/>
			<AnnotationsView
				ref={annotationsViewRef}
				annotations={_annotations}
				selectedAnnotationIDs={_selectedIDs}
				expansionState={_expansionState}
				onClickAnnotationSection={handleSidebarAnnotationSectionClick}
				onAnnotationEditorBlur={handleSidebarAnnotationEditorBlur}
				onDoubleClickHighlight={handleSidebarAnnotationDoubleClick}
				onDoubleClickPageLabel={handlePageLabelDoubleClick}
				onChange={handleSidebarAnnotationChange}
				onDragStart={handleSidebarAnnotationDragStart}
				onMenu={handleSidebarAnnotationMenuOpen}
				onSelectorMenu={handleSelectorMenuOpen}
			/>
			<Layer
				selectionColor={_mode === 'highlight' ? _color : selectionColor}
				selectionPositions={_selectionPositions}
				enableSelectionPopup={!_isSelectingText && !_mode && !_isLastClickRight}
				enableAddToNote={_enableAddToNote}
				popupAnnotation={
					!_isPopupDisabled
					&& !_isSelectingText
					&& !_isDraggingAnnotation
					&& !_isSelectingArea
					&& !_isResizingArea
					&& !_isLastClickRight
					&& !_isSidebarOpen
					&& _selectedIDs.length < 2
					&& _selectedIDs.length && _annotations.find(x => _selectedIDs.includes(x.id))}
				annotations={_annotations}
				color={_color}
				selectedAnnotationIDs={_selectedIDs}
				blink={_blink}
				enableEdgeNotes={!_isResizingArea} // TODO: disable only for the current note
				enableAreaSelector={_mode === 'image' && !_selectedIDs.length}
				onAreaSelectionStart={handleLayerAreaSelectionStart}
				onAreaSelection={handleLayerAreaCreation}
				onAreaResizeStart={handleLayerAreaResizeStart}
				onChange={handleLayerAnnotationChange}
				onMoreMenu={handleLayerAnnotationMoreMenu}
				onPointerDown={handleLayerPointerDown}
				onPointerUp={handleLayerPointerUp}
				onPointerMove={handleLayerPointerMove}
				onClickTags={props.onClickTags}
				onDoubleClickPageLabel={handlePageLabelDoubleClick}
				onClickEdgeNote={handleLayerEdgeNoteClick}
				onDragStart={handleLayerAnnotationDragStart}
				onDragEnd={handleAnnotationDragEnd}
				onHighlightSelection={handleLayerSelectionPopupHighlight}
				onCopySelection={handleLayerSelectionPopupCopy}
				onAddToNoteSelection={handleLayerSelectionPopupAddToNote}
			/>
			{_labelPopup && <LabelPopup
				data={_labelPopup}
				onClose={handlePageLabelPopupClose}
				onUpdate={handlePageLabelPopupUpdate}
			/>}
		</div>
	);
});

export default Annotator;
