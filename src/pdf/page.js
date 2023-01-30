// import { getBoundingBox, scaleShape, } from './utilities.js';
// import { BOX_PADDING } from './defines.js';

import { applyInverseTransform, applyTransform, getPositionBoundingRect, transform } from './lib/utilities';
import { SELECTION_COLOR } from '../common/defines';

export default class Page {
	constructor(layer, originalPage) {
		this.layer = layer;
		this.originalPage = originalPage;
		this.pageIndex = originalPage.id - 1;
		this.overlays = [];
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

	async updateData() {
		// let data = await this.originalPage.pdfPage._transport.getContentData({ pageIndex: this.pageIndex });
		// console.log('Received content data', data)
		// this.objects = data.objects;
		this.chars = await this.layer._extractor.getPageChars(this.pageIndex);
		// this.calculateSnapLines();
		await this.initOverlays();
	}

	async initOverlays() {
		let page = await PDFViewerApplication.pdfDocument.getPage(this.pageIndex + 1);
		let annotations = await page.getAnnotations();
		for (let annotation of annotations) {
			let overlay = {
				position: {
					pageIndex: this.pageIndex,
					rects: [annotation.rect]
				}
			};
			overlay.sortIndex = this.layer._extractor.getSortIndex(overlay.position);
			if (annotation.url) {
				overlay.type = 'external-link';
				overlay.url = annotation.url;
			}
			else if (annotation.dest) {
				overlay.type = 'internal-link';
				overlay.dest = annotation.dest;
			}
			else {
				continue;
			}
			this.overlays.push(overlay);
		}
	}

	getSortedObjects() {
		let annotations = this.layer._getPageAnnotations(this.pageIndex);
		let objects = [...annotations, ...this.overlays];
		objects.sort((a, b) => a.sortIndex < b.sortIndex);
		return objects;
	}

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

	get devicePixelRatio() {
		return window.devicePixelRatio || 1;
	}

	// PDF to Canvas transform
	get transform() {
		let scale = parseFloat(this.originalCanvas.width) / this.originalPage.viewport.width;
		let scaleTransform = [scale, 0, 0, scale, 0, 0];
		return transform(scaleTransform, this.originalPage.viewport.transform);
	}

	getViewPoint(p) {
		return applyTransform(p, this.transform);
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

	p2v(position, transform = this.transform) {
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
				return {
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
			}
		}
		else if (position.paths) {
			return {
				pageIndex: position.pageIndex,
				width: applyTransform([position.width, 0], transform)[0],
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
			if (!['highlight', 'image'].includes(annotation.type) || !annotation.comment) {
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
			let scale = this.getViewPoint([1 / (24 / width), 0])[0];
			let rect = this.getViewRect(note.rect);
			this.actualContext.transform(scale, 0, 0, scale, rect[0], rect[1]);
			this.drawNote(this.actualContext, note.annotation.color);
			this.actualContext.restore();
		}
	}

	_renderHighlight(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		this.actualContext.globalAlpha = 0.4;
		this.actualContext.globalCompositeOperation = 'multiply';
		this.actualContext.fillStyle = annotation.color;

		let rects = position.rects;
		if (position.nextPageRects && position.pageIndex + 1 === this.pageIndex) {
			rects = position.nextPageRects;
		}

		for (let rect of rects) {
			this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		}
		this.actualContext.restore();
	}

	_renderNote(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		let pdfRect = annotation.position.rects[0];
		let viewRect = position.rects[0];
		let scale = (viewRect[2] - viewRect[0]) / (pdfRect[2] - pdfRect[0]) * (22 / 24);
		this.actualContext.transform(scale, 0, 0, scale, viewRect[0], viewRect[1]);
		this.drawNote(this.actualContext, annotation.color);
		this.actualContext.restore();
	}

	_renderImage(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		this.actualContext.strokeStyle = annotation.color;
		this.actualContext.lineWidth = 3 * this.devicePixelRatio;
		let rect = position.rects[0];
		this.actualContext.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		this.actualContext.restore();
	}

	_renderInk(annotation) {
		let position = this.p2v(annotation.position);
		this.actualContext.save();
		this.actualContext.beginPath();
		this.actualContext.strokeStyle = annotation.color;
		this.actualContext.lineWidth = position.width;
		this.actualContext.lineCap = 'round';
		this.actualContext.lineJoin = 'round';

		for (let path of position.paths) {
			this.actualContext.moveTo(...path.slice(0, 2));
			for (let i = 2; i < path.length - 1; i += 2) {
				let x = path[i];
				let y = path[i + 1];
				this.actualContext.lineTo(x, y);
			}
		}
		this.actualContext.stroke();
		this.actualContext.restore();
	}



	render() {
		if (!this.actualContext) {
			return;
		}

		this.actualContext.save();
		this.actualContext.drawImage(this.originalCanvas, 0, 0);

		let annotations = this.layer._getPageAnnotations(this.pageIndex);
		let selectedAnnotationIDs = this.layer._selectedAnnotationIDs;
		let selectionRanges = this.layer._selectionRanges;
		let action = this.layer.action;
		let annotationTextSelectionData = this.layer._annotationTextSelectionData;
		let focusedObject = this.layer._focusedObject;
		let highlightedPosition = this.layer._highlightedPosition;

		for (let annotation of annotations) {
			if (annotation.type === 'highlight' && !(action?.type === 'updateAnnotationRange' && action.annotation.id === annotation.id)) {
				this._renderHighlight(annotation);
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
				this._renderInk(annotation);
			}
		}

		if (action?.type === 'updateAnnotationRange') {
			this._renderHighlight(action.annotation);
		}

		this.drawCommentIndicators(annotations);









		if (focusedObject && (
			focusedObject.position.pageIndex === this.pageIndex
			|| focusedObject.position.nextPageRects && focusedObject.position.pageIndex + 1 === this.pageIndex
		)) {
			let position = focusedObject.position;

			this.actualContext.strokeStyle = '#838383';
			this.actualContext.beginPath();
			this.actualContext.setLineDash([10, 6]);
			this.actualContext.lineWidth = 2 * this.devicePixelRatio;


			let padding = 5 * this.devicePixelRatio;


			let rect = getPositionBoundingRect(position, this.pageIndex);

			rect = this.getViewRect(rect);


			rect = [
				rect[0] - padding,
				rect[1] - padding,
				rect[2] + padding,
				rect[3] + padding,
			];
			this.actualContext.rect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			this.actualContext.stroke();
		}






		if (action?.type !== 'updateAnnotationRange' || !action?.triggered) {
			this.actualContext.save();
			let selectedAnnotations = annotations.filter(x => selectedAnnotationIDs.includes(x.id));
			for (let annotation of selectedAnnotations) {

				this.actualContext.strokeStyle = '#6d95e0';
				this.actualContext.beginPath();
				this.actualContext.setLineDash([10, 6]);
				this.actualContext.lineWidth = 2 * this.devicePixelRatio;


				let padding = 5 * this.devicePixelRatio;


				let rect = getPositionBoundingRect(annotation.position, this.pageIndex);

				if (annotation.type === 'image') {
					padding = 0;
					this.actualContext.lineWidth = 3 * this.devicePixelRatio;
					if (action && action.type === 'resize' && action.triggered) {
						rect = action.position.rects[0];
					}
				}

				rect = this.getViewRect(rect);


				rect = [
					rect[0] - padding,
					rect[1] - padding,
					rect[2] + padding,
					rect[3] + padding,
				];
				this.actualContext.rect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
				this.actualContext.stroke();
			}
			this.actualContext.restore();
		}

		let annotation = annotations.find(x => x.id === selectedAnnotationIDs[0]);


		if (annotationTextSelectionData && annotation && !action?.triggered) {
			this.actualContext.save();
			this.actualContext.globalCompositeOperation = 'multiply';
			this.actualContext.fillStyle = annotation.color;
			let padding = 1 * devicePixelRatio;
			let handles = annotationTextSelectionData.handles;

			// if (action?.type === 'updateAnnotationRange' && action.handles) {
			// 	handles = action.handles;
			// }

			for (let handle of handles) {
				let rect = this.getViewRect(handle.rect);
				if (rect[1] === rect[3]) {
					rect[1] -= padding;
					rect[3] += padding;
				}
				else {
					rect[0] -= padding;
					rect[2] += padding;
				}
				this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
			this.actualContext.restore();
		}


		this.actualContext.save();
		this.actualContext.globalCompositeOperation = 'multiply';
		for (let selectionRange of selectionRanges) {
			let { position } = selectionRange;
			if (position.pageIndex !== this.pageIndex) {
				continue;
			}
			position = this.p2v(position);
			this.actualContext.fillStyle = SELECTION_COLOR;
			for (let rect of position.rects) {
				this.actualContext.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		this.actualContext.restore();


		if (action) {
			if (action.type === 'moveAndDrag') {
				if (action.annotation.position.pageIndex === this.pageIndex) {

					let padding = 5 * this.devicePixelRatio;

					this.actualContext.strokeStyle = '#aaaaaa';
					this.actualContext.beginPath();
					this.actualContext.setLineDash([10, 6]);
					this.actualContext.lineWidth = 2 * this.devicePixelRatio;

					let position = this.p2v(action.position);
					let rect = position.rects[0];

					rect = [
						rect[0] - padding,
						rect[1] - padding,
						rect[2] + padding,
						rect[3] + padding,
					];
					this.actualContext.rect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
					this.actualContext.stroke();
				}
			}
			else if (action.type === 'highlight' && action.annotation) {
				if (action.annotation.position.pageIndex === this.pageIndex
					|| action.annotation.position.nextPageRects && action.annotation.position.pageIndex + 1 === this.pageIndex) {
					this._renderHighlight(action.annotation);
				}
			}
			else if (action.type === 'image' && action.annotation) {
				if (action.annotation.position.pageIndex === this.pageIndex) {
					this._renderImage(action.annotation);
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
			ctx.fillStyle = annotation.color;
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
