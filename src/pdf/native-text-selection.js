import {
	getSelectionRanges,
	getSelectionRangesByPosition,
	getTextFromSelectionRanges
} from './selection';
import { applyInverseTransform } from './lib/utilities';
import {
	alignTextUnits,
	buildReaderUnitMap,
	getMappedSelectionEndpoints,
	getMatchingSelectionRanges,
	getNormalizedUnits
} from './native-text-selection-map.mjs';

const SELECTION_SETTLE_DELAY = 100;
const PAGE_POINTER_RELEASE_DELAY = SELECTION_SETTLE_DELAY * 2;

function getTextLayer(node, win) {
	if (!node) {
		return null;
	}
	let element = node.nodeType === win.Node.TEXT_NODE ? node.parentElement : node;
	return element?.closest?.('.textLayer') || null;
}

function getPageIndex(textLayer) {
	let pageNumber = parseInt(textLayer?.closest('.page')?.dataset.pageNumber);
	return Number.isInteger(pageNumber) ? pageNumber - 1 : null;
}

class TextLayerBoundaryMap {
	constructor(win, textLayer, textDivs, chars) {
		this._win = win;
		this._textLayer = textLayer;
		this._nodeOffsets = new WeakMap();
		this._textDivOffsets = new WeakMap();
		this._domUnits = [];
		this._readerUnits = [];
		this._readerStartOffsets = [];
		this._readerEndOffsets = [];
		this._buildDOMMap(textDivs);
		this._buildReaderMap(chars);
		this._domToReaderOffsets = alignTextUnits(this._domUnits, this._readerUnits);
	}

	getReaderOffset(node, offset, affinity) {
		let domOffset = this._getNormalizedOffset(node, offset);
		if (domOffset === null || domOffset > this._domUnits.length) {
			return null;
		}
		let normalizedOffset = this._domToReaderOffsets[domOffset];
		if (normalizedOffset === undefined || normalizedOffset > this._readerUnits.length) {
			return null;
		}
		return affinity === 'end'
			? this._readerEndOffsets[normalizedOffset]
			: this._readerStartOffsets[normalizedOffset];
	}

	_buildDOMMap(textDivs) {
		let visitedNodes = new Set();
		for (let textDiv of textDivs) {
			if (!this._textLayer.contains(textDiv)) {
				continue;
			}
			this._textDivOffsets.set(textDiv, this._domUnits.length);
			let walker = this._win.document.createTreeWalker(
				textDiv,
				this._win.NodeFilter.SHOW_TEXT
			);
			let node;
			while ((node = walker.nextNode())) {
				if (visitedNodes.has(node)) {
					continue;
				}
				visitedNodes.add(node);
				let start = this._domUnits.length;
				let prefixLengths = new Array(node.nodeValue.length + 1).fill(0);
				let sourceOffset = 0;
				let normalizedLength = 0;
				for (let character of node.nodeValue) {
					let characterLength = character.length;
					let units = getNormalizedUnits(character);
					for (let i = 1; i < characterLength; i++) {
						prefixLengths[sourceOffset + i] = normalizedLength;
					}
					normalizedLength += units.length;
					sourceOffset += characterLength;
					prefixLengths[sourceOffset] = normalizedLength;
					this._domUnits.push(...units);
				}
				this._nodeOffsets.set(node, { start, prefixLengths });
			}
		}
	}

	_buildReaderMap(chars) {
		let map = buildReaderUnitMap(chars);
		this._readerUnits = map.readerUnits;
		this._readerStartOffsets = map.readerStartOffsets;
		this._readerEndOffsets = map.readerEndOffsets;
	}

	_getNormalizedOffset(node, offset) {
		if (node.nodeType === this._win.Node.TEXT_NODE) {
			let nodeOffset = this._nodeOffsets.get(node);
			if (nodeOffset) {
				let sourceOffset = Math.max(0, Math.min(offset, node.nodeValue.length));
				return nodeOffset.start + nodeOffset.prefixLengths[sourceOffset];
			}
		}

		let textDiv = node.nodeType === this._win.Node.ELEMENT_NODE ? node : node.parentElement;
		while (textDiv && !this._textDivOffsets.has(textDiv)) {
			textDiv = textDiv.parentElement;
		}
		if (!textDiv) {
			return null;
		}
		try {
			let range = this._win.document.createRange();
			range.setStart(textDiv, 0);
			range.setEnd(node, offset);
			return this._textDivOffsets.get(textDiv) + getNormalizedUnits(range.toString()).length;
		}
		catch (e) {
			return null;
		}
	}
}

export class PDFNativeTextSelection {
	constructor(view) {
		this._view = view;
		this._win = view._iframeWindow;
		this._pageMaps = new WeakMap();
		this._enabled = false;
		this._ownsSelection = false;
		this._syncGeneration = 0;
		this._syncAnimationFrame = null;
		this._syncTimeout = null;
		this._lastValidSelection = null;
		this._pagePointerDown = false;
		this._pagePointerReleaseTimeout = null;
		this._handleSelectionChange = this._handleSelectionChange.bind(this);
		// Restore native-handle transients before PDF.js rewrites the selection sentinel.
		this._win.document.addEventListener('selectionchange', this._handleSelectionChange, true);
		this.updateEnabledState();
	}

	destroy() {
		this._win.document.removeEventListener('selectionchange', this._handleSelectionChange, true);
		this._cancelScheduledSync();
		this._win.clearTimeout(this._pagePointerReleaseTimeout);
		this._setRootState(false, false);
		this._pageMaps = new WeakMap();
	}

	get enabled() {
		return this._enabled;
	}

	updateEnabledState() {
		let enabled = this._view._mobile && this._view._tool?.type === 'pointer';
		if (enabled === this._enabled) {
			return;
		}
		this._enabled = enabled;
		this._setRootState(enabled, false);
		for (let textLayer of this._win.document.querySelectorAll('.textLayer')) {
			textLayer.draggable = !enabled;
		}
		if (!enabled) {
			this.clear();
		}
	}

	handleTextLayerRendered(textLayer) {
		if (!textLayer) {
			return;
		}
		textLayer.draggable = !this._enabled;
		this._pageMaps.delete(textLayer);
		let pageIndex = getPageIndex(textLayer);
		if (pageIndex !== null && this.hasSelection()) {
			this._view._ensureBasicPageData(pageIndex).then(() => {
				if (textLayer.isConnected && this.hasSelection()) {
					this.scheduleSync();
				}
			});
		}
	}

	handlePointerDown(event) {
		if (!this._enabled) {
			return false;
		}
		if (event.type === 'pointerdown') {
			this._win.clearTimeout(this._pagePointerReleaseTimeout);
			this._pagePointerReleaseTimeout = null;
			this._pagePointerDown = true;
		}
		let selection = this._getSelectionInfo();
		if (this._hasReaderTarget(event)) {
			if (selection) {
				this.clear();
			}
			return false;
		}
		if (!selection) {
			let nativeMouseSelection = event.type === 'mousedown'
				&& !!getTextLayer(event.target, this._win);
			if (nativeMouseSelection && this._view._selectedAnnotationIDs.length) {
				this._view._onSelectAnnotations([], event);
			}
			return nativeMouseSelection;
		}
		if (!getTextLayer(event.target, this._win)) {
			this.clear();
			return false;
		}
		return true;
	}

	handlePointerUp() {
		this._win.clearTimeout(this._pagePointerReleaseTimeout);
		this._pagePointerReleaseTimeout = this._win.setTimeout(() => {
			this._pagePointerReleaseTimeout = null;
			this._pagePointerDown = false;
		}, PAGE_POINTER_RELEASE_DELAY);
	}

	_hasReaderTarget(event) {
		let position = this._view.pointerEventToPosition(event);
		return !!position && (
			this._view.getSelectableAnnotations(position)?.length
			|| this._view._getSelectableOverlay(position)
		);
	}

	shouldDeferEvent(event) {
		return this._enabled
			&& this.hasSelection()
			&& (
				!!getTextLayer(event.target, this._win)
				|| this._ownsSelection
			);
	}

	shouldAllowNativeTouch(event) {
		return this._enabled
			&& (
				this.hasSelection()
				|| !!getTextLayer(event.target, this._win)
			);
	}

	handleContextMenu(event) {
		if (!this._enabled
				|| (!this.hasSelection() && !getTextLayer(event.target, this._win))) {
			return false;
		}
		this.syncNow();
		this._view._clearPointerAction();
		return true;
	}

	hasSelection() {
		return !!this._getSelectionInfo();
	}

	clear() {
		this._cancelScheduledSync();
		this._syncGeneration++;
		let selection = this._win.getSelection();
		if (selection?.rangeCount
				&& (
					getTextLayer(selection.anchorNode, this._win)
					|| getTextLayer(selection.focusNode, this._win)
				)) {
			selection.removeAllRanges();
		}
		this._ownsSelection = false;
		this._lastValidSelection = null;
		this._setRootState(this._enabled, false);
		this._clearReaderSelection();
	}

	scheduleSync() {
		if (!this._enabled) {
			return;
		}
		let generation = ++this._syncGeneration;
		if (this._syncAnimationFrame !== null) {
			this._win.cancelAnimationFrame(this._syncAnimationFrame);
		}
		this._syncAnimationFrame = this._win.requestAnimationFrame(() => {
			this._syncAnimationFrame = null;
			this._sync(generation);
		});
		this._win.clearTimeout(this._syncTimeout);
		this._syncTimeout = this._win.setTimeout(() => {
			this._syncTimeout = null;
			this.syncNow();
		}, SELECTION_SETTLE_DELAY);
	}

	syncNow() {
		if (!this._enabled) {
			return false;
		}
		let generation = ++this._syncGeneration;
		return this._sync(generation);
	}

	_handleSelectionChange() {
		if (this._restoreTransientHandleSelection()) {
			return;
		}
		this.scheduleSync();
	}

	_sync(generation) {
		let selectionInfo = this._getSelectionInfo();
		if (!selectionInfo) {
			if (this._ownsSelection) {
				this._ownsSelection = false;
				this._lastValidSelection = null;
				this._setRootState(this._enabled, false);
				this._clearReaderSelection();
			}
			return false;
		}

		this._ownsSelection = true;
		let pageIndexes = this._getSelectionPageIndexes(selectionInfo);
		let missingPageIndexes = pageIndexes.filter(pageIndex => !this._view._pdfPages[pageIndex]?.chars);
		if (missingPageIndexes.length) {
			Promise.all(missingPageIndexes.map(pageIndex => this._view._ensureBasicPageData(pageIndex)))
				.then(() => {
					if (generation === this._syncGeneration) {
						this.syncNow();
					}
				});
			this._lastValidSelection = null;
			this._setRootState(this._enabled, false);
			this._clearReaderSelection();
			return false;
		}

		let selectionRanges = getMatchingSelectionRanges(
			selectionInfo.selection.toString(),
			this._getMappedSelectionRanges(selectionInfo),
			ranges => getTextFromSelectionRanges(ranges),
			() => this._getSelectionRangesByRects(selectionInfo)
		);
		if (!selectionRanges?.length || selectionRanges[0].collapsed) {
			this._lastValidSelection = null;
			this._setRootState(this._enabled, false);
			this._clearReaderSelection();
			return false;
		}

		this._setRootState(this._enabled, true);
		this._lastValidSelection = {
			anchorNode: selectionInfo.selection.anchorNode,
			anchorOffset: selectionInfo.selection.anchorOffset,
			focusNode: selectionInfo.selection.focusNode,
			focusOffset: selectionInfo.selection.focusOffset
		};
		this._setReaderSelection(selectionRanges);
		return true;
	}

	_isTransientHandleSelection() {
		let selection = this._win.getSelection();
		let node = selection?.anchorNode;
		return !this._pagePointerDown
			&& selection?.rangeCount === 1
			&& selection.isCollapsed
			&& node?.nodeType === this._win.Node.ELEMENT_NODE
			&& node.classList.contains('textLayer')
			&& node.classList.contains('selecting');
	}

	_restoreTransientHandleSelection() {
		if (!this._ownsSelection
				|| !this._lastValidSelection
				|| !this._isTransientHandleSelection()) {
			return false;
		}
		let {
			anchorNode,
			anchorOffset,
			focusNode,
			focusOffset
		} = this._lastValidSelection;
		if (!anchorNode.isConnected || !focusNode.isConnected) {
			return false;
		}
		try {
			this._win.getSelection().setBaseAndExtent(
				anchorNode,
				anchorOffset,
				focusNode,
				focusOffset
			);
			return true;
		}
		catch (e) {
			return false;
		}
	}

	_getSelectionInfo() {
		if (!this._enabled) {
			return null;
		}
		let selection = this._win.getSelection();
		if (!selection?.rangeCount || selection.isCollapsed) {
			return null;
		}
		let anchorLayer = getTextLayer(selection.anchorNode, this._win);
		let focusLayer = getTextLayer(selection.focusNode, this._win);
		if (!anchorLayer || !focusLayer) {
			return null;
		}
		let anchorPageIndex = getPageIndex(anchorLayer);
		let focusPageIndex = getPageIndex(focusLayer);
		if (anchorPageIndex === null || focusPageIndex === null) {
			return null;
		}
		let range = selection.getRangeAt(0);
		let anchorIsStart = selection.anchorNode === range.startContainer
			&& selection.anchorOffset === range.startOffset;
		return {
			selection,
			range,
			anchorLayer,
			focusLayer,
			anchorPageIndex,
			focusPageIndex,
			anchorIsStart
		};
	}

	_getSelectionPageIndexes(selectionInfo) {
		let start = Math.min(selectionInfo.anchorPageIndex, selectionInfo.focusPageIndex);
		let end = Math.max(selectionInfo.anchorPageIndex, selectionInfo.focusPageIndex);
		let pageIndexes = [];
		for (let pageIndex = start; pageIndex <= end; pageIndex++) {
			pageIndexes.push(pageIndex);
		}
		return pageIndexes;
	}

	_getMappedSelectionRanges(selectionInfo) {
		let anchorMap = this._getPageMap(selectionInfo.anchorLayer, selectionInfo.anchorPageIndex);
		let focusMap = this._getPageMap(selectionInfo.focusLayer, selectionInfo.focusPageIndex);
		if (!anchorMap || !focusMap) {
			return null;
		}
		let endpoints = getMappedSelectionEndpoints(selectionInfo, anchorMap, focusMap);
		if (!endpoints) {
			return null;
		}
		return getSelectionRanges(
			this._view._pdfPages,
			endpoints.anchor,
			endpoints.focus
		);
	}

	_getPageMap(textLayer, pageIndex) {
		let chars = this._view._pdfPages[pageIndex]?.chars;
		let pageView = this._win.PDFViewerApplication.pdfViewer.getPageView(pageIndex);
		let textDivs = pageView?.textLayer?.highlighter?.textDivs;
		if (!chars || !textDivs?.length) {
			return null;
		}
		let cached = this._pageMaps.get(textLayer);
		if (!cached || cached.chars !== chars || cached.textDivs !== textDivs) {
			cached = {
				chars,
				textDivs,
				map: new TextLayerBoundaryMap(this._win, textLayer, textDivs, chars)
			};
			this._pageMaps.set(textLayer, cached);
		}
		return cached.map;
	}

	_getSelectionRangesByRects(selectionInfo) {
		let positions = this._getRangePositionsByPage(selectionInfo.range);
		let pageIndexes = [...positions.keys()].sort((a, b) => a - b);
		if (!pageIndexes.length) {
			return null;
		}

		let firstRange;
		let lastRange;
		for (let pageIndex of pageIndexes) {
			let [selectionRange] = getSelectionRangesByPosition(
				this._view._pdfPages,
				positions.get(pageIndex),
				{ applyFlow: false }
			);
			if (!selectionRange || selectionRange.collapsed) {
				continue;
			}
			firstRange ||= selectionRange;
			lastRange = selectionRange;
		}
		if (!firstRange || !lastRange) {
			return null;
		}

		let documentStart = {
			pageIndex: firstRange.position.pageIndex,
			offset: Math.min(firstRange.anchorOffset, firstRange.headOffset)
		};
		let documentEnd = {
			pageIndex: lastRange.position.pageIndex,
			offset: Math.max(lastRange.anchorOffset, lastRange.headOffset)
		};
		return selectionInfo.anchorIsStart
			? getSelectionRanges(this._view._pdfPages, documentStart, documentEnd)
			: getSelectionRanges(this._view._pdfPages, documentEnd, documentStart);
	}

	_getRangePositionsByPage(range) {
		let positions = new Map();
		for (let { pageIndex, rect } of this._getTextNodeRects(range)) {
			let pageView = this._win.PDFViewerApplication.pdfViewer.getPageView(pageIndex);
			if (!pageView?.div || !rect.width || !rect.height) {
				continue;
			}
			let pageRect = pageView.div.getBoundingClientRect();
			let clientRect = {
				left: Math.max(rect.left, pageRect.left),
				top: Math.max(rect.top, pageRect.top),
				right: Math.min(rect.right, pageRect.right),
				bottom: Math.min(rect.bottom, pageRect.bottom)
			};
			if (clientRect.right <= clientRect.left || clientRect.bottom <= clientRect.top) {
				continue;
			}
			let transform = pageView.viewport.transform;
			let point1 = applyInverseTransform(
				[clientRect.left - pageRect.left, clientRect.top - pageRect.top],
				transform
			);
			let point2 = applyInverseTransform(
				[clientRect.right - pageRect.left, clientRect.bottom - pageRect.top],
				transform
			);
			let position = positions.get(pageIndex);
			if (!position) {
				position = { pageIndex, rects: [] };
				positions.set(pageIndex, position);
			}
			position.rects.push([
				Math.min(point1[0], point2[0]),
				Math.min(point1[1], point2[1]),
				Math.max(point1[0], point2[0]),
				Math.max(point1[1], point2[1])
			]);
		}
		return positions;
	}

	_getTextNodeRects(range) {
		let rects = [];
		let container = range.commonAncestorContainer;
		let addNode = (node) => {
			let textLayer = getTextLayer(node, this._win);
			let pageIndex = getPageIndex(textLayer);
			if (pageIndex === null) {
				return;
			}
			try {
				if (!range.intersectsNode(node)) {
					return;
				}
				let nodeRange = this._win.document.createRange();
				nodeRange.setStart(node, node === range.startContainer ? range.startOffset : 0);
				nodeRange.setEnd(node, node === range.endContainer ? range.endOffset : node.nodeValue.length);
				for (let rect of nodeRange.getClientRects()) {
					rects.push({ pageIndex, rect });
				}
			}
			catch (e) {
			}
		};

		if (container.nodeType === this._win.Node.TEXT_NODE) {
			addNode(container);
			return rects;
		}
		let walker = this._win.document.createTreeWalker(
			container,
			this._win.NodeFilter.SHOW_TEXT
		);
		let node;
		while ((node = walker.nextNode())) {
			addNode(node);
		}
		return rects;
	}

	_setReaderSelection(selectionRanges) {
		let hadSelection = this._view._selectionRanges.some(range => !range.collapsed);
		let hasSelection = selectionRanges?.some(range => !range.collapsed) || false;
		this._view._setSelectionRanges(selectionRanges);
		this._view._render();
		if (hadSelection !== hasSelection) {
			this._view._updateViewStats();
		}
	}

	_clearReaderSelection() {
		if (this._view._selectionRanges.length) {
			this._setReaderSelection(null);
		}
	}

	_cancelScheduledSync() {
		if (this._syncAnimationFrame !== null) {
			this._win.cancelAnimationFrame(this._syncAnimationFrame);
			this._syncAnimationFrame = null;
		}
		this._win.clearTimeout(this._syncTimeout);
		this._syncTimeout = null;
	}

	_setRootState(enabled, mapped) {
		let root = this._win.document.documentElement;
		root.toggleAttribute('data-native-text-selection', enabled);
		root.toggleAttribute('data-native-text-selection-mapped', enabled && mapped);
	}
}
