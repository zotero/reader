import {
	applyTransform,
	getPositionBoundingRect,
	getRotationTransform,
	transform,
	scaleShape,
	getRotationDegrees,
	normalizeDegrees,
	inverseTransform,
	darkenHex,
	quickIntersectRect
} from './lib/utilities';
import {
	DARKEN_INK_AND_TEXT_COLOR,
	FIND_RESULT_COLOR_ALL_DARK,
	FIND_RESULT_COLOR_ALL_LIGHT,
	FIND_RESULT_COLOR_CURRENT_DARK,
	FIND_RESULT_COLOR_CURRENT_LIGHT,
	MIN_IMAGE_ANNOTATION_SIZE,
	READ_ALOUD_ACTIVE_SEGMENT_COLOR,
	READ_ALOUD_ACTIVE_SENTENCE_COLOR,
	SELECTION_COLOR
} from '../common/defines';
import { getRectRotationOnText } from './selection';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Note icon geometry in a 24 x 24 box, shared by the SVG and canvas renderers
const NOTE_ICON_BASE = [0.5, 0.5, 23.5, 0.5, 23.5, 23.5, 11.5, 23.5, 0.5, 12.5];
const NOTE_ICON_FOLD = [0.5, 12.5, 11.5, 12.5, 11.5, 23.5];
const NOTE_ICON_OUTLINE = 'M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z';

// Round coordinates so display-list signatures are stable across renders
function round(value) {
	return Math.round(value * 100) / 100;
}

// Renders the overlay (annotations, selection, find results, etc.) for a single
// page as DOM elements positioned over the pdf.js page canvas, instead of
// painting into the canvas. The canvas always contains pristine pdf.js output,
// so no snapshot of it is ever needed, halving the memory cost of a rendered
// page. Tint-like content that previously blended with page pixels through
// globalCompositeOperation uses the equivalent mix-blend-mode, and everything
// else was drawn with source-over compositing, which produces identical pixels
// when drawn on a transparent layer above the canvas.
//
// The overlay is described by a display list: a flat array of primitives in
// paint order. Rect primitives become divs (they may need mix-blend-mode, which
// has to blend against the page canvas and therefore can't be isolated inside
// an <svg>), while vector primitives (paths, circles, stroked rects, note
// icons) are grouped into <svg> elements. Because the DOM overlay is positioned
// in CSS pixels over the whole page div, it also covers the high-zoom detail
// canvas, which no longer needs its own overlay pass.
export default class Page {
	constructor(layer, originalPage) {
		this._layer = layer;
		this._originalPage = originalPage;
		this._pageIndex = originalPage.id - 1;
		this._lastSignature = null;
	}

	get pageIndex() {
		return this._pageIndex;
	}

	get originalPage() {
		return this._originalPage;
	}

	refresh() {
		this.render();
	}

	// Computes PDF -> CSS pixel transform within the page div
	get _transform() {
		return this._originalPage.viewport.transform;
	}

	get _scale() {
		let [a, b] = this._transform;
		return Math.hypot(a, b);
	}

	_getViewPoint(p, tfm = this._transform) {
		return applyTransform(p, tfm);
	}

	_getViewRect(rect, tfm = this._transform) {
		let p1 = applyTransform(rect, tfm);
		let p2 = applyTransform(rect.slice(2, 4), tfm);
		let [x1, y1] = p1;
		let [x2, y2] = p2;
		return [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];
	}

	_p2v(position) {
		let tfm = this._transform;
		if (position.rects) {
			let mapRect = rect => this._getViewRect(rect, tfm);
			if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
				return {
					pageIndex: position.pageIndex,
					nextPageRects: position.nextPageRects.map(mapRect)
				};
			}
			return {
				pageIndex: position.pageIndex,
				rects: position.rects.map(mapRect)
			};
		}
		if (position.paths) {
			return {
				pageIndex: position.pageIndex,
				width: position.width * this._scale,
				paths: position.paths.map((path) => {
					let vpath = [];
					for (let i = 0; i < path.length - 1; i += 2) {
						vpath.push(...applyTransform([path[i], path[i + 1]], tfm));
					}
					return vpath;
				})
			};
		}
		return undefined;
	}

	_positionAffectsPage(position) {
		return !!position && (
			position.pageIndex === this._pageIndex
			|| !!position.nextPageRects && position.pageIndex + 1 === this._pageIndex
		);
	}

	// The rotation of the text under a rect, in view coordinates
	_getTextRotation(chars, pdfRect) {
		let rotation = getRectRotationOnText(chars, pdfRect);
		rotation += getRotationDegrees(this._transform);
		return normalizeDegrees(rotation);
	}

	_rectsForThisPage(position) {
		if (position.pageIndex === this._pageIndex) {
			return position.rects;
		}
		if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
			return position.nextPageRects;
		}
		return null;
	}

	// -------- Display-list building --------

	_pushRect(items, rect, style) {
		items.push({
			kind: 'rect',
			rect: rect.map(round),
			...style
		});
	}

	// Push one rect item per rect of `position` that falls on this page
	_pushPositionRects(items, position, style) {
		let rects = this._rectsForThisPage(this._p2v(position));
		if (!rects) {
			return;
		}
		for (let rect of rects) {
			this._pushRect(items, rect, style);
		}
	}

	_pushHighlight(items, annotation) {
		let dark = this._layer._themeColorScheme === 'dark';
		this._pushPositionRects(items, annotation.position, {
			color: annotation.color,
			opacity: dark ? 0.3 : 0.4,
			// Canvas used 'lighter' (additive) in dark mode and 'multiply' in light
			blend: dark ? 'plus-lighter' : 'multiply'
		});
	}

	_pushUnderline(items, annotation) {
		let pageData = this._layer._pdfPages[this._pageIndex];
		if (!pageData) {
			return;
		}
		let dark = this._layer._themeColorScheme === 'dark';
		let style = {
			color: annotation.color,
			opacity: dark ? 0.9 : 1,
			blend: dark ? undefined : 'multiply'
		};
		let { chars } = pageData;
		let position = this._p2v(annotation.position);
		let rects;
		let pdfRect;
		if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
			rects = position.nextPageRects;
			pdfRect = annotation.position.nextPageRects[0];
		}
		else {
			rects = position.rects;
			pdfRect = annotation.position.rects[0];
		}
		let width = 1 * this._scale;
		for (let rect of rects) {
			let rotation = this._getTextRotation(chars, pdfRect);
			let [x1, y1, x2, y2] = rect;
			let rect2 = (
				rotation === 0 && [x1, y2 - width, x2, y2]
				|| rotation === 90 && [x2 - width, y2, x2, y1]
				|| rotation === 180 && [x1, y1, x2, y1 - width]
				|| rotation === 270 && [x1, y2, x1 - width, y1]
			);
			this._pushRect(items, [
				Math.min(rect2[0], rect2[2]),
				Math.min(rect2[1], rect2[3]),
				Math.max(rect2[0], rect2[2]),
				Math.max(rect2[1], rect2[3])
			], style);
		}
	}

	_pushNote(items, annotation) {
		let position = this._p2v(annotation.position);
		let viewRect = position.rects[0];
		items.push({
			kind: 'noteIcon',
			x: round(viewRect[0]),
			y: round(viewRect[1]),
			scale: round(this._scale),
			color: annotation.color
		});
	}

	_pushImage(items, annotation) {
		let position = this._p2v(annotation.position);
		let rect = position.rects[0];
		// Make image annotation more opaque if it's still too small
		let pdfRect = annotation.position.rects[0];
		let width = pdfRect[2] - pdfRect[0];
		let height = pdfRect[3] - pdfRect[1];
		let small = width < MIN_IMAGE_ANNOTATION_SIZE || height < MIN_IMAGE_ANNOTATION_SIZE;
		items.push({
			kind: 'strokedRect',
			rect: rect.map(round),
			stroke: annotation.color,
			strokeWidth: 3,
			opacity: small ? 0.2 : 1
		});
	}

	_pushInk(items, annotation) {
		let position = this._p2v(annotation.position);
		let d = '';
		for (let path of position.paths) {
			for (let i = 0; i < path.length - 1; i += 2) {
				let x = round(path[i]);
				let y = round(path[i + 1]);
				d += (i === 0 ? `M${x} ${y}` : '') + `L${x} ${y}`;
			}
		}
		items.push({
			kind: 'path',
			d,
			stroke: darkenHex(annotation.color, DARKEN_INK_AND_TEXT_COLOR),
			strokeWidth: round(position.width),
			cap: 'round',
			join: 'round'
		});
	}

	_pushCommentIcons(items, annotations) {
		// Hide icon for the annotation being resized (image) or range-updated (highlight/underline)
		let action = this._layer.action;

		let notes = [];
		let width = 7;
		let height = 7;
		for (let annotation of annotations) {
			if (
				!['highlight', 'underline', 'image'].includes(annotation.type)
				|| !annotation.comment
				|| annotation.position.pageIndex !== this._pageIndex
			) {
				continue;
			}

			// Skip the icon for the annotation currently being modified
			let isResizingTarget = (
				action
				&& action.triggered
				&& action.annotation
				&& action.annotation.id === annotation.id
				&& (
					(action.type === 'resize' && annotation.type === 'image')
					|| (action.type === 'updateAnnotationRange' && (annotation.type === 'highlight' || annotation.type === 'underline'))
				)
			);
			if (isResizingTarget) {
				continue;
			}

			let position = annotation.position;
			let left = position.rects[0][0] - width / 2;
			let top = position.rects[0][3] - height / 3;
			notes.push({
				annotation,
				rect: [
					left,
					top,
					left + width,
					top + height
				]
			});
		}

		notes.reverse();
		notes.sort((a, b) => a.rect[0] - b.rect[0]);
		for (let note of notes) {
			for (let note2 of notes) {
				if (note2 === note) break;
				if (quickIntersectRect(note.rect, note2.rect)) {
					let shift = (note2.rect[2] - note2.rect[0]) / 3 * 2;
					note.rect[0] = note2.rect[0] + shift;
					note.rect[2] = note2.rect[2] + shift;
				}
			}
		}

		for (let note of notes) {
			let scale = Math.abs(this._getViewPoint([1 / (24 / width), 0])[0] - this._getViewPoint([0, 0])[0]);
			let rect = this._getViewRect(note.rect);
			items.push({
				kind: 'noteIcon',
				x: round(rect[0]),
				y: round(rect[1]),
				scale: round(scale),
				color: note.annotation.color,
				opacity: 0.5
			});
		}
	}

	// Citation and matched internal-link overlay tints
	_pushOverlays(items) {
		let pageData = this._layer._pdfPages[this._pageIndex];
		if (!pageData) {
			return;
		}
		let dark = this._layer._themeColorScheme === 'dark';
		let style = {
			color: '#76c6ff',
			opacity: dark ? 0.4 : 0.1,
			blend: dark ? 'lighten' : 'multiply'
		};
		for (let overlay of pageData.overlays) {
			if (!(overlay.type === 'citation' || overlay.type === 'internal-link' && overlay.source === 'matched')) {
				continue;
			}
			this._pushPositionRects(items, overlay.position, style);
		}
	}

	_pushHover(items) {
		if (!this._layer._hover) {
			return;
		}
		let dark = this._layer._themeColorScheme === 'dark';
		this._pushPositionRects(items, this._layer._hover, {
			color: '#46b1ff',
			opacity: dark ? 0.5 : 0.1,
			blend: dark ? 'lighten' : 'multiply'
		});
	}

	_pushFindResults(items) {
		let findController = this._layer._findController;
		if (!findController
			|| !findController.highlightMatches
			|| !findController._matchesCountTotal
			|| !this._layer._pdfPages[this._pageIndex]
		) {
			return;
		}
		let { selected } = findController;
		let positions = findController.getMatchPositions(
			this._pageIndex,
			this._layer._pdfPages[this._pageIndex]
		);
		if (!positions || !positions.length) {
			return;
		}

		let dark = this._layer._themeColorScheme === 'dark';
		// The canvas radius was 5 device pixels
		let radius = round(5 / devicePixelRatio);
		for (let i = 0; i < positions.length; i++) {
			let current = selected.pageIdx === this._pageIndex && i === selected.matchIdx;
			if (!current && !findController.state.highlightAll) {
				continue;
			}
			let color = current
				? (dark ? FIND_RESULT_COLOR_CURRENT_DARK : FIND_RESULT_COLOR_CURRENT_LIGHT)
				: (dark ? FIND_RESULT_COLOR_ALL_DARK : FIND_RESULT_COLOR_ALL_LIGHT);
			let position = this._p2v(positions[i]);
			for (let rect of position.rects) {
				this._pushRect(items, rect, { color, radius });
			}
		}
	}

	_pushFocusOutline(items) {
		let focusedObject = this._layer._focusedObject;
		if (this._layer._selectedAnnotationIDs.length
			|| !focusedObject
			|| !(
				focusedObject.pageIndex === this._pageIndex
				|| focusedObject.object.position.nextPageRects && focusedObject.pageIndex === this._pageIndex
			)
		) {
			return;
		}
		let position = focusedObject.object.position;
		let padding = 5;
		let rect = getPositionBoundingRect(position, this._pageIndex);
		rect = this._getViewRect(rect);
		items.push({
			kind: 'strokedRect',
			rect: [
				round(rect[0] - padding),
				round(rect[1] - padding),
				round(rect[2] + padding),
				round(rect[3] + padding)
			],
			stroke: window.computedColorFocusBorder,
			strokeWidth: 3,
			rx: 10
		});
	}

	_pushPolygon(items, points, style) {
		let d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p[0])} ${round(p[1])}`).join('') + 'Z';
		items.push({ kind: 'path', d, ...style });
	}

	_pushSelectedOutlines(items, annotations) {
		let action = this._layer.action;
		if (action?.type === 'updateAnnotationRange' && action?.triggered) {
			return;
		}
		let selectedAnnotationIDs = this._layer._selectedAnnotationIDs;
		let selectedAnnotations = annotations.filter(x => selectedAnnotationIDs.includes(x.id));
		for (let annotation of selectedAnnotations) {
			let strokeWidth = annotation.type === 'image' ? 3 : 2;
			let rect = getPositionBoundingRect(annotation.position, this._pageIndex);
			let rotation = 0;
			if (annotation.type === 'text') {
				rect = annotation.position.rects[0];
			}
			if (['image', 'text', 'ink'].includes(annotation.type)) {
				rotation = annotation.position.rotation;
				if (action && ['resize', 'rotate'].includes(action.type) && action.triggered) {
					if (annotation.type === 'text') {
						rect = action.position.rects[0];
					}
					else {
						rect = getPositionBoundingRect(action.position);
					}
					rotation = action.position.rotation;
				}
			}
			let tm = this._transform;
			if (annotation.type === 'text') {
				tm = getRotationTransform(rect, rotation || 0);
				tm = transform(this._transform, tm);
			}
			let [x1, y1, x2, y2] = rect;
			let midX = (x1 + x2) / 2;
			let midY = (y1 + y2) / 2;
			let ROTATION_BOTTOM = 16;
			// Corners, edge midpoints, and the rotation handle below the box
			let [p1, p2, p3, p4, pml, pmr, pmt, pmb, pr] = [
				[x1, y1],
				[x2, y1],
				[x2, y2],
				[x1, y2],
				[x1, midY],
				[x2, midY],
				[midX, y2],
				[midX, y1],
				[midX, y2 + ROTATION_BOTTOM]
			].map(p => this._getViewPoint(p, tm));
			let BOX_PADDING = 10;
			if (annotation.type !== 'image') {
				[p1, p2, p3, p4, pml, pmr, pmt, pmb] = scaleShape([p1, p2, p3, p4], [p1, p2, p3, p4, pml, pmr, pmt, pmb], BOX_PADDING);
			}
			let editable = !(this._layer._readOnly || annotation.readOnly);
			let boxStyle = {
				stroke: '#6d95e0',
				strokeWidth,
				dash: '5 3'
			};
			this._pushPolygon(items, [p1, p2, p3, p4], boxStyle);
			if (editable && annotation.type === 'text') {
				items.push({
					kind: 'path',
					d: `M${round(pmt[0])} ${round(pmt[1])}L${round(pr[0])} ${round(pr[1])}`,
					...boxStyle
				});
			}
			if (editable) {
				let radius = 4;
				let handles = [];
				if (['image', 'text', 'ink'].includes(annotation.type)) {
					handles.push(p1, p2, p4, p3);
				}
				if (['image', 'text'].includes(annotation.type)) {
					handles.push(pmr, pml);
				}
				if (annotation.type === 'image') {
					handles.push(pmt, pmb);
				}
				if (annotation.type === 'text') {
					handles.push(pr);
				}
				for (let p of handles) {
					items.push({
						kind: 'circle',
						cx: round(p[0]),
						cy: round(p[1]),
						r: radius,
						fill: '#81b3ff'
					});
				}
			}
		}
	}

	// Start/end drag handles for the first selected highlight/underline annotation
	_pushRangeGrippers(items, annotations) {
		let action = this._layer.action;
		let selectedAnnotationIDs = this._layer._selectedAnnotationIDs;
		let annotation = annotations.find(x => x.id === selectedAnnotationIDs[0]);
		if (!annotation || !['highlight', 'underline'].includes(annotation.type)) {
			return;
		}
		let annotation2 = annotation;
		if (action?.type === 'updateAnnotationRange' && action.annotation) {
			annotation2 = action.annotation;
		}
		if (!this._layer._pdfPages[this._pageIndex]
			|| annotation2.position.nextPageRects && !this._layer._pdfPages[this._pageIndex + 1]) {
			return;
		}
		if (this._layer._readOnly || annotation.readOnly) {
			return;
		}
		let position = this._p2v(annotation2.position);
		let style = {
			color: annotation2.color,
			blend: this._layer._themeColorScheme === 'light' ? 'multiply' : undefined
		};
		let padding = 1;
		// A gripper is a thin strip on the leading text edge of a rect; the
		// trailing (end) edge is the leading edge of the rect rotated by 180°
		let gripperRect = (chars, pdfRect, viewRect, end) => {
			let rotation = normalizeDegrees(this._getTextRotation(chars, pdfRect) + (end ? 180 : 0));
			let [x1, y1, x2, y2] = viewRect;
			return (
				rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
				|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
				|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
				|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
			);
		};
		let { chars } = this._layer._pdfPages[this._pageIndex];
		let pdfPosition = annotation2.position;
		if (pdfPosition.nextPageRects) {
			if (position.pageIndex + 1 === this._pageIndex) {
				let { chars } = this._layer._pdfPages[this._pageIndex + 1];
				this._pushRect(items, gripperRect(chars, pdfPosition.nextPageRects.at(-1), position.nextPageRects.at(-1), true), style);
			}
			else {
				this._pushRect(items, gripperRect(chars, pdfPosition.rects[0], position.rects[0], false), style);
			}
		}
		else {
			this._pushRect(items, gripperRect(chars, pdfPosition.rects[0], position.rects[0], false), style);
			this._pushRect(items, gripperRect(chars, pdfPosition.rects.at(-1), position.rects.at(-1), true), style);
		}
	}

	_pushSelection(items) {
		let layer = this._layer;
		if (layer._selectionRanges.length && !layer._selectionRanges[0].collapsed && ['highlight', 'underline'].includes(layer._tool.type)) {
			let annotation = layer._getAnnotationFromSelectionRanges(layer._selectionRanges, layer._tool.type, layer._tool.color);
			if (this._positionAffectsPage(annotation.position)) {
				if (annotation.type === 'highlight') {
					this._pushHighlight(items, annotation);
				}
				else {
					this._pushUnderline(items, annotation);
				}
			}
		}
		else {
			let dark = layer._themeColorScheme === 'dark';
			let style = {
				color: SELECTION_COLOR,
				opacity: dark ? 0.7 : 0.4,
				blend: dark ? 'lighten' : 'multiply'
			};
			for (let { position } of layer._selectionRanges) {
				if (position.pageIndex === this._pageIndex) {
					this._pushPositionRects(items, position, style);
				}
			}
		}
	}

	_pushAction(items) {
		let action = this._layer.action;
		if (!action) {
			return;
		}
		if (action.type === 'moveAndDrag' && action.triggered) {
			if (action.annotation.position.pageIndex === this._pageIndex) {
				let rect = getPositionBoundingRect(action.position);
				let tm = this._transform;
				if (action.annotation.type === 'text') {
					rect = action.position.rects[0];
					tm = getRotationTransform(rect, action.annotation.position.rotation || 0);
					tm = transform(this._transform, tm);
				}
				let [x1, y1, x2, y2] = rect;
				let [p1, p2, p3, p4] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
					.map(p => this._getViewPoint(p, tm));
				let BOX_PADDING = 10;
				[p1, p2, p3, p4] = scaleShape([p1, p2, p3, p4], [p1, p2, p3, p4], BOX_PADDING);
				this._pushPolygon(items, [p1, p2, p3, p4], {
					stroke: '#aaaaaa',
					strokeWidth: 2,
					dash: '5 3'
				});
			}
		}
		else if (action.type === 'image' && action.annotation) {
			if (action.annotation.position.pageIndex === this._pageIndex) {
				this._pushImage(items, action.annotation);
			}
		}
		else if (action.type === 'ink' && action.annotation) {
			if (action.annotation.position.pageIndex === this._pageIndex) {
				this._pushInk(items, action.annotation);
			}
		}
	}

	_pushHighlightedPosition(items, position, color) {
		if (!this._positionAffectsPage(position)) {
			return;
		}
		let annotation = { position, color };
		if (position.rects) {
			this._pushHighlight(items, annotation);
		}
		else if (position.paths) {
			this._pushInk(items, annotation);
		}
	}

	_buildDisplayList() {
		let items = [];
		let annotations = this._layer._getPageAnnotations(this._pageIndex);
		let action = this._layer.action;

		for (let annotation of annotations) {
			// Skip a highlight/underline whose range is currently being updated;
			// the action's own annotation is drawn below instead
			let rangeUpdating = action?.type === 'updateAnnotationRange' && action.annotation.id === annotation.id;
			if (annotation.type === 'highlight' && !rangeUpdating) {
				this._pushHighlight(items, annotation);
			}
			else if (annotation.type === 'underline' && !rangeUpdating) {
				this._pushUnderline(items, annotation);
			}
			else if (annotation.type === 'note') {
				this._pushNote(items, annotation);
			}
			else if (annotation.type === 'image') {
				if (!this._layer._selectedAnnotationIDs.includes(annotation.id)) {
					this._pushImage(items, annotation);
				}
			}
			else if (annotation.type === 'ink') {
				if (action && action.position && action.type === 'resize' && action.annotation.id === annotation.id) {
					this._pushInk(items, { ...annotation, position: action.position });
				}
				else if (action && action.triggered && action.type === 'erase' && action.annotations.has(annotation.id)) {
					let { position } = action.annotations.get(annotation.id);
					this._pushInk(items, { ...annotation, position });
				}
				else {
					this._pushInk(items, annotation);
				}
			}
		}

		if (action?.type === 'updateAnnotationRange' && this._positionAffectsPage(action.annotation.position)) {
			if (action.annotation.type === 'highlight') {
				this._pushHighlight(items, action.annotation);
			}
			else if (action.annotation.type === 'underline') {
				this._pushUnderline(items, action.annotation);
			}
		}

		this._pushCommentIcons(items, annotations);
		this._pushOverlays(items);
		this._pushHover(items);
		this._pushFindResults(items);
		this._pushFocusOutline(items);
		this._pushSelectedOutlines(items, annotations);
		this._pushRangeGrippers(items, annotations);
		this._pushSelection(items);
		this._pushAction(items);
		this._pushHighlightedPosition(items, this._layer._readAloudHighlightedPosition, READ_ALOUD_ACTIVE_SEGMENT_COLOR);
		let sentencePosition = this._layer._readAloudSentenceHighlightedPosition;
		if (sentencePosition && sentencePosition.rects) {
			this._pushHighlightedPosition(items, sentencePosition, READ_ALOUD_ACTIVE_SENTENCE_COLOR);
		}
		this._pushHighlightedPosition(items, this._layer._highlightedPosition, SELECTION_COLOR);

		return items;
	}

	// -------- DOM building --------

	_createNoteIcon(doc, item) {
		let g = doc.createElementNS(SVG_NS, 'g');
		g.setAttribute('transform', `translate(${item.x} ${item.y}) scale(${item.scale})`);
		if (item.opacity !== undefined) {
			g.setAttribute('opacity', item.opacity);
		}
		let addPolygon = (points, fill) => {
			let polygon = doc.createElementNS(SVG_NS, 'polygon');
			polygon.setAttribute('points', points.join(' '));
			polygon.setAttribute('fill', fill);
			g.append(polygon);
		};
		addPolygon(NOTE_ICON_BASE, item.color);
		addPolygon(NOTE_ICON_FOLD, 'rgba(255, 255, 255, 0.4)');
		let outline = doc.createElementNS(SVG_NS, 'path');
		outline.setAttribute('d', NOTE_ICON_OUTLINE);
		outline.setAttribute('fill', '#000');
		g.append(outline);
		return g;
	}

	_createVectorElement(doc, item) {
		if (item.kind === 'noteIcon') {
			return this._createNoteIcon(doc, item);
		}
		let node;
		if (item.kind === 'path') {
			node = doc.createElementNS(SVG_NS, 'path');
			node.setAttribute('d', item.d);
		}
		else if (item.kind === 'circle') {
			node = doc.createElementNS(SVG_NS, 'circle');
			node.setAttribute('cx', item.cx);
			node.setAttribute('cy', item.cy);
			node.setAttribute('r', item.r);
		}
		else if (item.kind === 'strokedRect') {
			node = doc.createElementNS(SVG_NS, 'rect');
			node.setAttribute('x', item.rect[0]);
			node.setAttribute('y', item.rect[1]);
			node.setAttribute('width', round(item.rect[2] - item.rect[0]));
			node.setAttribute('height', round(item.rect[3] - item.rect[1]));
			if (item.rx) {
				node.setAttribute('rx', item.rx);
			}
		}
		node.setAttribute('fill', item.fill || 'none');
		if (item.stroke) {
			node.setAttribute('stroke', item.stroke);
			node.setAttribute('stroke-width', item.strokeWidth);
		}
		if (item.cap) {
			node.setAttribute('stroke-linecap', item.cap);
		}
		if (item.join) {
			node.setAttribute('stroke-linejoin', item.join);
		}
		if (item.dash) {
			node.setAttribute('stroke-dasharray', item.dash);
		}
		if (item.opacity !== undefined) {
			node.setAttribute('opacity', item.opacity);
		}
		return node;
	}

	// Rect geometry is expressed in scale-1 units multiplied by --scale-factor,
	// which pdf.js updates synchronously on zoom, so the rects track the
	// CSS-stretched page canvas until the page re-renders (the vector <svg>
	// layers already do, by stretching their viewBox with the page div)
	_createRectElement(doc, item) {
		let div = doc.createElement('div');
		div.className = 'overlayRect';
		let { scale } = this._originalPage.viewport;
		let s = value => round(value / scale);
		let [x1, y1, x2, y2] = item.rect;
		let style = `left: calc(${s(x1)}px * var(--scale-factor));`
			+ `top: calc(${s(y1)}px * var(--scale-factor));`
			+ `width: calc(${s(x2 - x1)}px * var(--scale-factor));`
			+ `height: calc(${s(y2 - y1)}px * var(--scale-factor));`
			+ `background-color: ${item.color};`
			+ (item.opacity !== undefined ? `opacity: ${item.opacity};` : '')
			+ (item.blend ? `mix-blend-mode: ${item.blend};` : '')
			+ (item.radius ? `border-radius: calc(${s(item.radius)}px * var(--scale-factor));` : '');
		div.style.cssText = style;
		return div;
	}

	// Build overlay children, grouping consecutive vector primitives into a
	// single <svg>, so DOM order (and therefore paint order and the backdrop
	// that mix-blend-mode rects blend against) matches the display list
	_applyDisplayList(items) {
		let pageDiv = this._originalPage.div;
		let doc = pageDiv.ownerDocument;
		let overlay = pageDiv.querySelector(':scope > .annotationOverlay');
		if (!items.length) {
			overlay?.remove();
			return;
		}
		if (!overlay) {
			// display: contents, so that the children paint as direct children of
			// the page div -- a wrapper with its own box would either paint below
			// the canvas (z-index: auto) or form a stacking context that isolates
			// the rects' mix-blend-mode from the canvas
			overlay = doc.createElement('div');
			overlay.className = 'annotationOverlay';
			pageDiv.append(overlay);
		}
		let { width, height } = this._originalPage.viewport;
		let children = [];
		let svg = null;
		for (let item of items) {
			if (item.kind === 'rect') {
				children.push(this._createRectElement(doc, item));
				svg = null;
			}
			else {
				if (!svg) {
					svg = doc.createElementNS(SVG_NS, 'svg');
					svg.setAttribute('class', 'overlayVector');
					svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
					children.push(svg);
				}
				svg.append(this._createVectorElement(doc, item));
			}
		}
		overlay.replaceChildren(...children);
	}

	// DOM-based text annotations (editable textareas), diffed in place so that
	// focus and typing state survive re-renders
	_renderTextAnnotations(annotations) {
		let doc = this._originalPage.div.ownerDocument;
		let action = this._layer.action;
		let customAnnotationLayer = this._originalPage.div.querySelector('.customAnnotationLayer');
		if (!customAnnotationLayer) {
			customAnnotationLayer = doc.createElement('div');
			customAnnotationLayer.className = 'customAnnotationLayer';
			this._originalPage.div.append(customAnnotationLayer);
		}
		let customAnnotations = Array.from(customAnnotationLayer.children);

		for (let annotation of annotations) {
			if (annotation.type === 'text' && annotation.position.pageIndex === this._pageIndex) {
				let position = annotation.position;
				if (action && action.position && ['resize', 'rotate'].includes(action.type) && action.annotation.id === annotation.id) {
					position = action.position;
				}
				let rect = position.rects[0];

				let node = customAnnotations.find(x => x.getAttribute('data-id') === annotation.id);
				let disabled = this._layer._readOnly || annotation.readOnly;
				let viewport = this._originalPage.viewport;
				let centerX = (rect[0] + rect[2]) / 2;
				let centerY = (rect[1] + rect[3]) / 2;
				// Exclude scale from viewport transform
				let m = transform(inverseTransform([viewport.scale, 0, 0, viewport.scale, 0, 0]), viewport.transform);
				let [x, y] = applyTransform([centerX, centerY], m);
				let width = rect[2] - rect[0];
				let height = rect[3] - rect[1];
				let top = y - height / 2;
				let left = x - width / 2;

				let rotation = viewport.rotation - (position.rotation || 0);

				let style = [
					`left: calc(${left}px * var(--scale-factor))`,
					`top: calc(${top}px * var(--scale-factor))`,
					`min-width: calc(${position.fontSize}px * var(--scale-factor))`,
					`min-height: calc(${position.fontSize}px * var(--scale-factor))`,
					`width: calc(${width}px * var(--scale-factor))`,
					`height: calc(${height}px * var(--scale-factor))`,
					`color: ${darkenHex(annotation.color, DARKEN_INK_AND_TEXT_COLOR)}`,
					`font-size: calc(${position.fontSize}px * var(--scale-factor))`,
					`font-family: ${window.computedFontFamily}`,
					`transform: rotate(${rotation}deg)`
				].join(';');

				if (!node) {
					node = doc.createElement('textarea');
					node.setAttribute('data-id', annotation.id);
					node.dir = 'auto';
					node.className = 'textAnnotation';
					node.disabled = disabled;
					node.addEventListener('blur', () => {
						node.classList.remove('focusable');
					});
					node.addEventListener('keydown', (event) => {
						if (event.key === 'Escape') {
							event.stopPropagation();
							event.preventDefault();
							node.blur();
						}
					});
					customAnnotationLayer.append(node);
				}

				if (node.getAttribute('style') !== style) {
					node.setAttribute('style', style);
				}
				if (node.getAttribute('data-comment') !== annotation.comment) {
					node.value = annotation.comment;
					node.setAttribute('data-comment', annotation.comment);
				}
				if (node.disabled != disabled) {
					node.disabled = disabled;
				}
			}
		}

		// Remove abandoned (deleted) text annotations
		for (let node of customAnnotations) {
			let id = node.getAttribute('data-id');
			if (!annotations.find(x => x.id === id)) {
				node.remove();
			}
		}
	}

	render() {
		let page = this._originalPage;
		if (!page.div || !page.viewport) {
			return;
		}

		this._renderTextAnnotations(this._layer._getPageAnnotations(this._pageIndex));

		// The display list captures every visual input (geometry, colors, theme,
		// state), so serializing it gives an exact change signature. pdf.js
		// removes foreign children from the page div on reset, so also make sure
		// the overlay from the last apply is still attached
		let items = this._buildDisplayList();
		let signature = JSON.stringify(items);
		let hasOverlay = !!page.div.querySelector(':scope > .annotationOverlay');
		if (signature === this._lastSignature && hasOverlay === (items.length > 0)) {
			return;
		}
		this._lastSignature = signature;
		this._applyDisplayList(items);
	}

	_drawNoteIconOnCanvas(ctx, color) {
		let fillPolygon = (points, fill) => {
			ctx.beginPath();
			ctx.fillStyle = fill;
			ctx.moveTo(points[0], points[1]);
			for (let i = 2; i < points.length - 1; i += 2) {
				ctx.lineTo(points[i], points[i + 1]);
			}
			ctx.closePath();
			ctx.fill();
		};
		fillPolygon(NOTE_ICON_BASE, color);
		fillPolygon(NOTE_ICON_FOLD, 'rgba(255, 255, 255, 0.4)');
		ctx.fillStyle = '#000';
		ctx.fill(new Path2D(NOTE_ICON_OUTLINE));
	}

	renderAnnotationOnCanvas(annotation, canvas) {
		let ctx = canvas.getContext('2d');

		let pixelRatio = window.devicePixelRatio;
		let transformMat = this._originalPage.viewport.transform;

		let pdfBoundingRect = getPositionBoundingRect(annotation.position, this._pageIndex);
		let viewBoundingRect = this._getViewRect(pdfBoundingRect, transformMat);
		let width = viewBoundingRect[2] - viewBoundingRect[0];
		let height = viewBoundingRect[3] - viewBoundingRect[1];

		let MAX_SIZE = 200;

		if (width > MAX_SIZE) {
			height = height * MAX_SIZE / width;
			width = MAX_SIZE;
		}
		else if (height > MAX_SIZE) {
			width = width * MAX_SIZE / height;
			height = MAX_SIZE;
		}

		canvas.width = width * pixelRatio;
		canvas.height = height * pixelRatio;
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';

		let scale = canvas.width / (pdfBoundingRect[2] - pdfBoundingRect[0]);

		ctx.save();
		if (annotation.type === 'highlight') {
			ctx.transform(scale, 0, 0, -scale, 0, height * pixelRatio);
			let position = annotation.position;
			ctx.globalAlpha = 0.5;
			ctx.globalCompositeOperation = 'multiply';
			ctx.fillStyle = annotation.color || SELECTION_COLOR;
			let rects = position.rects;
			if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
				rects = position.nextPageRects;
			}
			ctx.transform(1, 0, 0, 1, -pdfBoundingRect[0], -pdfBoundingRect[1]);
			for (let rect of rects) {
				ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		else if (annotation.type === 'underline') {
			ctx.transform(scale, 0, 0, -scale, 0, height * pixelRatio);
			let position = annotation.position;
			ctx.globalCompositeOperation = 'multiply';
			ctx.fillStyle = annotation.color || SELECTION_COLOR;
			let rects = position.rects;
			if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
				rects = position.nextPageRects;
			}
			ctx.transform(1, 0, 0, 1, -pdfBoundingRect[0], -pdfBoundingRect[1]);
			for (let rect of rects) {
				ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		else if (annotation.type === 'note') {
			let rect = annotation.position.rects[0];
			let w = rect[2] - rect[0];
			let scale2 = scale * (w / 24);
			ctx.transform(scale2, 0, 0, scale2, 0, 0);
			this._drawNoteIconOnCanvas(ctx, annotation.color);
		}
		else if (annotation.type === 'image') {
			// The page canvas contains pristine pdf.js output (the overlay is
			// rendered in the DOM), so it can be sampled directly
			let sourceCanvas = this._originalPage.canvas;
			if (sourceCanvas?.width) {
				ctx.globalAlpha = 0.5;
				ctx.globalCompositeOperation = 'multiply';
				ctx.fillStyle = annotation.color;
				// Original canvas to view ratio. Normally it's 1 but once zoomed too much, the canvas resolution
				// is lower than the view, therefore, the ratio goes below 1
				let upscaleRatio = this._originalPage.viewport.width / parseFloat(sourceCanvas.width) * devicePixelRatio;
				// Drag image to view, because drag canvas image can be smaller than what you see in the view
				let dragImageToViewRatio = width / (viewBoundingRect[2] - viewBoundingRect[0]);
				let coordinatesScale = devicePixelRatio * dragImageToViewRatio;
				let scale3 = dragImageToViewRatio * upscaleRatio;
				ctx.transform(scale3, 0, 0, scale3, -viewBoundingRect[0] * coordinatesScale, -viewBoundingRect[1] * coordinatesScale);
				ctx.drawImage(sourceCanvas, 0, 0);
			}
		}
		ctx.restore();
	}
}
