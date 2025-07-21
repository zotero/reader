import {
	applyInverseTransform,
	applyTransform,
	getPositionBoundingRect,
	getRotationTransform,
	transform,
	scaleShape,
	getRotationDegrees,
	normalizeDegrees,
	inverseTransform
} from './lib/utilities';
import {
	DARKEN_INK_AND_TEXT_COLOR,
	FIND_RESULT_COLOR_ALL_DARK,
	FIND_RESULT_COLOR_ALL_LIGHT,
	FIND_RESULT_COLOR_CURRENT_DARK,
	FIND_RESULT_COLOR_CURRENT_LIGHT,
	MIN_IMAGE_ANNOTATION_SIZE,
	SELECTION_COLOR
} from '../common/defines';
import { getRectRotationOnText } from './selection';
import { darkenHex } from './lib/utilities';

export default class Page {
	constructor(layer, originalPage) {
		this.layer = layer;
		this.originalPage = originalPage;
		this.pageIndex = originalPage.id - 1;
		// this.overlays = [];
		this.chars = [];
		this.selectionColor = '#bad6fb';
		this.previouslyAffected = false;

		let canvas = document.createElement('canvas');
		canvas.width = this.originalPage.canvas.width;
		canvas.height = this.originalPage.canvas.height;
		this.originalCanvas = canvas;
		this.originalContext = canvas.getContext('2d');
		this.originalContext.drawImage(this.originalPage.canvas, 0, 0);
		this.actualContext = this.originalPage.canvas.getContext('2d');
	}

	// getSortedObjects() {
	// 	let annotations = this.layer._getPageAnnotations(this.pageIndex);
	// 	let objects = [...annotations, ...this.overlays];
	// 	objects.sort((a, b) => a.sortIndex < b.sortIndex);
	// 	return objects;
	// }

	async redrawOriginalPage() {
		const { viewport, outputScale, pdfPage } = this.originalPage;
		pdfPage.pendingCleanup = true;
		pdfPage._tryCleanup();
		const transform = outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : null;
		const renderTask = this.originalPage.pdfPage.render({
			canvasContext: this.originalContext,
			transform,
			viewport
		});
		await renderTask.promise;
		this.previouslyAffected = true;
	}

	// PDF to Canvas transform
	get transform() {
		let scale = this.originalPage.currentCanvasWidth / this.originalPage.viewport.width;
		let scaleTransform = [scale, 0, 0, scale, 0, 0];
		return transform(scaleTransform, this.originalPage.viewport.transform);
	}

	get scale() {
		// We only care about x scale, because y is always the same
		let [a, b] = this.transform;
		return Math.hypot(a, b);
	}

	getViewPoint(p, transform = this.transform) {
		return applyTransform(p, transform);
	}

	getPdfPoint(p) {
		return applyInverseTransform(p, this.transform);
	}

	getViewRect(rect, transform = this.transform) {
		let p1 = applyTransform(rect, transform);
		let p2 = applyTransform(rect.slice(2, 4), transform);
		let [x1, y1] = p1;
		let [x2, y2] = p2;
		return [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		];
	}

	p2v(position) {
		let transform = this.transform;
		if (position.rects) {
			if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
				return {
					pageIndex: position.pageIndex,
					nextPageRects: position.nextPageRects.map((rect) => {
						let [x1, y2] = applyTransform(rect, transform);
						let [x2, y1] = applyTransform(rect.slice(2, 4), transform);
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
						let [x1, y2] = applyTransform(rect, transform);
						let [x2, y1] = applyTransform(rect.slice(2, 4), transform);
						return [
							Math.min(x1, x2),
							Math.min(y1, y2),
							Math.max(x1, x2),
							Math.max(y1, y2)
						];
					})
				};
				// For text annotations
				if (position.fontSize) {
					position2.fontSize = position.fontSize * this.scale;
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
				// For PDF pages with crop box it's necessary to subtract the zero point
				width: position.width * this.scale,
				paths: position.paths.map((path) => {
					let vpath = [];
					for (let i = 0; i < path.length - 1; i += 2) {
						let x = path[i];
						let y = path[i + 1];
						vpath.push(...applyTransform([x, y], transform));
					}
					return vpath;
				})
			};
		}
	}

	v2p(position) {
		let transform = this.transform;
		return {
			pageIndex: position.pageIndex,
			rects: position.rects.map((rect) => {
				let [x1, y2] = applyInverseTransform(rect, transform);
				let [x2, y1] = applyInverseTransform(rect.slice(2, 4), transform);
				return [
					Math.min(x1, x2),
					Math.min(y1, y2),
					Math.max(x1, x2),
					Math.max(y1, y2)
				];
			})
		};
	}

	drawHover() {
		if (!this.layer._hover) {
			return;
		}
		let color = '#46b1ff';
		this.actualContext.save();
		if (this.layer._themeColorScheme === 'light') {
			this.actualContext.globalAlpha = 0.1;
			this.actualContext.globalCompositeOperation = 'multiply';
		}
		else {
			this.actualContext.globalAlpha = 0.5;
			this.actualContext.globalCompositeOperation = 'lighten';

		}
		this.actualContext.fillStyle = color;

		let position = this.layer._hover;
		position = this.p2v(position);
		let rects;
		if (position.pageIndex === this.pageIndex) {
			rects = position.rects;
		}
		else if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
			rects = position.nextPageRects;
		}

		if (rects) {
			for (let rect of rects) {
				this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}

		this.actualContext.restore();
	}

	drawOverlays() {
		if (!this.layer._pdfPages[this.pageIndex]) {
			return;
		}
		let color = '#76c6ff';
		this.actualContext.save();
		if (this.layer._themeColorScheme === 'light') {
			this.actualContext.globalAlpha = 0.1;
			this.actualContext.globalCompositeOperation = 'multiply';
		}
		else {
			this.actualContext.globalAlpha = 0.4;
			this.actualContext.globalCompositeOperation = 'lighten';

		}
		this.actualContext.fillStyle = color;

		for (let overlay of this.layer._pdfPages[this.pageIndex].overlays) {
			if (!(overlay.type === 'citation' || overlay.type === 'internal-link' && overlay.source === 'matched')) {
				continue;
			}
			let { position } = overlay;
			position = this.p2v(position);
			let rects = position.rects;
			if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
				rects = position.nextPageRects;
			}
			else if (position.pageIndex === this.pageIndex) {

			}
			else {
				continue;
			}

			for (let rect of rects) {
				this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		this.actualContext.restore();
	}

	drawNote(ctx, color) {
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

	drawCommentIndicators(annotations) {

		function quickIntersectRect(r1, r2) {
			return !(r2[0] > r1[2]
				|| r2[2] < r1[0]
				|| r2[1] > r1[3]
				|| r2[3] < r1[1]);
		}


		let notes = [];

		let width = 7;
		let height = 7;
		for (let annotation of annotations) {
			if (
				!['highlight', 'underline', 'image'].includes(annotation.type)
				|| !annotation.comment
				|| annotation.position.pageIndex !== this.pageIndex
			) {
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
			this.actualContext.save();
			let scale = Math.abs(this.getViewPoint([1 / (24 / width), 0])[0] - this.getViewPoint([0, 0])[0]);
			let rect = this.getViewRect(note.rect);
			this.actualContext.transform(scale, 0, 0, scale, rect[0], rect[1]);
			this.actualContext.globalAlpha = 0.5;
			this.drawNote(this.actualContext, note.annotation.color);
			this.actualContext.restore();
		}
	}

	_renderHighlight(annotation) {
		let color = annotation.color;

		let position = this.p2v(annotation.position);
		this.actualContext.save();
		if (this.layer._themeColorScheme === 'light') {
			this.actualContext.globalCompositeOperation = 'multiply';
			this.actualContext.globalAlpha = 0.4;
		}
		else {
			this.actualContext.globalCompositeOperation = 'lighter';
			this.actualContext.globalAlpha = 0.3;
		}
		this.actualContext.fillStyle = color;

		let rects = position.rects;
		if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
			rects = position.nextPageRects;
		}

		for (let rect of rects) {
			this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		}
		this.actualContext.restore();
	}

	_renderUnderline(annotation) {
		let color = annotation.color;
		let pageData = this.layer._pdfPages[this.pageIndex];
		if (!pageData) {
			return;
		}
		let { chars } = pageData;
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		if (this.layer._themeColorScheme === 'light') {
			this.actualContext.globalCompositeOperation = 'multiply';
		}
		else {
			this.actualContext.globalAlpha = 0.9;
		}
		this.actualContext.fillStyle = color;
		let rects;
		let pdfRect;
		if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
			rects = position.nextPageRects;
			pdfRect = annotation.position.nextPageRects[0];
		}
		else {
			rects = position.rects;
			pdfRect = annotation.position.rects[0];
		}
		let width = 1;
		width *= this.scale;
		for (let rect of rects) {
			// Get the underline line rect taking into account text rotation
			let rotation = getRectRotationOnText(chars, pdfRect);
			// Add page rotation to text rotation
			rotation += getRotationDegrees(this.transform);
			rotation = normalizeDegrees(rotation);
			let [x1, y1, x2, y2] = rect;
			let rect2 = (
				rotation === 0 && [x1, y2 - width, x2, y2]
				|| rotation === 90 && [x2 - width, y2, x2, y1]
				|| rotation === 180 && [x1, y1, x2, y1 - width]
				|| rotation === 270 && [x1, y2, x1 - width, y1]
			);
			this.actualContext.fillRect(rect2[0], rect2[1], rect2[2] - rect2[0], rect2[3] - rect2[1]);
		}
		this.actualContext.restore();
	}

	_renderNote(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		let viewRect = position.rects[0];
		let scale = this.scale * (22 / 24);
		this.actualContext.transform(scale, 0, 0, scale, viewRect[0], viewRect[1]);
		this.drawNote(this.actualContext, annotation.color);
		this.actualContext.restore();
	}

	_renderImage(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		this.actualContext.strokeStyle = annotation.color;
		this.actualContext.lineWidth = 3 * devicePixelRatio;
		let rect = position.rects[0];
		// Make image annotation more opaque if it's still too small
		let pdfRect = annotation.position.rects[0];
		let width = pdfRect[2] - pdfRect[0];
		let height = pdfRect[3] - pdfRect[1];
		if (width < MIN_IMAGE_ANNOTATION_SIZE || height < MIN_IMAGE_ANNOTATION_SIZE) {
			this.actualContext.globalAlpha = 0.2;
		}
		this.actualContext.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		this.actualContext.restore();
	}

	_renderInk(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		this.actualContext.beginPath();
		this.actualContext.strokeStyle = darkenHex(annotation.color, DARKEN_INK_AND_TEXT_COLOR);
		this.actualContext.lineWidth = position.width;
		this.actualContext.lineCap = 'round';
		this.actualContext.lineJoin = 'round';

		for (let path of position.paths) {
			this.actualContext.moveTo(...path.slice(0, 2));
			for (let i = 0; i < path.length - 1; i += 2) {
				let x = path[i];
				let y = path[i + 1];
				if (i === 0) {
					this.actualContext.moveTo(x, y);
				}
				this.actualContext.lineTo(x, y);
			}
		}
		this.actualContext.stroke();
		this.actualContext.restore();
	}

	_renderFindResults() {
		if (!this.layer._findController
			|| !this.layer._findController.highlightMatches
			|| !this.layer._findController._matchesCountTotal
			|| !this.layer._pdfPages[this.pageIndex]
		) {
			return;
		}
		let { selected } = this.layer._findController;
		let positions = this.layer._findController.getMatchPositions(
			this.pageIndex,
			this.layer._pdfPages[this.pageIndex]
		);

		if (!positions || !positions.length) {
			return;
		}

		this.actualContext.save();

		for (let i = 0; i < positions.length; i++) {
			let position = positions[i];
			if (selected.pageIdx === this.pageIndex && i === selected.matchIdx) {
				this.actualContext.fillStyle = this.layer._themeColorScheme === 'dark'
					? FIND_RESULT_COLOR_CURRENT_DARK
					: FIND_RESULT_COLOR_CURRENT_LIGHT;
			}
			else {
				if (!this.layer._findController.state.highlightAll) {
					continue;
				}
				this.actualContext.fillStyle = this.layer._themeColorScheme === 'dark'
					? FIND_RESULT_COLOR_ALL_DARK
					: FIND_RESULT_COLOR_ALL_LIGHT;
			}

			position = this.p2v(position);
			for (let rect of position.rects) {
				// Define the corner radius
				let cornerRadius = 5;

				// Calculate the width and height of the rectangle
				let x = rect[0];
				let y = rect[1];
				let width = rect[2] - rect[0];
				let height = rect[3] - rect[1];

				// Draw the rectangle with rounded corners
				this.actualContext.beginPath();
				this.actualContext.moveTo(x + cornerRadius, y);
				this.actualContext.lineTo(x + width - cornerRadius, y);
				this.actualContext.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
				this.actualContext.lineTo(x + width, y + height - cornerRadius);
				this.actualContext.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
				this.actualContext.lineTo(x + cornerRadius, y + height);
				this.actualContext.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
				this.actualContext.lineTo(x, y + cornerRadius);
				this.actualContext.quadraticCurveTo(x, y, x + cornerRadius, y);
				this.actualContext.closePath();

				this.actualContext.fill();
			}
		}

		this.actualContext.restore();
	}


	render() {
		if (!this.actualContext) {
			return;
		}

		let annotations = this.layer._getPageAnnotations(this.pageIndex);
		let selectedAnnotationIDs = this.layer._selectedAnnotationIDs;
		let selectionRanges = this.layer._selectionRanges;
		let action = this.layer.action;
		let annotationTextSelectionData = this.layer._annotationTextSelectionData;
		let focusedObject = this.layer._focusedObject;
		let highlightedPosition = this.layer._highlightedPosition;

		let doc = this.originalPage.div.ownerDocument;
		let customAnnotationLayer = this.originalPage.div.querySelector('.customAnnotationLayer');
		if (!customAnnotationLayer) {
			customAnnotationLayer = doc.createElement('div');
			customAnnotationLayer.className = 'customAnnotationLayer';
			this.originalPage.div.append(customAnnotationLayer);
		}
		let customAnnotations = Array.from(customAnnotationLayer.children);

		for (let annotation of annotations) {
			if (annotation.type === 'text' && annotation.position.pageIndex === this.pageIndex) {
				let position = annotation.position;
				if (action && action.position && ['resize', 'rotate'].includes(action.type) && action.annotation.id === annotation.id) {
					position = action.position;
				}
				let rect = position.rects[0];

				let node = customAnnotations.find(x => x.getAttribute('data-id') === annotation.id);
				let disabled = this.layer._readOnly || annotation.readOnly;
				let viewport = this.originalPage.viewport;
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
				];

				style = style.join(';');

				if (!node) {
					node = doc.createElement('textarea');
					node.setAttribute('data-id', annotation.id);
					node.dir = 'auto';
					node.className = 'textAnnotation';
					node.disabled = disabled;
					node.addEventListener('blur', (event) => {
						node.classList.remove('focusable');
						// node.contentEditable = false;
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
		let textAnnotationNodes = Array.from(this.layer._iframeWindow.document.querySelectorAll(`[data-page-number="${this.pageIndex + 1}"] .textAnnotation`));
		for (let node of textAnnotationNodes) {
			let id = node.getAttribute('data-id');
			if (!annotations.find(x => x.id === id)) {
				node.remove();
			}
		}

		this.actualContext.save();
		this.actualContext.drawImage(this.originalCanvas, 0, 0);

		for (let annotation of annotations) {
			if (annotation.type === 'highlight' && !(action?.type === 'updateAnnotationRange' && action.annotation.id === annotation.id)) {
				this._renderHighlight(annotation);
			}
			if (annotation.type === 'underline' && !(action?.type === 'updateAnnotationRange' && action.annotation.id === annotation.id)) {
				this._renderUnderline(annotation);
			}
			else if (annotation.type === 'note') {
				this._renderNote(annotation);
			}
			else if (annotation.type === 'image') {
				if (!selectedAnnotationIDs.includes(annotation.id)) {
					this._renderImage(annotation);
				}
			}
			else if (annotation.type === 'ink') {
				if (action && action.position && action.type === 'resize' && annotation.id === action.annotation.id) {
					this._renderInk({ ...annotation, position: action.position });
				}
				else if (action && action.triggered && action.type === 'erase' && action.annotations.has(annotation.id)) {
					let { position } = action.annotations.get(annotation.id);
					this._renderInk({ ...annotation, position });
				}
				else {
					this._renderInk(annotation);
				}
			}
		}

		if (action?.type === 'updateAnnotationRange' && (
			action.annotation.position.pageIndex === this.pageIndex
			|| action.annotation.position.nextPageRects && action.annotation.position.pageIndex + 1 === this.pageIndex
		)) {
			if (action.annotation.type === 'highlight') {
				this._renderHighlight(action.annotation);
			}
			else if (action.annotation.type === 'underline') {
				this._renderUnderline(action.annotation);
			}
		}


		this.drawCommentIndicators(annotations);



		this.drawOverlays();

		this.drawHover();

		this._renderFindResults();


		if (!selectedAnnotationIDs.length
			&& focusedObject && (
				focusedObject.pageIndex === this.pageIndex
				|| focusedObject.object.position.nextPageRects && focusedObject.pageIndex === this.pageIndex
			)
		) {
			let position = focusedObject.object.position;
			this.actualContext.strokeStyle = window.computedColorFocusBorder;
			this.actualContext.lineWidth = 3 * devicePixelRatio;

			let padding = 5 * devicePixelRatio;

			let rect = getPositionBoundingRect(position, this.pageIndex);

			rect = this.getViewRect(rect);

			rect = [
				rect[0] - padding,
				rect[1] - padding,
				rect[2] + padding,
				rect[3] + padding,
			];

			let radius = 10 * devicePixelRatio; // Radius for rounded corners

			this.actualContext.beginPath();
			this.actualContext.moveTo(rect[0] + radius, rect[1]);
			this.actualContext.lineTo(rect[2] - radius, rect[1]);
			this.actualContext.arcTo(rect[2], rect[1], rect[2], rect[1] + radius, radius);
			this.actualContext.lineTo(rect[2], rect[3] - radius);
			this.actualContext.arcTo(rect[2], rect[3], rect[2] - radius, rect[3], radius);
			this.actualContext.lineTo(rect[0] + radius, rect[3]);
			this.actualContext.arcTo(rect[0], rect[3], rect[0], rect[3] - radius, radius);
			this.actualContext.lineTo(rect[0], rect[1] + radius);
			this.actualContext.arcTo(rect[0], rect[1], rect[0] + radius, rect[1], radius);
			this.actualContext.stroke();
		}






		if (action?.type !== 'updateAnnotationRange' || !action?.triggered) {
			this.actualContext.save();
			let selectedAnnotations = annotations.filter(x => selectedAnnotationIDs.includes(x.id));
			for (let annotation of selectedAnnotations) {

				this.actualContext.strokeStyle = '#6d95e0';
				this.actualContext.beginPath();
				this.actualContext.setLineDash([5 * devicePixelRatio, 3 * devicePixelRatio]);
				this.actualContext.lineWidth = 2 * devicePixelRatio;
				let padding = 5 * devicePixelRatio;
				let rect = getPositionBoundingRect(annotation.position, this.pageIndex);
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
					this.actualContext.lineWidth = 3 * devicePixelRatio;
				}
				let tm = this.transform;
				if (annotation.type === 'text') {
					tm = getRotationTransform(rect, rotation || 0);
					tm = transform(this.transform, tm);
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
				p1 = this.getViewPoint(p1, tm);
				p2 = this.getViewPoint(p2, tm);
				p3 = this.getViewPoint(p3, tm);
				p4 = this.getViewPoint(p4, tm);
				pml = this.getViewPoint(pml, tm);
				pmr = this.getViewPoint(pmr, tm);
				pmt = this.getViewPoint(pmt, tm);
				pmb = this.getViewPoint(pmb, tm);
				pr = this.getViewPoint(pr, tm);
				let BOX_PADDING = 10 * devicePixelRatio;
				if (annotation.type !== 'image') {
					[p1, p2, p3, p4, pml, pmr, pmt, pmb] = scaleShape([p1, p2, p3, p4], [p1, p2, p3, p4, pml, pmr, pmt, pmb], BOX_PADDING);
				}
				// Dashed lines
				this.actualContext.beginPath();
				this.actualContext.moveTo(...p1);
				this.actualContext.lineTo(...p2);
				this.actualContext.lineTo(...p3);
				this.actualContext.lineTo(...p4);
				this.actualContext.closePath();
				if (!(this.layer._readOnly || annotation.readOnly) && annotation.type === 'text') {
					this.actualContext.moveTo(...pmt);
					this.actualContext.lineTo(...pr);
				}
				this.actualContext.stroke();
				const radius = 4 * devicePixelRatio;
				this.actualContext.fillStyle = '#81b3ff';

				// Circles
				if (!(this.layer._readOnly || annotation.readOnly)) {
					if (['image', 'text', 'ink'].includes(annotation.type)) {
						this.actualContext.beginPath();
						this.actualContext.arc(...p1, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (['image', 'text', 'ink'].includes(annotation.type)) {
						this.actualContext.beginPath();
						this.actualContext.arc(...p2, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (['image', 'text', 'ink'].includes(annotation.type)) {
						this.actualContext.beginPath();
						this.actualContext.arc(...p4, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (['image', 'text', 'ink'].includes(annotation.type)) {
						this.actualContext.beginPath();
						this.actualContext.arc(...p3, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (['image', 'text'].includes(annotation.type)) {
						this.actualContext.beginPath();
						this.actualContext.arc(...pmr, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (['image', 'text'].includes(annotation.type)) {
						this.actualContext.beginPath();
						this.actualContext.arc(...pml, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (annotation.type === 'image') {
						this.actualContext.beginPath();
						this.actualContext.arc(...pmt, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (annotation.type === 'image') {
						this.actualContext.beginPath();
						this.actualContext.arc(...pmb, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
					if (annotation.type === 'text') {
						this.actualContext.beginPath();
						this.actualContext.arc(...pr, radius, 0, 2 * Math.PI, false);
						this.actualContext.fill();
					}
				}
			}
			this.actualContext.restore();
		}

		let annotation = annotations.find(x => x.id === selectedAnnotationIDs[0]);

		if (annotation && ['highlight', 'underline'].includes(annotation.type)) {
			let annotation2 = annotation;
			if (action?.type === 'updateAnnotationRange' && action.annotation) {
				annotation2 = action.annotation;
			}
			if (this.layer._pdfPages[this.pageIndex]
				&& (!annotation2.position.nextPageRects || this.layer._pdfPages[this.pageIndex + 1])) {
				let { chars } = this.layer._pdfPages[this.pageIndex];
				let position = this.p2v(annotation2.position);
				this.actualContext.save();
				if (this.layer._themeColorScheme === 'light') {
					this.actualContext.globalCompositeOperation = 'multiply';
				}

				this.actualContext.fillStyle = annotation2.color;
				let startRect;
				let endRect;
				let padding = 1 * devicePixelRatio;
				if (annotation2.position.nextPageRects) {
					if (position.pageIndex + 1 === this.pageIndex) {
						let { chars } = this.layer._pdfPages[this.pageIndex + 1];
						let rotation = getRectRotationOnText(chars, annotation2.position.nextPageRects.at(-1));
						// Add page rotation to text rotation
						rotation += getRotationDegrees(this.transform);
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
						// Add page rotation to text rotation
						rotation += getRotationDegrees(this.transform);
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
					// Add page rotation to text rotation
					rotation += getRotationDegrees(this.transform);
					rotation = normalizeDegrees(rotation);
					let [x1, y1, x2, y2] = position.rects[0];
					startRect = (
						rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
						|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
						|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
						|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
					);
					rotation = getRectRotationOnText(chars, annotation2.position.rects.at(-1));
					// Add page rotation to text rotation
					rotation += getRotationDegrees(this.transform);
					rotation = normalizeDegrees(rotation);
					[x1, y1, x2, y2] = position.rects.at(-1);
					endRect = (
						rotation === 0 && [x2 - padding, y1, x2 + padding, y2]
						|| rotation === 90 && [x1, y1 - padding, x2, y1 + padding]
						|| rotation === 180 && [x1 - padding, y1, x1 + padding, y2]
						|| rotation === 270 && [x1, y2 - padding, x2, y2 + padding]
					);
				}
				if (!(this.layer._readOnly || annotation.readOnly) && startRect) {
					let rect = startRect;
					this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
				}
				if (!(this.layer._readOnly || annotation.readOnly) && endRect) {
					let rect = endRect;
					this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
				}
				this.actualContext.restore();
			}
		}


		this.actualContext.save();
		if (selectionRanges.length && !selectionRanges[0].collapsed && ['highlight', 'underline'].includes(this.layer._tool.type)) {
			let annotation = this.layer._getAnnotationFromSelectionRanges(selectionRanges, this.layer._tool.type, this.layer._tool.color);
			if (annotation.position.pageIndex === this.pageIndex
				|| annotation.position.nextPageRects && annotation.position.pageIndex + 1 === this.pageIndex) {
				if (annotation.type === 'highlight') {
					this._renderHighlight(annotation);
				}
				else {
					this._renderUnderline(annotation);
				}
			}
		}
		else {
			for (let selectionRange of selectionRanges) {
				let { position } = selectionRange;
				if (position.pageIndex !== this.pageIndex) {
					continue;
				}
				position = this.p2v(position);
				this.actualContext.fillStyle = SELECTION_COLOR;

				if (this.layer._themeColorScheme === 'light') {
					this.actualContext.globalCompositeOperation = 'multiply';
					this.actualContext.globalAlpha = 0.4;
				}
				else {
					this.actualContext.globalCompositeOperation = 'lighten';
					this.actualContext.globalAlpha = 0.7;
				}


				for (let rect of position.rects) {
					this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
				}
			}
		}
		this.actualContext.restore();


		if (action) {
			if (action.type === 'moveAndDrag' && action.triggered) {
				if (action.annotation.position.pageIndex === this.pageIndex) {
					this.actualContext.strokeStyle = '#aaaaaa';
					this.actualContext.setLineDash([5 * devicePixelRatio, 3 * devicePixelRatio]);
					this.actualContext.lineWidth = 2 * devicePixelRatio;
					let rect = getPositionBoundingRect(action.position);
					let tm = this.transform;
					if (action.annotation.type === 'text') {
						rect = action.position.rects[0];
						tm = getRotationTransform(rect, action.annotation.position.rotation || 0);
						tm = transform(this.transform, tm);
					}
					let p1 = [rect[0], rect[1]];
					let p2 = [rect[2], rect[1]];
					let p3 = [rect[2], rect[3]];
					let p4 = [rect[0], rect[3]];
					p1 = this.getViewPoint(p1, tm);
					p2 = this.getViewPoint(p2, tm);
					p3 = this.getViewPoint(p3, tm);
					p4 = this.getViewPoint(p4, tm);
					let BOX_PADDING = 10 * devicePixelRatio;
					[p1, p2, p3, p4] = scaleShape([p1, p2, p3, p4], [p1, p2, p3, p4], BOX_PADDING);
					this.actualContext.beginPath();
					this.actualContext.moveTo(...p1);
					this.actualContext.lineTo(...p2);
					this.actualContext.lineTo(...p3);
					this.actualContext.lineTo(...p4);
					this.actualContext.closePath();
					this.actualContext.stroke();
				}
			}
			else if (action.type === 'image' && action.annotation) {
				if (action.annotation.position.pageIndex === this.pageIndex) {
					this._renderImage(action.annotation);
				}
			}
			else if (action.type === 'ink' && action.annotation) {
				if (action.annotation.position.pageIndex === this.pageIndex) {
					this._renderInk(action.annotation);
				}
			}
		}

		// Highlight position
		if (highlightedPosition && (
			highlightedPosition.pageIndex === this.pageIndex
			|| highlightedPosition.nextPageRects && highlightedPosition.pageIndex + 1 === this.pageIndex
		)) {
			let position = highlightedPosition;
			let annotation = { position, color: SELECTION_COLOR };
			if (position.rects) {
				this._renderHighlight(annotation);
			}
			else if (position.paths) {
				this._renderInk(annotation);
			}
		}

		this.actualContext.restore();
	}

	nextPagePosition(position) {
		return position.nextPageRects && position.pageIndex + 1 === this.pageIndex;
	}

	renderAnnotationOnCanvas(annotation, canvas) {
		let ctx = canvas.getContext('2d');

		let pixelRatio = window.devicePixelRatio;
		let transform = this.originalPage.viewport.transform;

		let pdfBoundingRect = getPositionBoundingRect(annotation.position, this.pageIndex);
		let viewBoundingRect = this.getViewRect(pdfBoundingRect, transform);
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
			if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
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
			// ctx.globalAlpha = 0.5;
			ctx.globalCompositeOperation = 'multiply';
			ctx.fillStyle = annotation.color || SELECTION_COLOR;
			let rects = position.rects;
			if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
				rects = position.nextPageRects;
			}
			ctx.transform(1, 0, 0, 1, -pdfBoundingRect[0], -pdfBoundingRect[1]);
			for (let rect of rects) {
				ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		else if (annotation.type === 'note') {
			let rect = annotation.position.rects[0];
			let width = rect[2] - rect[0];
			scale *= (width / 24);
			ctx.transform(scale, 0, 0, scale, 0, 0);
			this.drawNote(ctx, annotation.color);
		}
		else if (annotation.type === 'image') {
			ctx.globalAlpha = 0.5;
			ctx.globalCompositeOperation = 'multiply';
			ctx.fillStyle = annotation.color;
			// Original canvas to view ratio. Normally it's 1 but once zoomed too much canvas resolution is lover than the view,
			// therefore the ratio goes below 1
			let upscaleRatio = this.originalPage.viewport.width / parseFloat(this.originalCanvas.width) * devicePixelRatio;
			// Drag image to view, because drag canvas image can smaller than what you see in the view
			let dragImageToViewRatio = width / (viewBoundingRect[2] - viewBoundingRect[0]);
			let coordinatesScale = devicePixelRatio * dragImageToViewRatio;
			let scale = dragImageToViewRatio * upscaleRatio;
			ctx.transform(scale, 0, 0, scale, -viewBoundingRect[0] * coordinatesScale, -viewBoundingRect[1] * coordinatesScale);
			ctx.drawImage(this.originalCanvas, 0, 0);
		}
		ctx.restore();
	}
}
