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
	isLinux,
	clearSelection
} from '../lib/utilities';
import { p2v, p2v as p2vc } from '../lib/coordinates';

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

class FocusManager {
	constructor(options) {
		this.options = options;
		this.zone = null;
		this.zones = [
			{
				id: 'label-popup-input',
				selector: '#labelPopup input[type="text"]'
			},
			{
				id: 'label-popup-checkbox',
				selector: '#labelPopup input[type="checkbox"]'
			},
			{
				id: 'label-popup-radios',
				selector: '#labelPopup input[type="radio"]'
			},
			{
				id: 'label-popup-button',
				selector: '#labelPopup button'
			},
			{
				id: 'popup-selection',
				selector: '#selection-menu [tabindex="-1"]'
			},
			{
				id: 'toolbar',
				selector: '#toolbarViewer [tabindex="-1"]:not(:disabled)'
			},
			{
				id: 'findbar-input',
				selector: '#findbar:not(.hidden) #findInput'
			},
			{
				id: 'findbar-navigation',
				selector: '#findbar:not(.hidden) #findbarInputContainer .splitToolbarButton button'
			},
			{
				id: 'findbar-options',
				selector: '#findbar:not(.hidden) #findOptions input'
			},
			{
				id: 'sidebar-buttons',
				selector: '#outerContainer.sidebarOpen #toolbarSidebar button:not(:disabled)'
			},
			{
				id: 'sidebar-search',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) #searchInput'
			},
			{
				id: 'sidebar-thumbnails',
				selector: '#outerContainer.sidebarOpen #thumbnailView:not(.hidden) a'
			},
			{
				id: 'sidebar-outline',
				selector: '#outerContainer.sidebarOpen #outlineView:not(.hidden) > .treeItem > a, #outerContainer.sidebarOpen #outlineView:not(.hidden) .treeItemToggler:not(.treeItemsHidden) ~ .treeItems > .treeItem > a'
			},
			{
				id: 'sidebar-annotation',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) #annotations .annotation'
			},
			{
				id: 'sidebar-annotation-dots',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) .annotation.selected .preview:not(.read-only) .more'
			},
			{
				id: 'sidebar-annotation-highlight',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) .annotation.selected .preview:not(.read-only) .highlight .content[contenteditable="true"]'
			},
			{
				id: 'sidebar-annotation-comment',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) .annotation.selected .preview:not(.read-only) .comment .content'
			},
			{
				id: 'sidebar-annotation-tags',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) .annotation.selected .preview:not(.read-only) .tags'
			},
			{
				id: 'sidebar-selector',
				selector: '#outerContainer.sidebarOpen #annotationsView:not(.hidden) #selector [tabindex="-1"]'
			},
			{
				id: 'view-annotation',
				selector: '#viewerContainer'
			},
			{
				id: 'view-annotation-dots',
				selector: '#outerContainer:not(.sidebarOpen) #viewerContainer .preview:not(.read-only) .more'
			},
			{
				id: 'view-annotation-comment',
				selector: '#outerContainer:not(.sidebarOpen) #viewerContainer .preview:not(.read-only) .comment .content'
			},
			{
				id: 'view-annotation-tags',
				selector: '#outerContainer:not(.sidebarOpen) #viewerContainer .preview:not(.read-only) .tags'
			},
		];

		window.addEventListener('focus', this.onFocus, true);
	}

	onFocus = (event) => {
		if (event.target === window) {
			return;
		}

		this.zone = null;
		if (event.target.id === 'viewerContainer') {
			if (this.options.selectedIDsRef.current.length) {
				this.zone = this.zones.find(x => x.id === 'view-annotation');
			}
			return;
		}

		loop1: for (let zone of this.zones) {
			let nodes = Array.from(document.querySelectorAll(zone.selector)).reverse();
			for (let node of nodes) {
				if (event.target === node) {
					this.zone = zone;
					break loop1;
				}
			}
		}

		if (!['annotations', 'viewerContainer'].includes(event.target.id) && (!this.zone || !this.zone.id.includes('annotation') && !this.zone.id.includes('label-'))) {
			this.options.selectAnnotation();
		}

		if (!this.zone || !['label-popup-input', 'label-popup-checkbox', 'label-popup-radios', 'label-popup-button'].includes(this.zone.id)) {
			this.options.setLabelPopup(null);
		}

		if (this.zone && this.zone.id !== 'popup-selection') {
			this.options.setSelectionRangesRef([]);
		}

		if (event.target.nodeType === Node.ELEMENT_NODE
			&& !event.target.closest('#findbar')
			&& PDFViewerApplication.findBar.opened
			&& !PDFViewerApplication.findBar.findField.value) {
			PDFViewerApplication.findBar.close();
		}
	}

	focus(id) {
		if (!id) {
			document.getElementById('viewerContainer').focus();
			this.options.selectAnnotation();
			this.zone = null;
			return;
		}

		let zone = this.zones.find(x => x.id === id);
		if (id === 'view-annotation') {
			let annotation = this.options.getFirstVisibleAnnotation();
			if (annotation) {
				if (!this.options.selectedIDsRef.current.length) {
					this.options.selectAnnotation({ id: annotation.id });
				}
				document.getElementById('viewerContainer').focus();
			}
			else {
				this.focus();
				return;
			}
		}
		else if (id === 'sidebar-annotation') {
			let annotationID = this.options.selectedIDsRef.current.slice(-1)[0]
				|| document.querySelector('#annotations .annotation').getAttribute('data-sidebar-annotation-id');

			if (annotationID) {
				this.options.selectAnnotation({ id: annotationID, selectInSidebar: true });
				let node = document.querySelector(`[data-sidebar-annotation-id="${annotationID}"]`);
				if (node) {
					node.focus();
				}
			}
		}
		else if (id === 'sidebar-buttons') {
			Array.from(document.querySelectorAll(zone.selector)).find(x => x.classList.contains('toggled')).focus();
		}
		else if (id === 'sidebar-thumbnails') {
			document.querySelector(zone.selector).focus();
			document.querySelector(zone.selector).click();
		}
		else {
			document.querySelector(zone.selector).focus();
		}

		this.zone = zone;
	}

	tab(reverse) {
		let zones = this.zones.slice();
		if (reverse) {
			zones.reverse();
		}
		let idx = zones.indexOf(this.zone);
		for (let i = idx + 1; i < zones.length; i++) {
			let zone = zones[i];
			if (PDFViewerApplication.pdfSidebar.isOpen && zone.id === 'view-annotation') {
				continue;
			}
			if (document.querySelector(zone.selector)) {
				this.focus(zone.id);
				return true;
			}
		}

		this.focus(null);
		return true;
	}

	next(reverse, shift) {
		if (this.zone.id === 'view-annotation') {
			let annotations = this.options.annotationsRef.current;
			if (reverse) {
				annotations = annotations.slice().reverse();
			}
			let lastID = this.options.selectedIDsRef.current.slice(-1)[0];
			if (lastID) {
				let annotationIndex = annotations.findIndex(x => x.id === lastID);
				if (annotations.length > annotationIndex + 1) {
					let nextAnnotation = annotations[annotationIndex + 1];
					let nextID = nextAnnotation.id;
					this.options.selectAnnotation({ id: nextID, shift, scrollSidebar: true, scrollViewer: true });
				}
			}
			return;
		}

		let nodes = Array.from(document.querySelectorAll(this.zone.selector));
		if (reverse) {
			nodes = nodes.reverse();
		}

		let focus = (node) => {
			node.focus();

			if (node.id === 'pageNumber') {
				setTimeout(() => node.select(), 0);
			}

			if (this.zone.id === 'sidebar-buttons') {
				node.click();
			}
			else if (this.zone.id === 'sidebar-annotation') {
				let id = node.getAttribute('data-sidebar-annotation-id');
				this.options.selectAnnotation({ id, shift, scrollSidebar: true, scrollViewer: true, selectInSidebar: true });
			}
			else if (this.zone.id === 'sidebar-thumbnails') {
				node.click();
			}
		};

		let canFocus = false;
		for (let node of nodes) {
			if (canFocus) {
				focus(node);
				canFocus = false;
				break;
			}
			if (node === document.activeElement) {
				canFocus = true;
			}
		}
	}

	isFirstZone() {
		let zones = this.zones.slice();
		for (let zone of zones) {
			if (PDFViewerApplication.pdfSidebar.isOpen && zone.id === 'view-annotation') {
				continue;
			}
			if (document.querySelector(zone.selector)) {
				if (this.zone === zone) {
					return true;
				}
				return false;
			}
		}

		return false;
	}

	tabToolbar = (reverse) => {
		this.zone = this.zones.find(x => x.id === 'toolbar');
		this.tab(reverse);
	}

	focusFirst = () => {
		let zones = this.zones.slice();
		for (let zone of zones) {
			if (PDFViewerApplication.pdfSidebar.isOpen && zone.id === 'view-annotation') {
				continue;
			}
			if (document.querySelector(zone.selector)) {
				this.focus(zone.id);
				return;
			}
		}
	}
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
	const focusManagerRef = useRef(null);
	const annotationCommentTouched = useRef(false);

	useEffect(() => {
		focusManagerRef.current = new FocusManager({
			selectedIDsRef,
			selectAnnotation,
			annotationsRef,
			setSelectionRangesRef,
			getFirstVisibleAnnotation,
			setLabelPopup,
			lastSelectedAnnotationIDRef
		});
	}, []);

	useImperativeHandle(ref, () => ({
		navigate,
		setAnnotations,
		setColor,
		setEnableAddToNote,
		openPageLabelPopup,
		editHighlightedText,
		clearSelector: annotationsViewRef.current.clearSelector,
		tabToolbar: (reverse) => focusManagerRef.current.tabToolbar(reverse),
		focusFirst: () => focusManagerRef.current.focusFirst()
	}));

	function getFirstVisibleAnnotation() {
		for (let annotation of annotationsRef.current) {
			let { pageIndex } = annotation.position;
			let { div, viewport } = PDFViewerApplication.pdfViewer.getPageView(pageIndex);

			let position = p2v(annotation.position, viewport);

			let rectMax = getPositionBoundingRect(position);

			let viewerScrollLeft = PDFViewerApplication.pdfViewer.container.scrollLeft;
			let viewerScrollTop = PDFViewerApplication.pdfViewer.container.scrollTop;
			let viewerWidth = PDFViewerApplication.pdfViewer.container.offsetWidth;
			let viewerHeight = PDFViewerApplication.pdfViewer.container.offsetHeight;

			let visibleRect = [viewerScrollLeft, viewerScrollTop - 10, viewerScrollLeft + viewerWidth, viewerScrollTop + viewerHeight];

			function quickIntersectRect(r1, r2) {
				return !(r2[0] > r1[2]
					|| r2[2] < r1[0]
					|| r2[1] > r1[3]
					|| r2[3] < r1[1]);
			}

			rectMax = [
				div.offsetLeft + rectMax[0],
				div.offsetTop + rectMax[1],
				div.offsetLeft + rectMax[2],
				div.offsetTop + rectMax[3],
			];

			if (quickIntersectRect(visibleRect, rectMax)) {
				return annotation;
				break;
			}
		}
	}

	window.getFirstVisibleAnnotation = getFirstVisibleAnnotation;

	function setSelectionRangesRef(ranges) {
		setSelectionPositions(ranges.filter(x => !x.collapsed).map(x => x.position));
		selectionRangesRef.current = ranges;
	}

	function hasSelection() {
		return !!selectionRangesRef.current.filter(x => !x.collapsed).length;
	}

	function scrollSidebarTo(id) {
		let sidebarItem = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
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
			let content = document.querySelector(`[data-sidebar-annotation-id="${annotationID}"] .highlight .content`);
			if (content) {
				setCaretToEnd(content);
			}
		}, 100);
	};

	let focusComment = (annotationID) => {
		setTimeout(function () {
			let content;
			if (PDFViewerApplication.pdfSidebar.isOpen) {
				content = document.querySelector(`[data-sidebar-annotation-id="${annotationID}"] .comment .content`);
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

		// Allow 'copy' event to be triggered
		if (isMod && e.key === 'c'
			&& focusManagerRef.current.zone
			&& ['sidebar-annotation', 'view-annotation'].includes(focusManagerRef.current.zone.id)) {
			return;
		}

		if (isMod && e.key === 'i'
			&& focusManagerRef.current.zone
			&& ['sidebar-annotation-highlight', 'sidebar-annotation-comment', 'view-annotation-comment'].includes(focusManagerRef.current.zone.id)) {
			document.execCommand('italic', false, null);
			return;
		}

		if (isMod && e.key === 'b'
			&& focusManagerRef.current.zone
			&& ['sidebar-annotation-highlight', 'sidebar-annotation-comment', 'view-annotation-comment'].includes(focusManagerRef.current.zone.id)) {
			document.execCommand('bold', false, null);
			return;
		}

		// Tab, Shift-Tab, Escape work everywhere and allow to switch between focus zones and PDF view
		if (isShift && e.key === 'Tab') {
			if (focusManagerRef.current.isFirstZone()) {
				props.onFocusContextPane();
				e.preventDefault();
				return;
			}
			focusManagerRef.current.tab(true);
			e.preventDefault();
		}
		else if (e.key === 'Tab') {
			if (!focusManagerRef.current.zone) {
				props.onFocusContextPane();
				e.preventDefault();
				return;
			}
			focusManagerRef.current.tab();
			e.preventDefault();
		}
		else if (e.key === 'Escape') {
			PDFViewerApplication.pdfCursorTools.handTool.deactivate();
			PDFViewerApplication.findBar.close();
			PDFViewerApplication.findBar.findField.value = '';

			// Focus PDF view
			focusManagerRef.current.focus();

			if (selectedIDsRef.current.length) {
				selectAnnotation();
			}
			else if (modeRef.current) {
				setMode(null);
			}

			setSelectionRangesRef([]);
			setEnableSelection(false);
			setLabelPopup(null);

			document.getElementById('viewerContainer').focus();
			focusManagerRef.current.zone = null;

			// Sometimes everything gets selected on Firefox when pressing escape here
			clearSelection();
		}

		// Focused any zone that is not PDF view


		let lastSelectedAnnotation = annotationsRef.current.find(x => x.id === lastSelectedAnnotationIDRef.current);

		if (focusManagerRef.current.zone) {
			if (['sidebar-annotation-comment', 'view-annotation-comment'].includes(focusManagerRef.current.zone.id)
				&& !['Backspace', 'Delete', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
				annotationCommentTouched.current = true;
			}

			if (!window.rtl && e.key === 'ArrowRight' || window.rtl && e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
				let findButton = document.getElementById('viewFind');
				if (focusManagerRef.current.zone.id === 'toolbar' && document.activeElement === findButton) {
					props.onFocusSplitButton();
					e.preventDefault();
					e.stopPropagation();
					return;
				}


				// Allow navigating to next/previous annotation if empty comment was just automatically focused
				if (['sidebar-annotation-comment'].includes(focusManagerRef.current.zone.id)
				&& !annotationCommentTouched.current && lastSelectedAnnotation && !lastSelectedAnnotation.comment) {
					let node = document.querySelector(`[data-sidebar-annotation-id="${lastSelectedAnnotationIDRef.current}"]`);
					if (node) {
						node.focus();
					}
				}
				if (['view-annotation-comment'].includes(focusManagerRef.current.zone.id)
					&& !annotationCommentTouched.current) {
					focusManagerRef.current.zone = focusManagerRef.current.zones.find(x => x.id === 'view-annotation');
				}

				focusManagerRef.current.next(false, isShift);
			}
			else if (!window.rtl && e.key === 'ArrowLeft' || window.rtl && e.key === 'ArrowRight' || e.key === 'ArrowUp') {
				// Allow to navigate to next/previous annotation if empty comment was just automatically focused
				if (['sidebar-annotation-comment'].includes(focusManagerRef.current.zone.id)
					&& !annotationCommentTouched.current && lastSelectedAnnotation && !lastSelectedAnnotation.comment) {
					let node = document.querySelector(`[data-sidebar-annotation-id="${lastSelectedAnnotationIDRef.current}"]`);
					if (node) {
						node.focus();
					}
				}
				if (['view-annotation-comment'].includes(focusManagerRef.current.zone.id)
					&& !annotationCommentTouched.current) {
					focusManagerRef.current.zone = focusManagerRef.current.zones.find(x => x.id === 'view-annotation');
				}

				focusManagerRef.current.next(true, isShift);
			}
			else if ((e.key === ' ' || e.key === 'Enter')
				&& document.activeElement && document.activeElement.nodeName === 'A') {
				let prev = document.activeElement.previousElementSibling;
				if (e.key === 'Enter' && prev.classList.contains('treeItemToggler')) {
					prev.click();
				}
				else {
					document.activeElement.click();
				}
			}
			else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.repeat) {
				// TODO: Auto-select the next annotation after deletion in sidebar
				let id = selectedIDsRef.current[0];
				let annotation = annotationsRef.current.find(x => x.id === id);

				let hasReadOnly = !!annotationsRef.current.find(x => selectedIDsRef.current.includes(x.id) && x.readOnly);
				if (!hasReadOnly) {
					if (['sidebar-annotation', 'view-annotation'].includes(focusManagerRef.current.zone.id)) {
						props.onDeleteAnnotations(selectedIDsRef.current);
					}
					else if (['sidebar-annotation-comment', 'view-annotation-comment'].includes(focusManagerRef.current.zone.id)
						&& annotation && !annotation.comment && !annotationCommentTouched.current) {
						props.onDeleteAnnotations([id]);
					}
				}
			}
			else if (['sidebar-annotation', 'sidebar-selector', 'sidebar-search'].includes(focusManagerRef.current.zone.id)
				&& isMod && e.key === 'a'
			) {
				setSelectedIDs(annotationsViewRef.current.getAnnotations().map(x => x.id));
			}

			// Don't bypass keys if focus isn't on an input, contenteditable or button (only for Space),
			// and isn't a modifier, and isn't SHIFT or if it is, then at least it's not an arrow key
			if (!(document.activeElement.nodeName === 'INPUT' && ['text', 'number'].includes(document.activeElement.type)
				|| document.activeElement.getAttribute('contenteditable')
				|| e.key === ' ' && document.activeElement.nodeName === 'BUTTON')
				&& !isMod && !isAlt && (!isShift || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
			) {
				e.preventDefault();
				e.stopPropagation();
			}

			// Prevent up/down page switching when cursor in page number input
			if (document.activeElement.id === 'pageNumber' && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
				e.preventDefault();
				e.stopPropagation();
			}
		}
		// PDF view is focused
		else {
			// This is not ideal, but the goal is to keep focus on `selectionBox`
			// when a speak out keyboard shortcut is pressed, and focus to
			// `viewerContainer` when other keys are pressed
			if (document.activeElement === window.selectionBox && !isMod && !isAlt && !isShift) {
				document.getElementById('viewerContainer').focus();
			}

			// Prevent Mod + A, as it selects random things in viewer container and makes them draggable
			if (isMod && !isShift && e.key === 'a') {
				e.preventDefault();
			}
			// Prevent "open file", "download file" PDF.js keyboard shortcuts
			// https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-shortcuts
			else if (isMod && ['o', 's'].includes(e.key)) {
				e.stopPropagation();
				e.preventDefault();
			}
			else if (isMod && isAlt && e.key === 'p') {
				e.stopPropagation();
			}
			else if ((isCmd || isCtrl && isLinux()) && e.key === '['
				|| (isAlt && !isMac() || isCmd) && e.key === 'ArrowLeft') {
				window.history.back();
			}
			else if ((isCmd || isCtrl && isLinux()) && e.key === ']'
				|| (isAlt && !isMac() || isCmd) && e.key === 'ArrowRight') {
				window.history.forward();
			}
			else if (isShift && selectionRangesRef.current.length) {
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
		}
	}, []);

	const handleCopy = useCallback((event) => {
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

		selectAnnotation();
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

	function selectAnnotation({ id, ctrl, shift, selectInSidebar, scrollSidebar, scrollViewer } = {}) {
		annotationCommentTouched.current = false;
		if (!id) {
			setSelectedIDs([]);
			return 0;
		}
		let selectedIDs = selectedIDsRef.current.slice();
		let annotations = selectInSidebar ? annotationsViewRef.current.getAnnotations() : annotationsRef.current;
		if (shift && selectedIDs.length) {
			let annotationIndex = annotations.findIndex(x => x.id === id);
			let lastSelectedIndex = annotations.findIndex(x => x.id === selectedIDs.slice(-1)[0]);
			let selectedIndices = selectedIDs.map(id => annotations.findIndex(annotation => annotation.id === id));
			let minSelectedIndex = Math.min(...selectedIndices);
			let maxSelectedIndex = Math.max(...selectedIndices);
			if (annotationIndex < minSelectedIndex) {
				for (let i = annotationIndex; i < minSelectedIndex; i++) {
					selectedIDs.push(annotations[i].id);
				}
			}
			else if (annotationIndex > maxSelectedIndex) {
				for (let i = maxSelectedIndex + 1; i <= annotationIndex; i++) {
					selectedIDs.push(annotations[i].id);
				}
			}
			else {
				for (let i = Math.min(annotationIndex, lastSelectedIndex); i <= Math.max(annotationIndex, lastSelectedIndex); i++) {
					if (i === lastSelectedIndex) {
						continue;
					}
					let id = annotations[i].id;
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

		if (JSON.stringify(selectedIDsRef.current) === JSON.stringify(selectedIDs)) {
			return 0;
		}

		setSelectedIDs(selectedIDs);
		if (selectedIDs.length >= 2) {
			setExpansionState(0);
		}
		else {
			setExpansionState(1);
		}

		lastSelectedAnnotationIDRef.current = selectedIDs.slice(-1)[0];

		let annotation = annotations.find(x => x.id === lastSelectedAnnotationIDRef.current);
		scrollTo(annotation, scrollSidebar, scrollViewer);

		if (selectInSidebar) {
			focusManagerRef.current.zone = focusManagerRef.current.zones.find(x => x.id === 'sidebar-annotation');
		}
		else {
			focusManagerRef.current.zone = focusManagerRef.current.zones.find(x => x.id === 'view-annotation');
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
		// and allow dragging, otherwise cancel
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
			let selected = selectAnnotation({ id, ctrl, shift, scrollSidebar: true, scrollViewer: true, selectInSidebar: true });
			if (selected === 1) {
				scrollTo(annotationsRef.current.find(x => x.id === id), true, true);
				// if (section !== 'header') this.focusSidebarComment(id);
			}
		}
	}, []);

	const handleSidebarAnnotationEditorBlur = useCallback(() => {
		setExpansionState(1);
		// document.getElementById('annotationsView').focus();
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

	const handleSidebarAnnotationMenuOpen = useCallback(({ id, button, screenX, screenY, selector }) => {
		let selectedColor;
		let ids = [id];

		if (button || selectedIDsRef.current.length === 1) {
			selectedColor = annotationsRef.current.find(x => x.id === id).color;
		}

		if (!button && selectedIDsRef.current.includes(id)) {
			ids = selectedIDsRef.current;
		}

		let readOnly = annotationsRef.current.some(x => ids.includes(x.id) && x.readOnly);
		let enableAddToNote = !annotationsRef.current.some(x => ids.includes(x.id) && x.type === 'ink');
		let enableEditHighlightedText = ids.length === 1 && annotationsRef.current.find(x => x.id === ids[0] && x.type === 'highlight');

		props.onPopup('openAnnotationPopup', {
			x: screenX,
			y: screenY,
			selector,
			standalone: button,
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

	const handleLayerAnnotationMoreMenu = useCallback(({id, screenX, screenY, selector}) => {
		let annotation = annotationsRef.current.find(x => x.id === id);
		let selectedColor = annotation.color;
		let enableAddToNote = annotation.type !== 'ink';
		props.onPopup('openAnnotationPopup', {
			x: screenX,
			y: screenY,
			selector,
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
		return !!annotationsRef.current.filter(x => selectedIDsRef.current.includes(x.id)).find(x => intersectAnnotationWithPoint(x.position, position));
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
				selectAnnotation({ id: annotation.id, scrollSidebar: true });
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
			let selected = selectAnnotation({ id: selectID, ctrl: isCtrl, shift: isShift, scrollSidebar: true });
			if (selected === 1) {
				let annotation = annotationsRef.current.find(x => x.id === selectedIDsRef.current[0]);
				if (!annotation.comment) {
					focusComment(annotation.id);
				}
			}
			setIsSelectedOnPointerDown(true);
		}

		if (!isCtrl && !selectID) {
			selectAnnotation();
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
		if (event.target.nodeType === Node.ELEMENT_NODE
			&& !event.target.closest('#findbar')
			&& PDFViewerApplication.findBar.opened
			&& !PDFViewerApplication.findBar.findField.value) {
			PDFViewerApplication.findBar.close();
		}

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
			selectAnnotation();
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
			selectAnnotation({ id: selectID, ctrl: isCtrl, shift: isShift, scrollSidebar: true });
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
		selectAnnotation({ id, scrollSidebar: true });
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
			let anchorNode = document.querySelector(`.annotation-popup .page .label`);
			if (annotations.length > 1 || !anchorNode) {
				rect = [clientX, clientY, clientX, clientY];
			}
			else {
				rect = anchorNode.getBoundingClientRect();
				rect = [rect.left, rect.top, rect.right, rect.bottom];
			}
		}
		else if (isSidebarOpenRef.current) {
			let anchorNode = document.querySelector(`[data-sidebar-annotation-id="${currentID}"] .page .label`);
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
		selectAnnotation({ id: currentID, scrollSidebar: true, scrollViewer: true, selectInSidebar: true });
		setTimeout(() => {
			let node = document.querySelector(`[data-sidebar-annotation-id="${currentID}"] .content`);
			var clickEvent = document.createEvent('MouseEvents');
			clickEvent.initEvent('dblclick', true, true);
			node.dispatchEvent(clickEvent);
			node.focus();
		}, 50);
	}

	const handleSelectorMenuOpen = useCallback((data) => {
		props.onPopup('openSelectorPopup', data);
	}, []);

	const handleDeselectAnnotations = useCallback(() => {
		setSelectedIDs([]);
		props.onClosePopup();
	}, []);

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
				selectedIDs={_selectedIDs}
				expansionState={_expansionState}
				onClickAnnotationSection={handleSidebarAnnotationSectionClick}
				onAnnotationEditorBlur={handleSidebarAnnotationEditorBlur}
				onDoubleClickHighlight={handleSidebarAnnotationDoubleClick}
				onDoubleClickPageLabel={handlePageLabelDoubleClick}
				onChange={handleSidebarAnnotationChange}
				onDragStart={handleSidebarAnnotationDragStart}
				onMenu={handleSidebarAnnotationMenuOpen}
				onSelectorMenu={handleSelectorMenuOpen}
				onDeselectAnnotations={handleDeselectAnnotations}
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
