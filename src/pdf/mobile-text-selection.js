import {
	getModifiedSelectionRanges,
	getReversedSelectionRanges,
	getSelectionRanges,
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
const ANDROID_HANDLE_WIDTH = 44;
const ANDROID_HANDLE_HEIGHT = 22;
const ANDROID_HANDLE_HOTSPOTS = {
	start: { x: 33, y: 0 },
	end: { x: 11, y: 0 }
};

function pointsEqual(a, b) {
	return a.clientX === b.clientX && a.clientY === b.clientY;
}

function pointDistanceSquared(a, b) {
	return (a.clientX - b.clientX) ** 2 + (a.clientY - b.clientY) ** 2;
}

function placementsMatch(a, b) {
	return a?.side === b?.side && a?.rotation === b?.rotation;
}

function getOppositeSide(side) {
	return side === 'start' ? 'end' : 'start';
}

function getInlineCoordinate(point, rotation) {
	if (rotation === 90) {
		return point.clientY;
	}
	if (rotation === 180) {
		return -point.clientX;
	}
	if (rotation === 270) {
		return -point.clientY;
	}
	return point.clientX;
}

function getBlockCoordinate(point, rotation) {
	if (rotation === 90) {
		return -point.clientX;
	}
	if (rotation === 180) {
		return -point.clientY;
	}
	if (rotation === 270) {
		return point.clientX;
	}
	return point.clientY;
}

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
		placements[endpoint] = getHandlePlacement(handles[endpoint]);
	}
	return placements;
}

function getHandlePlacement(handle) {
	let { rect, rotation, side } = handle;
	let x = (rect[0] + rect[2]) / 2;
	let y = (rect[1] + rect[3]) / 2;
	let [outwardX, outwardY] = getHandleOutwardVector(rotation, side);
	return {
		rect,
		x,
		y,
		outwardX,
		outwardY,
		rotation,
		side
	};
}

function getAndroidHandlePoint(rect, rotation) {
	let x = (rect[0] + rect[2]) / 2;
	let y = (rect[1] + rect[3]) / 2;
	return (
		rotation === 0 && { x, y: rect[3] }
		|| rotation === 90 && { x: rect[0], y }
		|| rotation === 180 && { x, y: rect[1] }
		|| rotation === 270 && { x: rect[2], y }
		|| { x, y }
	);
}

function rotatePoint(point, rotation) {
	let radians = rotation * Math.PI / 180;
	let sin = Math.sin(radians);
	let cos = Math.cos(radians);
	return {
		x: point.x * cos - point.y * sin,
		y: point.x * sin + point.y * cos
	};
}

function getAndroidHandleGripOffset(side, rotation) {
	let offset = {
		x: side === 'start' ? -ANDROID_HANDLE_HEIGHT / 2 : ANDROID_HANDLE_HEIGHT / 2,
		y: ANDROID_HANDLE_HEIGHT / 2
	};
	return rotatePoint(offset, rotation);
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

function getSelectionRangeEndpointPosition(selectionRanges, endpoint) {
	let range = selectionRanges.find(x => x[endpoint]);
	if (!range) {
		return null;
	}
	return {
		pageIndex: range.position.pageIndex,
		offset: endpoint === 'anchor' ? range.anchorOffset : range.headOffset
	};
}

function compareTextPositions(a, b) {
	if (a.pageIndex !== b.pageIndex) {
		return a.pageIndex - b.pageIndex;
	}
	return a.offset - b.offset;
}

function getSelectionRangesLength(selectionRanges) {
	return selectionRanges.reduce((length, range) => {
		return length + Math.abs(range.headOffset - range.anchorOffset);
	}, 0);
}

function getSelectionRangesNextToFixedEndpoint(pdfPages, selectionRanges, endpoint, side) {
	let fixedEndpoint = endpoint === 'anchor' ? 'head' : 'anchor';
	let fixedPosition = getSelectionRangeEndpointPosition(selectionRanges, fixedEndpoint);
	if (!fixedPosition) {
		return [];
	}
	let collapsed = getSelectionRanges(pdfPages, fixedPosition, fixedPosition);
	if (!collapsed.length) {
		return [];
	}
	let reversed = endpoint === 'anchor';
	if (reversed) {
		collapsed = getReversedSelectionRanges(collapsed);
	}
	let modified = getModifiedSelectionRanges(pdfPages, collapsed, side === 'start' ? 'left' : 'right');
	if (!modified.length) {
		return [];
	}
	return reversed ? getReversedSelectionRanges(modified) : modified;
}

class MobileSelectionHandleLayer {
	constructor(view) {
		let doc = view._iframeWindow.document;
		let container = doc.getElementById('viewerContainer');
		this._platform = view._options.platform;
		this._el = doc.createElement('div');
		this._el.className = 'mobileTextSelectionHandles';
		this._handles = {};
		this._glyphs = {};
		this._placements = {};
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

	getHandlePlacement(endpoint) {
		return this._placements[endpoint] || null;
	}

	getPlacementForHandle(handle) {
		return getHandlePlacement(handle);
	}

	getGripClientPointForPlacement(placement) {
		if (this._platform === 'android') {
			let point = getAndroidHandlePoint(placement.rect, placement.rotation);
			let offset = getAndroidHandleGripOffset(placement.side, placement.rotation);
			return {
				clientX: point.x + offset.x,
				clientY: point.y + offset.y
			};
		}
		return {
			clientX: placement.x,
			clientY: placement.y
		};
	}

	getGripClientPointForHandle(handle) {
		return this.getGripClientPointForPlacement(this.getPlacementForHandle(handle));
	}

	getHandleSelectionClientPoint(endpoint) {
		let handle = this._handles[endpoint];
		if (!handle) {
			return null;
		}
		if (this._platform === 'android') {
			let rect = handle.getBoundingClientRect();
			return {
				clientX: (rect.left + rect.right) / 2,
				clientY: (rect.top + rect.bottom) / 2
			};
		}
		let rect = this._glyphs[endpoint]?.getBoundingClientRect();
		if (!rect) {
			return null;
		}
		return {
			clientX: (rect.left + rect.right) / 2,
			clientY: (rect.top + rect.bottom) / 2
		};
	}

	getHandleGripClientPoint(endpoint) {
		let point = this.getHandleSelectionClientPoint(endpoint);
		if (!point) {
			return null;
		}
		if (this._platform === 'android') {
			let placement = this._placements[endpoint];
			if (!placement) {
				return null;
			}
			let offset = getAndroidHandleGripOffset(placement.side, placement.rotation);
			return {
				clientX: point.clientX + offset.x,
				clientY: point.clientY + offset.y
			};
		}
		return point;
	}

	getSelectionPointForGripPoint(endpoint, point, placement = this._placements[endpoint]) {
		if (this._platform !== 'android') {
			return point;
		}
		if (!placement) {
			return point;
		}
		let offset = getAndroidHandleGripOffset(placement.side, placement.rotation);
		return {
			clientX: point.clientX - offset.x,
			clientY: point.clientY - offset.y
		};
	}

	hide() {
		this._el.hidden = true;
		this._placements = {};
	}

	show(handles) {
		if (!handles.anchor || !handles.head) {
			this.hide();
			return;
		}
		this._el.hidden = false;
		let placements = getHandlePlacements(handles);
		this._placements = placements;
		let touchOffset = HANDLE_TOUCH_SIZE / 2;
		for (let endpoint of ['anchor', 'head']) {
			let handle = this._handles[endpoint];
			let glyph = this._glyphs[endpoint];
			let { rect, x, y, outwardX, outwardY, rotation, side } = placements[endpoint];
			handle.dataset.side = side;
			handle.style.setProperty('--selection-handle-rotation', `${rotation}deg`);
			if (this._platform === 'android') {
				let point = getAndroidHandlePoint(rect, rotation);
				let hotspot = ANDROID_HANDLE_HOTSPOTS[side];
				handle.style.left = `${point.x}px`;
				handle.style.top = `${point.y}px`;
				glyph.style.left = `${touchOffset - hotspot.x}px`;
				glyph.style.top = `${touchOffset - hotspot.y}px`;
				glyph.style.setProperty('--selection-handle-transform-origin', `${hotspot.x}px ${hotspot.y}px`);
				glyph.style.width = `${ANDROID_HANDLE_WIDTH}px`;
				glyph.style.height = `${ANDROID_HANDLE_HEIGHT}px`;
			}
			else {
				handle.style.left = `${x + outwardX * touchOffset}px`;
				handle.style.top = `${y + outwardY * touchOffset}px`;
				glyph.style.left = `${HANDLE_GLYPH_LEFT - outwardX * touchOffset}px`;
				glyph.style.top = `${HANDLE_GLYPH_TOP - outwardY * touchOffset}px`;
				glyph.style.removeProperty('--selection-handle-transform-origin');
				glyph.style.removeProperty('width');
				glyph.style.removeProperty('height');
			}
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

	handleTouchCancel() {
		let handled = !!this._drag || !!this._pending;
		this._clearPending();
		this._finishDrag({ updatePopup: true });
		return handled;
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
		if (this._drag) {
			this._updateDragFromPoint(this._drag.touchPoint, { updateAutoScroll: false });
			return;
		}
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
		let gripPoint = this._handleLayer.getHandleGripClientPoint(endpoint);
		this._clearPending();
		this._drag = {
			pointerId: event.pointerId,
			endpoint,
			pageIndex: this._view._selectionRanges.find(x => x[endpoint])?.position.pageIndex,
			gripPoint: null,
			touchPoint: null,
			touchOffsetX: gripPoint ? event.clientX - gripPoint.clientX : 0,
			touchOffsetY: gripPoint ? event.clientY - gripPoint.clientY : 0
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
		let point = { clientX: event.clientX, clientY: event.clientY };
		this._updateDragFromPoint(point);
	}

	_updateDragFromPoint(touchPoint, { updateAutoScroll = true } = {}) {
		if (!touchPoint) {
			return;
		}
		this._drag.touchPoint = touchPoint;
		this._drag.gripPoint = this._getDragGripPoint(touchPoint);
		this._updateSelectionForDragGripPoint();
		if (updateAutoScroll) {
			this._view._autoScroll.update(touchPoint.clientX, touchPoint.clientY);
		}
	}

	_updateSelectionForDragGripPoint() {
		let placement = this._handleLayer.getHandlePlacement(this._drag.endpoint);
		if (!placement) {
			return;
		}
		let candidate = this._getBestDragCandidate(placement);
		if (!candidate) {
			return;
		}
		this._view._setSelectionRanges(candidate.selectionRanges, { updatePopup: false });
		this._view._render();
	}

	_getBestDragCandidate(placement) {
		let candidates = [];
		for (let side of [placement.side, getOppositeSide(placement.side)]) {
			let candidate = this._getDragCandidateForPlacement({ ...placement, side });
			if (candidate?.selectionRanges) {
				candidates.push(candidate);
			}
		}
		for (let side of ['start', 'end']) {
			let candidate = this._getNearCollapsedDragCandidate(side);
			if (candidate) {
				candidates.push(candidate);
			}
		}
		candidates.sort((a, b) => a.score - b.score || a.length - b.length);
		return candidates[0] || null;
	}

	_getDragCandidateForPlacement(placement) {
		let candidate = null;
		let previousSelectionPoint = null;
		for (let i = 0; i < 3; i++) {
			let selectionPoint = this._handleLayer.getSelectionPointForGripPoint(
				this._drag.endpoint,
				this._drag.gripPoint,
				placement
			);
			if (previousSelectionPoint && pointsEqual(selectionPoint, previousSelectionPoint)) {
				return candidate;
			}
			previousSelectionPoint = selectionPoint;

			let selectionRanges = this._getSelectionRangesForDragPoint(selectionPoint);
			if (!selectionRanges.length) {
				return null;
			}
			if (selectionRanges[0].collapsed) {
				return null;
			}

			let handle = this._getHandle(selectionRanges, this._drag.endpoint);
			if (!handle) {
				return null;
			}
			let nextPlacement = this._handleLayer.getPlacementForHandle(handle);
			candidate = this._createDragCandidate(selectionRanges, handle);
			if (!candidate) {
				return null;
			}
			if (placementsMatch(placement, nextPlacement)) {
				return candidate;
			}
			placement = nextPlacement;
		}
		return null;
	}

	_getNearCollapsedDragCandidate(side) {
		let selectionRanges = getSelectionRangesNextToFixedEndpoint(
			this._view._pdfPages,
			this._view._selectionRanges,
			this._drag.endpoint,
			side
		);
		if (!selectionRanges.length || selectionRanges[0].collapsed) {
			return null;
		}
		let handle = this._getHandle(selectionRanges, this._drag.endpoint);
		if (!handle) {
			return null;
		}
		return this._createDragCandidate(selectionRanges, handle);
	}

	_createDragCandidate(selectionRanges, handle) {
		let endpointPosition = getSelectionRangeEndpointPosition(selectionRanges, this._drag.endpoint);
		if (!this._candidateMatchesDragDirection(endpointPosition, handle.rotation)) {
			return null;
		}
		let gripPoint = this._handleLayer.getGripClientPointForHandle(handle);
		return {
			selectionRanges,
			length: getSelectionRangesLength(selectionRanges),
			score: pointDistanceSquared(this._drag.gripPoint, gripPoint)
		};
	}

	_candidateMatchesDragDirection(endpointPosition, rotation) {
		let currentPosition = getSelectionRangeEndpointPosition(this._view._selectionRanges, this._drag.endpoint);
		let currentGripPoint = this._handleLayer.getHandleGripClientPoint(this._drag.endpoint);
		if (!endpointPosition || !currentPosition || !currentGripPoint) {
			return true;
		}

		let inlineDelta = getInlineCoordinate(this._drag.gripPoint, rotation) - getInlineCoordinate(currentGripPoint, rotation);
		let blockDelta = getBlockCoordinate(this._drag.gripPoint, rotation) - getBlockCoordinate(currentGripPoint, rotation);
		if (Math.abs(inlineDelta) < 2 || Math.abs(inlineDelta) < Math.abs(blockDelta)) {
			return true;
		}

		let positionDelta = compareTextPositions(endpointPosition, currentPosition);
		return positionDelta === 0 || Math.sign(positionDelta) === Math.sign(inlineDelta);
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

	_getDragGripPoint(touchPoint) {
		return {
			clientX: touchPoint.clientX - this._drag.touchOffsetX,
			clientY: touchPoint.clientY - this._drag.touchOffsetY
		};
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
