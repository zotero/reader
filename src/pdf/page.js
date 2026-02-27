import {
	applyInverseTransform,
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
	SELECTION_COLOR
} from '../common/defines';
import { getRectRotationOnText } from './selection';

export default class Page {
	constructor(layer, originalPage) {
		this._layer = layer;
		this._pageIndex = originalPage.id - 1;
		this._originalPage = originalPage;
		this._pageRenderer = new Renderer(layer, originalPage, false);
		this._detailRenderer = new Renderer(layer, originalPage, true);
	}

	get pageIndex() {
		return this._pageIndex;
	}

	get originalPage() {
		return this._originalPage;
	}

	refresh(detailView) {
		if (detailView) {
			this._detailRenderer.render();
		}
		else {
			this._pageRenderer.render();
		}
	}

	render() {
		if (this._originalPage.detailView) {
			this._detailRenderer.render();
		}
		this._pageRenderer.render();
	}

	renderAnnotationOnCanvas(annotation, canvas) {
		return this._pageRenderer.renderAnnotationOnCanvas(annotation, canvas);
	}
}

class Renderer {
	constructor(layer, originalPage, isDetailView) {
		this._isDetailView = isDetailView;
		this._layer = layer;
		this._originalPage = originalPage;
		this._pageIndex = originalPage.id - 1;

		// Extra canvas for snapshotting the original page
		this._snapshotCanvas = document.createElement('canvas');
		this._snapshotContext = this._snapshotCanvas.getContext('2d');

		// A context for pdf.js created canvas on the page
		this._context = null;

		// Track the last seen source canvas and its size to decide when to recapture
		this._lastSourceCanvas = null;
		this._lastSourceSize = { w: 0, h: 0 };

		// Cached render signature to decide when to skip rendering
		this._lastRenderSignature = null;

		this._isRendering = false;

		// Initialize the drawing target. Snapshot will be triggered lazily in render()
		this._initContext();
	}

	_getSourceCanvas() {
		return this._isDetailView
			? this._originalPage.detailView?.canvas
			: this._originalPage.canvas;
	}

	_initContext() {
		let baseCanvas = this._getSourceCanvas();
		this._context = baseCanvas ? baseCanvas.getContext('2d') : null;
	}

	_invalidateSignature() {
		this._lastRenderSignature = null;
	}

	// Snapshot if canvas elements or its size changed
	_maybeRefreshSnapshot() {
		let renderingState = this._isDetailView
			? this._originalPage.detailView?.renderingState
			: this._originalPage.renderingState;

		if (renderingState !== 3) return;

		let sourceCanvas = this._getSourceCanvas();
		if (!sourceCanvas) return;

		let sizeChanged = this._lastSourceSize.w !== sourceCanvas.width
			|| this._lastSourceSize.h !== sourceCanvas.height;
		if (this._lastSourceCanvas === sourceCanvas && !sizeChanged) {
			return;
		}

		this._lastSourceCanvas = sourceCanvas;
		this._lastSourceSize = { w: sourceCanvas.width, h: sourceCanvas.height };

		// Resize snapshot canvas and copy synchronously
		this._snapshotCanvas.width = sourceCanvas.width;
		this._snapshotCanvas.height = sourceCanvas.height;

		this._snapshotContext.setTransform(1, 0, 0, 1, 0, 0);
		this._snapshotContext.clearRect(0, 0, this._snapshotCanvas.width, this._snapshotCanvas.height);
		this._snapshotContext.drawImage(sourceCanvas, 0, 0);

		// Snapshot changed => ensure next render proceeds
		this._invalidateSignature();
	}

	// Computes PDF -> view transform depending on type
	get _transform() {
		let pageScale = this._originalPage.currentCanvasWidth / this._originalPage.viewport.width;
		let pageScaleTransform = [pageScale, 0, 0, pageScale, 0, 0];
		let baseTransform = transform(pageScaleTransform, this._originalPage.viewport.transform);

		if (!this._isDetailView) {
			return baseTransform;
		}

		let detailArea = this._originalPage.detailView?.detailArea;
		if (!detailArea) {
			return baseTransform;
		}

		let { viewport } = this._originalPage;
		let tm = viewport.transform.slice();
		tm[4] -= detailArea.minX;
		tm[5] -= detailArea.minY;
		tm = transform([devicePixelRatio, 0, 0, devicePixelRatio, 0, 0], tm);
		return tm;
	}

	get _scale() {
		let [a, b] = this._transform;
		return Math.hypot(a, b);
	}

	_getViewPoint(p, tfm = this._transform) {
		return applyTransform(p, tfm);
	}

	_getPdfPoint(p) {
		return applyInverseTransform(p, this._transform);
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
			if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
				return {
					pageIndex: position.pageIndex,
					nextPageRects: position.nextPageRects.map((rect) => {
						let [x1, y2] = applyTransform(rect, tfm);
						let [x2, y1] = applyTransform(rect.slice(2, 4), tfm);
						return [
							Math.min(x1, x2),
							Math.min(y1, y2),
							Math.max(x1, x2),
							Math.max(y1, y2)
						];
					})
				};
			}
			else {
				let position2 = {
					pageIndex: position.pageIndex,
					rects: position.rects.map((rect) => {
						let [x1, y2] = applyTransform(rect, tfm);
						let [x2, y1] = applyTransform(rect.slice(2, 4), tfm);
						return [
							Math.min(x1, x2),
							Math.min(y1, y2),
							Math.max(x1, x2),
							Math.max(y1, y2)
						];
					})
				};
				if (position.fontSize) {
					position2.fontSize = position.fontSize * this._scale;
				}
				if (position.rotation) {
					position2.rotation = position.rotation;
				}
				return position2;
			}
		}
		else if (position.paths) {
			return {
				pageIndex: position.pageIndex,
				width: position.width * this._scale,
				paths: position.paths.map((path) => {
					let vpath = [];
					for (let i = 0; i < path.length - 1; i += 2) {
						let x = path[i];
						let y = path[i + 1];
						vpath.push(...applyTransform([x, y], tfm));
					}
					return vpath;
				})
			};
		}
	}

	_v2p(position) {
		let tfm = this._transform;
		return {
			pageIndex: position.pageIndex,
			rects: position.rects.map((rect) => {
				let [x1, y2] = applyInverseTransform(rect, tfm);
				let [x2, y1] = applyInverseTransform(rect.slice(2, 4), tfm);
				return [
					Math.min(x1, x2),
					Math.min(y1, y2),
					Math.max(x1, x2),
					Math.max(y1, y2)
				];
			})
		};
	}

	// -------- Change tracking helpers --------

	// Rect digest: [minX,minY,maxX,maxY,sumX,sumY,count] (rounded)
	_geomDigestFromRects(rects) {
		if (!rects || !rects.length) return [0, 0, 0, 0, 0, 0, 0];
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		let sumX = 0, sumY = 0, count = 0;
		for (let r of rects) {
			let x1 = r[0], y1 = r[1], x2 = r[2], y2 = r[3];
			minX = Math.min(minX, x1); minY = Math.min(minY, y1);
			maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
			sumX += x1 + x2; sumY += y1 + y2; count += 2;
		}
		return [
			Math.round(minX),
			Math.round(minY),
			Math.round(maxX),
			Math.round(maxY),
			Math.round(sumX),
			Math.round(sumY),
			count
		];
	}

	// Path digest: last point unrounded + total points + width
	_geomDigestFromPaths(paths, width = 0) {
		if (!paths || !paths.length) return [0, 0, 0, 0];
		let last = paths[paths.length - 1];
		let lastX = last[last.length - 2] || 0;
		let lastY = last[last.length - 1] || 0;
		let totalPts = 0;
		for (let p of paths) totalPts += p.length >> 1;
		return [lastX, lastY, totalPts, Math.round(width || 0)];
	}

	// Build a signature of visual inputs for this page/type
	_buildRenderSignature() {
		let page = this._originalPage;
		let layer = this._layer;

		let renderingState = this._isDetailView
			? page.detailView?.renderingState
			: page.renderingState;

		// Snapshot dimensions (content changes invalidate)
		let snapW = this._snapshotCanvas?.width || 0;
		let snapH = this._snapshotCanvas?.height || 0;

		// Transform-affecting values
		let vp = page.viewport || {};
		let vpW = vp.width || 0;
		let vpH = vp.height || 0;
		let vpRot = vp.rotation || 0;
		let vpScale = vp.scale || 1;
		let currentCanvasWidth = page.currentCanvasWidth || 0;
		let dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

		// Detail area for detail renderer
		let dv = page.detailView;
		let dvArea = dv?.detailArea ? [dv.detailArea.minX || 0, dv.detailArea.minY || 0] : [0, 0];

		// Theme / flags / style markers that affect drawing
		let theme = layer._themeColorScheme || 'light';
		let readOnly = !!layer._readOnly;
		let focusColor = String(window.computedColorFocusBorder || '');
		let fontFamily = String(window.computedFontFamily || '');

		// Selection-related
		let selectedIds = (layer._selectedAnnotationIDs || []).slice().sort().join('|');
		let focused = layer._focusedObject;
		let focusedSig = focused ? [focused.pageIndex ?? -1, focused.object?.id || ''] : [-1, ''];

		// Hover digest (only if affects this page)
		let hoverSig = [0];
		if (layer._hover) {
			let hp = layer._hover;
			let affects = (hp.pageIndex === this._pageIndex)
				|| (!!hp.nextPageRects && hp.pageIndex + 1 === this._pageIndex);
			if (affects) {
				let rects = hp.rects || hp.nextPageRects || [];
				hoverSig = [1, ...this._geomDigestFromRects(rects)];
			}
		}

		// Selection ranges digest on this page
		let selOnThis = (layer._selectionRanges || []).filter(r => r?.position?.pageIndex === this._pageIndex);
		let selDigest = [selOnThis.length];
		if (selOnThis.length) {
			let allRects = [];
			for (let r of selOnThis) Array.isArray(r.position?.rects) && allRects.push(...r.position.rects);
			selDigest = [selOnThis.length, ...this._geomDigestFromRects(allRects)];
		}

		// Tool for selection preview
		let toolType = layer._tool?.type || '';
		let toolColor = layer._tool?.color || '';

		// Action
		let a = layer.action;

		// Helper to collect geometry that affects this specific page from a position-like object
		let collectForThisPage = (pos) => {
			let rects = [];
			let paths = [];
			let affectsThis = 0;
			if (pos) {
				let affects = (pos.pageIndex === this._pageIndex)
					|| (!!pos.nextPageRects && pos.pageIndex + 1 === this._pageIndex);
				affectsThis = affects ? 1 : 0;
				if (affects) {
					if (Array.isArray(pos.rects) && pos.pageIndex === this._pageIndex) {
						rects = pos.rects;
					}
					if (Array.isArray(pos.nextPageRects) && pos.pageIndex + 1 === this._pageIndex) {
						rects = pos.nextPageRects;
					}
					if (Array.isArray(pos.paths) && pos.pageIndex === this._pageIndex) {
						paths = pos.paths;
					}
				}
			}
			return { affectsThis, rects, paths };
		};

		let actionSig = [
			'', // type
			0,  // triggered
			'', // annotation id
			0,  // affectsThis (from action.position)
			0,  // rotation (from action.position)
			0,  // fontSize (from action.position)
			0, 0, 0, 0, 0, 0, 0, // rectDigest (action.position)
			0, 0, 0, 0,          // pathDigest (action.position) + width
			// appended below for annotation.position
			0,  // annPosPresent
			0,  // annPosAffectsThis
			0,  // annPosRotation
			0,  // annPosFontSize
			0, 0, 0, 0, 0, 0, 0, // rectDigest (action.annotation.position)
			0, 0, 0, 0           // pathDigest (action.annotation.position) + width
		];

		let actionSelSig = [0]; // count, ...rectDigest

		if (a) {
			let posPrimary = a.position;
			let posAnn = a.annotation?.position;

			// Gather for primary action.position
			let { affectsThis: affectsPrimary, rects: rectsPrimary, paths: pathsPrimary } = collectForThisPage(posPrimary);
			let rectDigestPrimary = this._geomDigestFromRects(rectsPrimary);
			let pathDigestPrimary = this._geomDigestFromPaths(pathsPrimary, posPrimary?.width);

			// Gather for action.annotation.position
			let { affectsThis: affectsAnn, rects: rectsAnn, paths: pathsAnn } = collectForThisPage(posAnn);
			let rectDigestAnn = this._geomDigestFromRects(rectsAnn);
			let pathDigestAnn = this._geomDigestFromPaths(pathsAnn, posAnn?.width);

			let rotationPrimary = posPrimary?.rotation || 0;
			let fontSizePrimary = posPrimary?.fontSize || 0;

			let rotationAnn = posAnn?.rotation || 0;
			let fontSizeAnn = posAnn?.fontSize || 0;
			let annPosPresent = posAnn ? 1 : 0;

			actionSig = [
				a.type || '',
				a.triggered ? 1 : 0,
				a.annotation?.id || '',
				affectsPrimary,
				rotationPrimary,
				fontSizePrimary,
				...rectDigestPrimary,
				...pathDigestPrimary,

				// annotation.position contribution
				annPosPresent,
				affectsAnn,
				rotationAnn,
				fontSizeAnn,
				...rectDigestAnn,
				...pathDigestAnn
			];

			// action.selectionRanges (only geometry for this page)
			if (Array.isArray(a.selectionRanges) && a.selectionRanges.length) {
				let onThis = a.selectionRanges.filter(r => r?.position?.pageIndex === this._pageIndex);
				if (onThis.length) {
					let rects = [];
					for (let r of onThis) {
						if (Array.isArray(r.position?.rects)) rects.push(...r.position.rects);
					}
					actionSelSig = [onThis.length, ...this._geomDigestFromRects(rects)];
				}
				else {
					actionSelSig = [0];
				}
			}
		}

		// Find controller
		let findSig = [0, 0, -1, -1, 0];
		if (layer._findController && layer._findController.highlightMatches && layer._pdfPages?.[this._pageIndex]) {
			let fc = layer._findController;
			let selected = fc.selected || {};
			let positions = fc.getMatchPositions
				? (fc.getMatchPositions(this._pageIndex, layer._pdfPages[this._pageIndex]) || [])
				: [];
			findSig = [
				fc._matchesCountTotal || 0,
				fc.state?.highlightAll ? 1 : 0,
				selected.pageIdx ?? -1,
				selected.matchIdx ?? -1,
				positions.length
			];
		}

		// Overlays we draw with a combined rect digest
		let pageData = layer._pdfPages?.[this._pageIndex];
		let overlaysSig = [0];
		if (pageData?.overlays) {
			let overlays = pageData.overlays.filter(o =>
				o && (o.type === 'citation' || (o.type === 'internal-link' && o.source === 'matched'))
			);
			let rects = [];
			for (let o of overlays) {
				let p = o.position;
				if (!p) continue;
				if (Array.isArray(p.rects)) rects.push(...p.rects);
				if (Array.isArray(p.nextPageRects)) rects.push(...p.nextPageRects);
			}
			overlaysSig = [overlays.length, ...this._geomDigestFromRects(rects)];
		}

		// Highlighted position digest
		let highlightedSig = [0];
		let hp = layer._highlightedPosition;
		if (hp && (hp.pageIndex === this._pageIndex || (hp.nextPageRects && hp.pageIndex + 1 === this._pageIndex))) {
			let rects = hp.rects || hp.nextPageRects || [];
			highlightedSig = [1, ...this._geomDigestFromRects(rects)];
		}

		// Read Aloud highlighted position digest
		let readAloudSig = [0];
		let rap = layer._readAloudHighlightedPosition;
		if (rap && (rap.pageIndex === this._pageIndex || (rap.nextPageRects && rap.pageIndex + 1 === this._pageIndex))) {
			let rects = rap.rects || rap.nextPageRects || [];
			readAloudSig = [1, ...this._geomDigestFromRects(rects)];
		}

		// Annotations that affect this page
		let annotations = layer._getPageAnnotations(this._pageIndex) || [];
		let annSigs = [];
		for (let an of annotations) {
			if (!an) continue;
			let pos = an.position || {};
			let affects = (pos.pageIndex === this._pageIndex)
				|| (!!pos.nextPageRects && pos.pageIndex + 1 === this._pageIndex);
			if (!affects) continue;

			let rectDigest = [0, 0, 0, 0, 0, 0, 0];
			let spillDigest = [0, 0, 0, 0, 0, 0, 0];
			let pathDigest = [0, 0, 0, 0];

			if (Array.isArray(pos.rects)) rectDigest = this._geomDigestFromRects(pos.rects);
			if (Array.isArray(pos.nextPageRects)) spillDigest = this._geomDigestFromRects(pos.nextPageRects);
			if (Array.isArray(pos.paths)) pathDigest = this._geomDigestFromPaths(pos.paths, pos.width);

			let commentLen = typeof an.comment === 'string' ? an.comment.length : 0;

			annSigs.push([
				an.id || '',
				an.type || '',
				an.color || '',
				pos.rotation || 0,
				pos.fontSize || 0,
				commentLen,
				...rectDigest,
				...spillDigest,
				...pathDigest
			]);
		}
		annSigs.sort((x, y) => (x[0] > y[0] ? 1 : x[0] < y[0] ? -1 : 0));

		return JSON.stringify([
			// readiness and snapshot dimensions
			renderingState || 0, snapW, snapH,

			// transform affecting
			vpW, vpH, vpRot, vpScale, currentCanvasWidth, dpr, this._isDetailView ? 1 : 0, ...dvArea,

			// theme/flags/style
			theme, readOnly ? 1 : 0, focusColor, fontFamily,

			// selection/hover/action/find/overlays/highlight
			selectedIds, ...focusedSig,
			...hoverSig,
			...selDigest,
			toolType, toolColor,
			...actionSig,
			...actionSelSig,
			...findSig,
			...overlaysSig,
			...highlightedSig,
			...readAloudSig,

			// annotations
			'#', ...annSigs.flat()
		]);
	}

	_drawHover() {
		if (!this._layer._hover || !this._context) return;
		let color = '#46b1ff';
		this._context.save();
		if (this._layer._themeColorScheme === 'light') {
			this._context.globalAlpha = 0.1;
			this._context.globalCompositeOperation = 'multiply';
		}
		else {
			this._context.globalAlpha = 0.5;
			this._context.globalCompositeOperation = 'lighten';
		}
		this._context.fillStyle = color;

		let position = this._layer._hover;
		position = this._p2v(position);
		let rects;
		if (position.pageIndex === this._pageIndex) {
			rects = position.rects;
		}
		else if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
			rects = position.nextPageRects;
		}

		if (rects) {
			for (let rect of rects) {
				this._context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}

		this._context.restore();
	}

	_drawOverlays() {
		if (!this._layer._pdfPages[this._pageIndex] || !this._context) return;

		let color = '#76c6ff';
		this._context.save();
		if (this._layer._themeColorScheme === 'light') {
			this._context.globalAlpha = 0.1;
			this._context.globalCompositeOperation = 'multiply';
		}
		else {
			this._context.globalAlpha = 0.4;
			this._context.globalCompositeOperation = 'lighten';
		}
		this._context.fillStyle = color;

		for (let overlay of this._layer._pdfPages[this._pageIndex].overlays) {
			if (!(overlay.type === 'citation' || overlay.type === 'internal-link' && overlay.source === 'matched')) {
				continue;
			}
			let { position } = overlay;
			position = this._p2v(position);
			let rects = position.rects;
			if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
				rects = position.nextPageRects;
			}
			else if (position.pageIndex !== this._pageIndex) {
				continue;
			}
			for (let rect of rects) {
				this._context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		this._context.restore();
	}

	_drawNoteIcon(ctx, color) {
		ctx.beginPath();
		ctx.fillStyle = color;
		let poly = [0.5, 0.5, 23.5, 0.5, 23.5, 23.5, 11.5, 23.5, 0.5, 12.5, 0.5, 0.5];
		ctx.moveTo(poly[0], poly[1]);
		for (let item = 2; item < poly.length - 1; item += 2) {
			ctx.lineTo(poly[item], poly[item + 1]);
		}
		ctx.closePath();
		ctx.fill();

		ctx.beginPath();
		ctx.fillStyle = 'rgba(255, 255, 255,0.4)';
		poly = [0.5, 12.5, 11.5, 12.5, 11.5, 23.5, 0.5, 12.5];
		ctx.moveTo(poly[0], poly[1]);
		for (let item = 2; item < poly.length - 1; item += 2) {
			ctx.lineTo(poly[item], poly[item + 1]);
		}
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#000';

		let p = new Path2D('M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z');
		ctx.fill(p);
	}

	_drawCommentIcons(annotations) {
		if (!this._context) return;

		// Hide icon for the annotation being resized (image) or range-updated (highlight/underline)
		const action = this._layer?.action;

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
			const isResizingTarget =
				action
				&& action.triggered
				&& action.annotation
				&& action.annotation.id === annotation.id
				&& (
					(action.type === 'resize' && annotation.type === 'image')
					|| (action.type === 'updateAnnotationRange' && (annotation.type === 'highlight' || annotation.type === 'underline'))
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
			this._context.save();
			let scale = Math.abs(this._getViewPoint([1 / (24 / width), 0])[0] - this._getViewPoint([0, 0])[0]);
			let rect = this._getViewRect(note.rect);
			this._context.transform(scale, 0, 0, scale, rect[0], rect[1]);
			this._context.globalAlpha = 0.5;
			this._drawNoteIcon(this._context, note.annotation.color);
			this._context.restore();
		}
	}

	_drawHighlight(annotation) {
		let color = annotation.color;
		let position = this._p2v(annotation.position);
		this._context.save();
		if (this._layer._themeColorScheme === 'light') {
			this._context.globalCompositeOperation = 'multiply';
			this._context.globalAlpha = 0.4;
		}
		else {
			this._context.globalCompositeOperation = 'lighter';
			this._context.globalAlpha = 0.3;
		}
		this._context.fillStyle = color;

		let rects = position.rects;
		if (position.nextPageRects && position.pageIndex + 1 === this._pageIndex) {
			rects = position.nextPageRects;
		}

		for (let rect of rects) {
			this._context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		}
		this._context.restore();
	}

	_drawUnderline(annotation) {
		if (!this._context) return;

		let color = annotation.color;
		let pageData = this._layer._pdfPages[this._pageIndex];
		if (!pageData) return;

		let { chars } = pageData;
		let position = this._p2v(annotation.position);
		this._context.save();
		if (this._layer._themeColorScheme === 'light') {
			this._context.globalCompositeOperation = 'multiply';
		}
		else {
			this._context.globalAlpha = 0.9;
		}
		this._context.fillStyle = color;
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
		let width = 1;
		width *= this._scale;
		for (let rect of rects) {
			let rotation = getRectRotationOnText(chars, pdfRect);
			rotation += getRotationDegrees(this._transform);
			rotation = normalizeDegrees(rotation);
			let [x1, y1, x2, y2] = rect;
			let rect2 = (
				rotation === 0 && [x1, y2 - width, x2, y2]
				|| rotation === 90 && [x2 - width, y2, x2, y1]
				|| rotation === 180 && [x1, y1, x2, y1 - width]
				|| rotation === 270 && [x1, y2, x1 - width, y1]
			);
			this._context.fillRect(rect2[0], rect2[1], rect2[2] - rect2[0], rect2[3] - rect2[1]);
		}
		this._context.restore();
	}

	// Change only the scale used for drawing note icons
	_drawNote(annotation) {
		let position = this._p2v(annotation.position);
		this._context.save();
		let viewRect = position.rects[0];
		let scale = this._scale;
		this._context.transform(scale, 0, 0, scale, viewRect[0], viewRect[1]);
		this._drawNoteIcon(this._context, annotation.color);
		this._context.restore();
	}

	_drawImage(annotation) {
		let position = this._p2v(annotation.position);
		this._context.save();
		this._context.strokeStyle = annotation.color;
		this._context.lineWidth = 3 * devicePixelRatio;
		let rect = position.rects[0];

		// Make image annotation more opaque if it's still too small
		let pdfRect = annotation.position.rects[0];
		let width = pdfRect[2] - pdfRect[0];
		let height = pdfRect[3] - pdfRect[1];
		if (width < MIN_IMAGE_ANNOTATION_SIZE || height < MIN_IMAGE_ANNOTATION_SIZE) {
			this._context.globalAlpha = 0.2;
		}
		this._context.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		this._context.restore();
	}

	_drawInk(annotation) {
		let position = this._p2v(annotation.position);
		this._context.save();
		this._context.beginPath();
		this._context.strokeStyle = darkenHex(annotation.color, DARKEN_INK_AND_TEXT_COLOR);
		this._context.lineWidth = position.width;
		this._context.lineCap = 'round';
		this._context.lineJoin = 'round';

		for (let path of position.paths) {
			this._context.moveTo(...path.slice(0, 2));
			for (let i = 0; i < path.length - 1; i += 2) {
				let x = path[i];
				let y = path[i + 1];
				if (i === 0) {
					this._context.moveTo(x, y);
				}
				this._context.lineTo(x, y);
			}
		}
		this._context.stroke();
		this._context.restore();
	}

	_drawFindResults() {
		if (!this._layer._findController
			|| !this._layer._findController.highlightMatches
			|| !this._layer._findController._matchesCountTotal
			|| !this._layer._pdfPages[this._pageIndex]
			|| !this._context
		) {
			return;
		}
		let { selected } = this._layer._findController;
		let positions = this._layer._findController.getMatchPositions(
			this._pageIndex,
			this._layer._pdfPages[this._pageIndex]
		);

		if (!positions || !positions.length) {
			return;
		}

		this._context.save();

		for (let i = 0; i < positions.length; i++) {
			let position = positions[i];
			if (selected.pageIdx === this._pageIndex && i === selected.matchIdx) {
				this._context.fillStyle = this._layer._themeColorScheme === 'dark'
					? FIND_RESULT_COLOR_CURRENT_DARK
					: FIND_RESULT_COLOR_CURRENT_LIGHT;
			}
			else {
				if (!this._layer._findController.state.highlightAll) {
					continue;
				}
				this._context.fillStyle = this._layer._themeColorScheme === 'dark'
					? FIND_RESULT_COLOR_ALL_DARK
					: FIND_RESULT_COLOR_ALL_LIGHT;
			}

			position = this._p2v(position);
			for (let rect of position.rects) {
				let cornerRadius = 5;
				let x = rect[0];
				let y = rect[1];
				let width = rect[2] - rect[0];
				let height = rect[3] - rect[1];

				this._context.beginPath();
				this._context.moveTo(x + cornerRadius, y);
				this._context.lineTo(x + width - cornerRadius, y);
				this._context.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
				this._context.lineTo(x + width, y + height - cornerRadius);
				this._context.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
				this._context.lineTo(x + cornerRadius, y + height);
				this._context.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
				this._context.lineTo(x, y + cornerRadius);
				this._context.quadraticCurveTo(x, y, x + cornerRadius, y);
				this._context.closePath();

				this._context.fill();
			}
		}

		this._context.restore();
	}

	_renderCommon() {
		if (!this._context || this._isRendering) {
			return;
		}

		this._isRendering = true;
		try {
			let annotations = this._layer._getPageAnnotations(this._pageIndex);
			let selectedAnnotationIDs = this._layer._selectedAnnotationIDs;
			let selectionRanges = this._layer._selectionRanges;
			let action = this._layer.action;

			// DOM-based text annotations are only placed in full page
			if (!this._isDetailView) {
				let doc = this._originalPage.div.ownerDocument;
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
				let textAnnotationNodes = Array.from(this._layer._iframeWindow.document.querySelectorAll(
					`[data-page-number="${this._pageIndex + 1}"] .textAnnotation`
				));
				for (let node of textAnnotationNodes) {
					let id = node.getAttribute('data-id');
					if (!annotations.find(x => x.id === id)) {
						node.remove();
					}
				}
			}

			// Draw the base snapshot first
			this._context.save();
			this._context.setTransform(1, 0, 0, 1, 0, 0);
			this._context.clearRect(0, 0, this._context.canvas.width, this._context.canvas.height);
			if (this._snapshotCanvas?.width && this._snapshotCanvas?.height) {
				this._context.drawImage(this._snapshotCanvas, 0, 0);
			}

			// Annotations and overlays
			for (let annotation of annotations) {
				if (annotation.type === 'highlight' && !(action?.type === 'updateAnnotationRange' && action.annotation.id === annotation.id)) {
					this._drawHighlight(annotation);
				}
				if (annotation.type === 'underline' && !(action?.type === 'updateAnnotationRange' && action.annotation.id === annotation.id)) {
					this._drawUnderline(annotation);
				}
				else if (annotation.type === 'note') {
					this._drawNote(annotation);
				}
				else if (annotation.type === 'image') {
					if (!this._layer._selectedAnnotationIDs.includes(annotation.id)) {
						this._drawImage(annotation);
					}
				}
				else if (annotation.type === 'ink') {
					if (action && action.position && action.type === 'resize' && action.annotation.id === annotation.id) {
						this._drawInk({ ...annotation, position: action.position });
					}
					else if (action && action.triggered && action.type === 'erase' && action.annotations.has(annotation.id)) {
						let { position } = action.annotations.get(annotation.id);
						this._drawInk({ ...annotation, position });
					}
					else {
						this._drawInk(annotation);
					}
				}
			}

			if (action?.type === 'updateAnnotationRange' && (
				action.annotation.position.pageIndex === this._pageIndex
				|| action.annotation.position.nextPageRects && action.annotation.position.pageIndex + 1 === this._pageIndex
			)) {
				if (action.annotation.type === 'highlight') {
					this._drawHighlight(action.annotation);
				}
				else if (action.annotation.type === 'underline') {
					this._drawUnderline(action.annotation);
				}
			}

			this._drawCommentIcons(annotations);
			this._drawOverlays();
			this._drawHover();
			this._drawFindResults();

			// Focused object outline
			let focusedObject = this._layer._focusedObject;
			if (!this._layer._selectedAnnotationIDs.length
				&& focusedObject && (
					focusedObject.pageIndex === this._pageIndex
					|| focusedObject.object.position.nextPageRects && focusedObject.pageIndex === this._pageIndex
				)
			) {
				let position = focusedObject.object.position;
				this._context.strokeStyle = window.computedColorFocusBorder;
				this._context.lineWidth = 3 * devicePixelRatio;
				let padding = 5 * devicePixelRatio;
				let rect = getPositionBoundingRect(position, this._pageIndex);
				rect = this._getViewRect(rect);
				rect = [
					rect[0] - padding,
					rect[1] - padding,
					rect[2] + padding,
					rect[3] + padding,
				];
				let radius = 10 * devicePixelRatio;
				this._context.beginPath();
				this._context.moveTo(rect[0] + radius, rect[1]);
				this._context.lineTo(rect[2] - radius, rect[1]);
				this._context.arcTo(rect[2], rect[1], rect[2], rect[1] + radius, radius);
				this._context.lineTo(rect[2], rect[3] - radius);
				this._context.arcTo(rect[2], rect[3], rect[2] - radius, rect[3], radius);
				this._context.lineTo(rect[0] + radius, rect[3]);
				this._context.arcTo(rect[0], rect[3], rect[0], rect[3] - radius, radius);
				this._context.lineTo(rect[0], rect[1] + radius);
				this._context.arcTo(rect[0], rect[1], rect[0] + radius, rect[1], radius);
				this._context.stroke();
			}

			if (action?.type !== 'updateAnnotationRange' || !action?.triggered) {
				this._context.save();
				let selectedAnnotations = annotations.filter(x => selectedAnnotationIDs.includes(x.id));
				for (let annotation of selectedAnnotations) {
					this._context.strokeStyle = '#6d95e0';
					this._context.beginPath();
					this._context.setLineDash([5 * devicePixelRatio, 3 * devicePixelRatio]);
					this._context.lineWidth = 2 * devicePixelRatio;
					let padding = 5 * devicePixelRatio;
					let rect = getPositionBoundingRect(annotation.position, this._pageIndex);
					let rotation = 0;
					if (annotation.type === 'text') {
						rect = annotation.position.rects[0];
					}
					if (['image', 'text', 'ink'].includes(annotation.type)) {
						padding = 0;
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
					if (annotation.type === 'image') {
						this._context.lineWidth = 3 * devicePixelRatio;
					}
					let tm = this._transform;
					if (annotation.type === 'text') {
						tm = getRotationTransform(rect, rotation || 0);
						tm = transform(this._transform, tm);
					}
					let p1 = [rect[0], rect[1]];
					let p2 = [rect[2], rect[1]];
					let p3 = [rect[2], rect[3]];
					let p4 = [rect[0], rect[3]];
					let pml = [rect[0], rect[1] + (rect[3] - rect[1]) / 2];
					let pmr = [rect[2], rect[1] + (rect[3] - rect[1]) / 2];
					let pmt = [rect[0] + (rect[2] - rect[0]) / 2, rect[3]];
					let pmb = [rect[0] + (rect[2] - rect[0]) / 2, rect[1]];
					let ROTATION_BOTTOM = 16;
					let pr = [rect[0] + (rect[2] - rect[0]) / 2, rect[3] + ROTATION_BOTTOM];
					p1 = this._getViewPoint(p1, tm);
					p2 = this._getViewPoint(p2, tm);
					p3 = this._getViewPoint(p3, tm);
					p4 = this._getViewPoint(p4, tm);
					pml = this._getViewPoint(pml, tm);
					pmr = this._getViewPoint(pmr, tm);
					pmt = this._getViewPoint(pmt, tm);
					pmb = this._getViewPoint(pmb, tm);
					pr = this._getViewPoint(pr, tm);
					let BOX_PADDING = 10 * devicePixelRatio;
					if (annotation.type !== 'image') {
						[p1, p2, p3, p4, pml, pmr, pmt, pmb] = scaleShape([p1, p2, p3, p4], [p1, p2, p3, p4, pml, pmr, pmt, pmb], BOX_PADDING);
					}
					this._context.beginPath();
					this._context.moveTo(...p1);
					this._context.lineTo(...p2);
					this._context.lineTo(...p3);
					this._context.lineTo(...p4);
					this._context.closePath();
					if (!(this._layer._readOnly || annotation.readOnly) && annotation.type === 'text') {
						this._context.moveTo(...pmt);
						this._context.lineTo(...pr);
					}
					this._context.stroke();
					let radius = 4 * devicePixelRatio;
					this._context.fillStyle = '#81b3ff';

					if (!(this._layer._readOnly || annotation.readOnly)) {
						if (['image', 'text', 'ink'].includes(annotation.type)) {
							this._context.beginPath();
							this._context.arc(...p1, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (['image', 'text', 'ink'].includes(annotation.type)) {
							this._context.beginPath();
							this._context.arc(...p2, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (['image', 'text', 'ink'].includes(annotation.type)) {
							this._context.beginPath();
							this._context.arc(...p4, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (['image', 'text', 'ink'].includes(annotation.type)) {
							this._context.beginPath();
							this._context.arc(...p3, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (['image', 'text'].includes(annotation.type)) {
							this._context.beginPath();
							this._context.arc(...pmr, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (['image', 'text'].includes(annotation.type)) {
							this._context.beginPath();
							this._context.arc(...pml, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (annotation.type === 'image') {
							this._context.beginPath();
							this._context.arc(...pmt, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (annotation.type === 'image') {
							this._context.beginPath();
							this._context.arc(...pmb, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
						if (annotation.type === 'text') {
							this._context.beginPath();
							this._context.arc(...pr, radius, 0, 2 * Math.PI, false);
							this._context.fill();
						}
					}
				}
				this._context.restore();
			}

			let annotation = annotations.find(x => x.id === selectedAnnotationIDs[0]);

			if (annotation && ['highlight', 'underline'].includes(annotation.type)) {
				let annotation2 = annotation;
				if (action?.type === 'updateAnnotationRange' && action.annotation) {
					annotation2 = action.annotation;
				}
				if (this._layer._pdfPages[this._pageIndex]
					&& (!annotation2.position.nextPageRects || this._layer._pdfPages[this._pageIndex + 1])) {
					let { chars } = this._layer._pdfPages[this._pageIndex];
					let position = this._p2v(annotation2.position);
					this._context.save();
					if (this._layer._themeColorScheme === 'light') {
						this._context.globalCompositeOperation = 'multiply';
					}

					this._context.fillStyle = annotation2.color;
					let startRect;
					let endRect;
					let padding = 1 * devicePixelRatio;
					if (annotation2.position.nextPageRects) {
						if (position.pageIndex + 1 === this._pageIndex) {
							let { chars } = this._layer._pdfPages[this._pageIndex + 1];
							let rotation = getRectRotationOnText(chars, annotation2.position.nextPageRects.at(-1));
							rotation += getRotationDegrees(this._transform);
							rotation = normalizeDegrees(rotation);
							let [x1, y1, x2, y2] = position.nextPageRects.at(-1);
							endRect = (
								rotation === 0 && [x2 - padding, y1, x2 + padding, y2]
								|| rotation === 90 && [x1, y1 - padding, x2, y1 + padding]
								|| rotation === 180 && [x1 - padding, y1, x1 + padding, y2]
								|| rotation === 270 && [x1, y2 - padding, x2, y2 + padding]
							);
						}
						else {
							let rotation = getRectRotationOnText(chars, annotation2.position.rects[0]);
							let [x1, y1, x2, y2] = position.rects[0];
							rotation += getRotationDegrees(this._transform);
							rotation = normalizeDegrees(rotation);
							startRect = (
								rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
								|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
								|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
								|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
							);
						}
					}
					else {
						let rotation = getRectRotationOnText(chars, annotation2.position.rects[0]);
						rotation += getRotationDegrees(this._transform);
						rotation = normalizeDegrees(rotation);
						let [x1, y1, x2, y2] = position.rects[0];
						startRect = (
							rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
							|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
							|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
							|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
						);
						rotation = getRectRotationOnText(chars, annotation2.position.rects.at(-1));
						rotation += getRotationDegrees(this._transform);
						rotation = normalizeDegrees(rotation);
						[x1, y1, x2, y2] = position.rects.at(-1);
						endRect = (
							rotation === 0 && [x2 - padding, y1, x2 + padding, y2]
							|| rotation === 90 && [x1, y1 - padding, x2, y1 + padding]
							|| rotation === 180 && [x1 - padding, y1, x1 + padding, y2]
							|| rotation === 270 && [x1, y2 - padding, x2, y2 + padding]
						);
					}
					if (!(this._layer._readOnly || annotation.readOnly) && startRect) {
						let rect = startRect;
						this._context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
					}
					if (!(this._layer._readOnly || annotation.readOnly) && endRect) {
						let rect = endRect;
						this._context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
					}
					this._context.restore();
				}
			}

			this._context.save();
			if (this._layer._selectionRanges.length && !this._layer._selectionRanges[0].collapsed && ['highlight', 'underline'].includes(this._layer._tool.type)) {
				let annotation = this._layer._getAnnotationFromSelectionRanges(this._layer._selectionRanges, this._layer._tool.type, this._layer._tool.color);
				if (annotation.position.pageIndex === this._pageIndex
					|| annotation.position.nextPageRects && annotation.position.pageIndex + 1 === this._pageIndex) {
					if (annotation.type === 'highlight') {
						this._drawHighlight(annotation);
					}
					else {
						this._drawUnderline(annotation);
					}
				}
			}
			else {
				for (let selectionRange of selectionRanges) {
					let { position } = selectionRange;
					if (position.pageIndex !== this._pageIndex) {
						continue;
					}
					position = this._p2v(position);
					this._context.fillStyle = SELECTION_COLOR;

					if (this._layer._themeColorScheme === 'light') {
						this._context.globalCompositeOperation = 'multiply';
						this._context.globalAlpha = 0.4;
					}
					else {
						this._context.globalCompositeOperation = 'lighten';
						this._context.globalAlpha = 0.7;
					}

					for (let rect of position.rects) {
						this._context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
					}
				}
			}
			this._context.restore();

			if (action) {
				if (action.type === 'moveAndDrag' && action.triggered) {
					if (action.annotation.position.pageIndex === this._pageIndex) {
						this._context.strokeStyle = '#aaaaaa';
						this._context.setLineDash([5 * devicePixelRatio, 3 * devicePixelRatio]);
						this._context.lineWidth = 2 * devicePixelRatio;
						let rect = getPositionBoundingRect(action.position);
						let tm = this._transform;
						if (action.annotation.type === 'text') {
							rect = action.position.rects[0];
							tm = getRotationTransform(rect, action.annotation.position.rotation || 0);
							tm = transform(this._transform, tm);
						}
						let p1 = [rect[0], rect[1]];
						let p2 = [rect[2], rect[1]];
						let p3 = [rect[2], rect[3]];
						let p4 = [rect[0], rect[3]];
						p1 = this._getViewPoint(p1, tm);
						p2 = this._getViewPoint(p2, tm);
						p3 = this._getViewPoint(p3, tm);
						p4 = this._getViewPoint(p4, tm);
						let BOX_PADDING = 10 * devicePixelRatio;
						[p1, p2, p3, p4] = scaleShape([p1, p2, p3, p4], [p1, p2, p3, p4], BOX_PADDING);
						this._context.beginPath();
						this._context.moveTo(...p1);
						this._context.lineTo(...p2);
						this._context.lineTo(...p3);
						this._context.lineTo(...p4);
						this._context.closePath();
						this._context.stroke();
					}
				}
				else if (action.type === 'image' && action.annotation) {
					if (action.annotation.position.pageIndex === this._pageIndex) {
						this._drawImage(action.annotation);
					}
				}
				else if (action.type === 'ink' && action.annotation) {
					if (action.annotation.position.pageIndex === this._pageIndex) {
						this._drawInk(action.annotation);
					}
				}
			}

			// Highlight position
			let readAloudHighlightedPosition = this._layer._readAloudHighlightedPosition;
			if (readAloudHighlightedPosition && (
				readAloudHighlightedPosition.pageIndex === this._pageIndex
				|| readAloudHighlightedPosition.nextPageRects && readAloudHighlightedPosition.pageIndex + 1 === this._pageIndex
			)) {
				let position = readAloudHighlightedPosition;
				let annotation2 = { position, color: READ_ALOUD_ACTIVE_SEGMENT_COLOR };
				if (position.rects) {
					this._drawHighlight(annotation2);
				}
				else if (position.paths) {
					this._drawInk(annotation2);
				}
			}

			let highlightedPosition = this._layer._highlightedPosition;
			if (highlightedPosition && (
				highlightedPosition.pageIndex === this._pageIndex
				|| highlightedPosition.nextPageRects && highlightedPosition.pageIndex + 1 === this._pageIndex
			)) {
				let position = highlightedPosition;
				let annotation2 = { position, color: SELECTION_COLOR };
				if (position.rects) {
					this._drawHighlight(annotation2);
				}
				else if (position.paths) {
					this._drawInk(annotation2);
				}
			}

			this._context.restore();
		}
		finally {
			this._isRendering = false;
		}
	}

	render() {
		let renderingState = this._isDetailView
			? this._originalPage.detailView?.renderingState
			: this._originalPage.renderingState;

		if (renderingState !== 3) {
			return;
		}

		// Ensure we draw into the correct target context first
		this._initContext();

		// Single place to decide and refresh snapshot if source identity or size changed
		this._maybeRefreshSnapshot();

		// Decide if pixels would change, but always render if we are actively drawing ink
		let signature = this._buildRenderSignature();
		let forceWhileDrawingInk = this._layer?.action?.type === 'ink' && !!this._layer?.action?.annotation;
		if (!forceWhileDrawingInk && this._lastRenderSignature === signature) {
			return;
		}

		this._renderCommon();
		this._lastRenderSignature = signature;
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
			this._drawNoteIcon(ctx, annotation.color);
		}
		else if (annotation.type === 'image') {
			ctx.globalAlpha = 0.5;
			ctx.globalCompositeOperation = 'multiply';
			ctx.fillStyle = annotation.color;
			// Original canvas to view ratio. Normally it's 1 but once zoomed too much, the canvas resolution
			// is lower than the view, therefore, the ratio goes below 1
			let upscaleRatio = this._originalPage.viewport.width / parseFloat(this._snapshotCanvas.width) * devicePixelRatio;
			// Drag image to view, because drag canvas image can be smaller than what you see in the view
			let dragImageToViewRatio = width / (viewBoundingRect[2] - viewBoundingRect[0]);
			let coordinatesScale = devicePixelRatio * dragImageToViewRatio;
			let scale3 = dragImageToViewRatio * upscaleRatio;
			ctx.transform(scale3, 0, 0, scale3, -viewBoundingRect[0] * coordinatesScale, -viewBoundingRect[1] * coordinatesScale);
			ctx.drawImage(this._snapshotCanvas, 0, 0);
		}
		ctx.restore();
	}
}
