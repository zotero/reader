import {
	getModifiedSelectionRanges,
	getReversedSelectionRanges,
	getWordSelectionRanges
} from './selection';
import { getTextRangeHandle } from './lib/text-range-handles';

const LONG_PRESS_DELAY = 500;
const MOVE_TOLERANCE = 10;
const WORD_TOLERANCE = 30;
const CONTEXT_MENU_SUPPRESSION_TIMEOUT = 1000;
const CONTEXT_MENU_SUPPRESSION_TOLERANCE = 40;
const HANDLE_TOUCH_SIZE = 44;
const HANDLE_GLYPH_LEFT = 6;
const HANDLE_GLYPH_TOP = 0;

function clientPointNearRect(x, y, rect, tolerance) {
	return x >= rect[0] - tolerance
		&& x <= rect[2] + tolerance
		&& y >= rect[1] - tolerance
		&& y <= rect[3] + tolerance;
}

function getMovement(event, point) {
	return Math.abs(event.clientX - point.clientX) + Math.abs(event.clientY - point.clientY);
}

function getRangeEndpointSide(range, endpoint) {
	let endpointOffset = endpoint === 'anchor' ? range.anchorOffset : range.headOffset;
	let otherOffset = endpoint === 'anchor' ? range.headOffset : range.anchorOffset;
	return endpointOffset <= otherOffset ? 'start' : 'end';
}

function getHandleOutwardVector(rotation, side) {
	let vector = (
		rotation === 0 && [-1, 0]
		|| rotation === 90 && [0, 1]
		|| rotation === 180 && [1, 0]
		|| rotation === 270 && [0, -1]
		|| [0, 0]
	);
	return side === 'start' ? vector : [-vector[0], -vector[1]];
}

function getHandlePlacements(handles) {
	if (!handles.anchor || !handles.head) {
		return null;
	}
	let placements = {};
	for (let endpoint of ['anchor', 'head']) {
		let { rect, rotation, side } = handles[endpoint];
		let x = (rect[0] + rect[2]) / 2;
		let y = (rect[1] + rect[3]) / 2;
		let [outwardX, outwardY] = getHandleOutwardVector(rotation, side);
		placements[endpoint] = {
			x,
			y,
			outwardX,
			outwardY,
			rotation,
			side
		};
	}
	return placements;
}

function getSelectionRangesWithDraggedEndpoint(pdfPages, selectionRanges, endpoint, position) {
	if (endpoint === 'head') {
		return getModifiedSelectionRanges(pdfPages, selectionRanges, position);
	}
	let reversed = getReversedSelectionRanges(selectionRanges);
	let modified = getModifiedSelectionRanges(pdfPages, reversed, position);
	if (!modified.length) {
		return [];
	}
	return getReversedSelectionRanges(modified);
}

class MobileSelectionHandleLayer {
	constructor(view) {
		let doc = view._iframeWindow.document;
		let container = doc.getElementById('viewerContainer');
		this._el = doc.createElement('div');
		this._el.className = 'mobileTextSelectionHandles';
		this._handles = {};
		this._glyphs = {};
		for (let endpoint of ['anchor', 'head']) {
			let handle = doc.createElement('div');
			handle.className = 'mobileTextSelectionHandle';
			handle.dataset.selectionEndpoint = endpoint;
			let glyph = doc.createElement('span');
			glyph.className = 'mobileTextSelectionHandleGlyph';
			handle.append(glyph);
			this._el.append(handle);
			this._handles[endpoint] = handle;
			this._glyphs[endpoint] = glyph;
		}
		container.append(this._el);
		this.hide();
	}

	destroy() {
		this._el.remove();
	}

	getEndpointFromTarget(target) {
		return target?.closest?.('.mobileTextSelectionHandle')?.dataset.selectionEndpoint || null;
	}

	getHandleGlyphClientPoint(endpoint) {
		let rect = this._glyphs[endpoint]?.getBoundingClientRect();
		if (!rect) {
			return null;
		}
		return {
			clientX: (rect.left + rect.right) / 2,
			clientY: (rect.top + rect.bottom) / 2
		};
	}

	moveHandleGlyphToClientPoint(endpoint, point) {
		let handle = this._handles[endpoint];
		let glyphPoint = this.getHandleGlyphClientPoint(endpoint);
		if (!handle || !glyphPoint) {
			return;
		}
		let left = parseFloat(handle.style.left);
		let top = parseFloat(handle.style.top);
		if (!Number.isFinite(left) || !Number.isFinite(top)) {
			return;
		}
		handle.style.left = `${left + point.clientX - glyphPoint.clientX}px`;
		handle.style.top = `${top + point.clientY - glyphPoint.clientY}px`;
	}

	hide() {
		this._el.hidden = true;
	}

	show(handles) {
		if (!handles.anchor || !handles.head) {
			this.hide();
			return;
		}
		this._el.hidden = false;
		let placements = getHandlePlacements(handles);
		let touchOffset = HANDLE_TOUCH_SIZE / 2;
		for (let endpoint of ['anchor', 'head']) {
			let handle = this._handles[endpoint];
			let glyph = this._glyphs[endpoint];
			let { x, y, outwardX, outwardY, rotation, side } = placements[endpoint];
			handle.dataset.side = side;
			handle.style.setProperty('--selection-handle-rotation', `${rotation}deg`);
			handle.style.left = `${x + outwardX * touchOffset}px`;
			handle.style.top = `${y + outwardY * touchOffset}px`;
			glyph.style.left = `${HANDLE_GLYPH_LEFT - outwardX * touchOffset}px`;
			glyph.style.top = `${HANDLE_GLYPH_TOP - outwardY * touchOffset}px`;
		}
	}
}

export class PDFMobileTextSelection {
	constructor(view) {
		this._view = view;
		this._pending = null;
		this._drag = null;
		this._suppressedContextMenu = null;
		this._handleLayer = new MobileSelectionHandleLayer(view);
	}

	destroy() {
		this.cancel();
		this._handleLayer.destroy();
	}

	cancel() {
		this._clearPending();
		this._finishDrag();
		this._handleLayer.hide();
	}

	onSelectionChange(selectionRanges) {
		if (!this._view._mobile || this._view._tool?.type !== 'pointer') {
			this._handleLayer.hide();
			return;
		}
		if (!selectionRanges?.length || selectionRanges[0].collapsed) {
			this._handleLayer.hide();
			return;
		}
		this._handleLayer.show(this._getHandles(selectionRanges));
		this._positionDraggedHandle();
	}

	handlePointerDown(event, context = {}) {
		let endpoint = this._handleLayer.getEndpointFromTarget(event.target);
		if (endpoint) {
			return this._startDrag(event, endpoint);
		}

		this._clearPending();
		if (!context.canStart) {
			return false;
		}

		let pending = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			event,
			position: context.position,
			handled: false,
			timeoutID: null
		};
		pending.timeoutID = setTimeout(() => {
			this._handleLongPress(pending);
		}, LONG_PRESS_DELAY);
		this._pending = pending;
		return false;
	}

	handleTouchMove(touch) {
		if (this._drag) {
			this._updateDrag(touch);
			return true;
		}
		this._cancelPendingIfMoved(touch);
		return false;
	}

	handleTouchEnd() {
		if (!this._pending?.handled) {
			this._clearPending();
		}
	}

	handlePointerMove(event) {
		if (this._drag) {
			if (event.pointerId === this._drag.pointerId) {
				this._updateDrag(event);
			}
			return true;
		}
		this._cancelPendingIfMoved(event);
		return false;
	}

	handlePointerUp(event) {
		if (this._drag && this._drag.pointerId === event.pointerId) {
			this._finishDrag({ updatePopup: true });
			event.preventDefault();
			event.stopPropagation();
			return true;
		}
		if (this._pending?.handled && this._pending.pointerId === event.pointerId) {
			this._clearPending();
			event.preventDefault();
			event.stopPropagation();
			return true;
		}
		if (this._pending?.pointerId === event.pointerId) {
			this._clearPending();
		}
		return false;
	}

	handlePointerCancel() {
		this.cancel();
	}

	handleScroll() {
		if (!this._pending?.handled) {
			this._clearPending();
		}
	}

	shouldSuppressContextMenu(event) {
		let suppressed = this._suppressedContextMenu;
		if (!suppressed || Date.now() > suppressed.until) {
			this._suppressedContextMenu = null;
			return false;
		}
		let movement = getMovement(event, suppressed);
		if (movement > CONTEXT_MENU_SUPPRESSION_TOLERANCE) {
			return false;
		}
		this._suppressedContextMenu = null;
		return true;
	}

	_startDrag(event, endpoint) {
		if (!this._view._selectionRanges.length) {
			return false;
		}
		let handlePoint = this._handleLayer.getHandleGlyphClientPoint(endpoint);
		this._clearPending();
		this._drag = {
			pointerId: event.pointerId,
			endpoint,
			pageIndex: this._view._selectionRanges.find(x => x[endpoint])?.position.pageIndex,
			point: null,
			touchOffsetX: handlePoint ? event.clientX - handlePoint.clientX : 0,
			touchOffsetY: handlePoint ? event.clientY - handlePoint.clientY : 0
		};
		try {
			event.target.setPointerCapture?.(event.pointerId);
		}
		catch (e) {
			// Synthetic pointer events do not always have an active pointer.
		}
		this._view._autoScroll.enable();
		event.preventDefault();
		event.stopPropagation();
		return true;
	}

	_updateDrag(event) {
		let point = this._getDragSelectionPoint(event);
		this._drag.point = point;
		let selectionRanges = this._getSelectionRangesForDragPoint(point);
		if (selectionRanges.length && !selectionRanges[0].collapsed) {
			this._view._setSelectionRanges(selectionRanges, { updatePopup: false });
			this._view._render();
		}
		this._positionDraggedHandle();
		this._view._autoScroll.update(event.clientX, event.clientY);
	}

	_getSelectionRangesForDragPoint(point) {
		let position = this._view.pointerEventToPosition(point);
		if (!position && this._drag.pageIndex !== undefined) {
			position = this._view.pointerEventToAltPosition(point, this._drag.pageIndex);
		}
		if (!position) {
			return [];
		}
		return getSelectionRangesWithDraggedEndpoint(
			this._view._pdfPages,
			this._view._selectionRanges,
			this._drag.endpoint,
			position
		);
	}

	_getDragSelectionPoint(event) {
		return {
			clientX: event.clientX - this._drag.touchOffsetX,
			clientY: event.clientY - this._drag.touchOffsetY
		};
	}

	_positionDraggedHandle() {
		if (this._drag?.point) {
			this._handleLayer.moveHandleGlyphToClientPoint(this._drag.endpoint, this._drag.point);
		}
	}

	_finishDrag({ updatePopup = false } = {}) {
		if (!this._drag) {
			return;
		}
		this._drag = null;
		this._view._autoScroll.stop();
		this.onSelectionChange(this._view._selectionRanges);
		if (updatePopup) {
			this._view._updateSelectionPopup();
			this._view._updateViewStats();
			this._view._render();
		}
	}

	_cancelPendingIfMoved(event) {
		if (!this._pending || this._pending.handled) {
			return;
		}
		if (event.pointerId !== undefined && event.pointerId !== this._pending.pointerId) {
			return;
		}
		if (getMovement(event, this._pending) > MOVE_TOLERANCE) {
			this._clearPending();
		}
	}

	_clearPending() {
		if (this._pending?.timeoutID) {
			clearTimeout(this._pending.timeoutID);
		}
		this._pending = null;
	}

	async _handleLongPress(pending) {
		if (this._pending !== pending || pending.handled) {
			return;
		}
		if (this._view._scrolling) {
			this._clearPending();
			return;
		}

		pending.timeoutID = null;
		let position = this._view.pointerEventToPosition(pending);
		if (!position || position.pageIndex !== pending.position.pageIndex) {
			this._clearPending();
			return;
		}

		await this._view._ensureBasicPageData(position.pageIndex);
		if (this._pending !== pending || pending.handled) {
			return;
		}
		if (this._view._getSelectableOverlay(position) || this._view.getSelectableAnnotations(position)?.length) {
			this._clearPending();
			return;
		}

		let selectionRanges = getWordSelectionRanges(this._view._pdfPages, position, position);
		if (!selectionRanges.length || selectionRanges[0].collapsed) {
			this._clearPending();
			return;
		}

		let rect = this._view.getClientRectForPopup(selectionRanges[0].position);
		if (!clientPointNearRect(pending.clientX, pending.clientY, rect, WORD_TOLERANCE)) {
			this._clearPending();
			return;
		}

		this._view._iframeWindow.getSelection().removeAllRanges();
		this._view._onSelectAnnotations([], pending.event);
		this._view._clearPointerAction();
		this._view._setSelectionRanges(selectionRanges);
		pending.handled = true;
		this._suppressContextMenu(pending);
		this._view._render();
		this._view._updateViewStats();
	}

	_suppressContextMenu(event) {
		this._suppressedContextMenu = {
			clientX: event.clientX,
			clientY: event.clientY,
			until: Date.now() + CONTEXT_MENU_SUPPRESSION_TIMEOUT
		};
	}

	_getHandles(selectionRanges) {
		return {
			anchor: this._getHandle(selectionRanges, 'anchor'),
			head: this._getHandle(selectionRanges, 'head')
		};
	}

	_getHandle(selectionRanges, endpoint) {
		let range = selectionRanges.find(x => x[endpoint] && !x.collapsed);
		if (!range?.position?.rects?.length) {
			return null;
		}
		let pageIndex = range.position.pageIndex;
		let page = this._view._pdfPages[pageIndex];
		let pageView = this._view._iframeWindow.PDFViewerApplication.pdfViewer._pages[pageIndex];
		if (!page || !pageView?.div) {
			return null;
		}
		let side = getRangeEndpointSide(range, endpoint);
		let rect = side === 'start' ? range.position.rects[0] : range.position.rects.at(-1);
		return getTextRangeHandle({
			chars: page.chars,
			pageIndex,
			rect,
			side,
			getRect: this._view.getScrollRect.bind(this._view),
			getViewportRotation: this._view.getViewportRotation.bind(this._view),
			padding: 0
		});
	}
}
