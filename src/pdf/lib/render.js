import { p2v } from './coordinates';
import {
	applyInverseTransform,
	applyTransform, darkenHex, getRotationDegrees, normalizeDegrees,
	transform
} from './utilities';
import { getRectRotationOnText } from '../selection';
import view from '../../common/view';

function calculateLines(context, text, maxWidth) {
	let words = text.split(' ');
	let lines = [];
	let line = '';

	for(let n = 0; n < words.length; n++) {
		let testLine = line + words[n] + ' ';
		let metrics = context.measureText(testLine);
		let testWidth = metrics.width;
		if (testWidth > maxWidth) {
			if (line.trim() === '') { // This is a single word exceeding the maxWidth
				// We need to split this word
				let testWord = '';
				for(let m = 0; m < words[n].length; m++) {
					let testChar = testWord + words[n][m];
					let metricsChar = context.measureText(testChar);
					let testCharWidth = metricsChar.width;
					if (testCharWidth > maxWidth) {
						lines.push(testWord);
						testWord = words[n][m];
					} else {
						testWord = testChar;
					}
				}
				line = testWord + ' ';
			} else { // This is a line that would exceed the maxWidth if we add the next word
				lines.push(line.trim());
				line = words[n] + ' ';
			}
		} else {
			line = testLine;
		}
	}
	lines.push(line.trim());
	return lines;
}

export function drawAnnotationsOnCanvas(canvas, viewport, annotations, pageIndex, pdfPages) {
	let ctx = canvas.getContext('2d', { alpha: false });

	let scale = canvas.width / viewport.width;
	ctx.transform(scale, 0, 0, scale, 0, 0);
	ctx.globalCompositeOperation = 'multiply';

	for (let annotation of annotations) {
		if (!(annotation.position.pageIndex === pageIndex
			|| annotation.position.nextPageRects && annotation.position.pageIndex + 1 === pageIndex)) {
			continue;
		}

		let { color } = annotation;
		let position = p2v(annotation.position, viewport, pageIndex);
		ctx.save();
		if (annotation.type === 'highlight') {
			let rects;
			if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
				rects = position.nextPageRects;
			}
			else {
				rects = position.rects;
			}
			ctx.fillStyle = color + '80';
			for (let rect of rects) {
				ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		else if (annotation.type === 'underline') {
			let color = annotation.color;
			let pageData = pdfPages[pageIndex];
			ctx.fillStyle = color;
			let rects;
			let pdfRect;
			if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
				rects = position.nextPageRects;
				pdfRect = annotation.position.nextPageRects[0];
			}
			else {
				rects = position.rects;
				pdfRect = annotation.position.rects[0];
			}
			let width = 1;
			width *= viewport.scale;
			for (let rect of rects) {
				// Note: This gets underline line rect taking into account text rotation,
				// if pageData exists, otherwise just uses 0 degrees, which
				// result in incorrect underline annotation rendering
				let rotation = 0;
				if (pageData) {
					let { chars } = pageData;
					rotation = getRectRotationOnText(chars, pdfRect);
				}
				// Add page rotation to text rotation
				rotation += getRotationDegrees(viewport.transform);
				rotation = normalizeDegrees(rotation);
				let [x1, y1, x2, y2] = rect;
				let rect2 = (
					rotation === 0 && [x1, y2 - width, x2, y2]
					|| rotation === 90 && [x2 - width, y2, x2, y1]
					|| rotation === 180 && [x1, y1, x2, y1 - width]
					|| rotation === 270 && [x1, y2, x1 - width, y1]
				);
				ctx.fillRect(rect2[0], rect2[1], rect2[2] - rect2[0], rect2[3] - rect2[1]);
			}
		}
		else if (annotation.type === 'note') {
			ctx.save();
			let [x, y] = position.rects[0];
			// TODO: Investigate why devicePixelRatio necessary here but not in page.drawNote
			let s = 1 / devicePixelRatio;
			ctx.transform(s, 0, 0, s, x, y);

			ctx.fillStyle = '#000';
			var path = new Path2D('M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z');
			ctx.fill(path);

			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(0.5, 0.5);
			ctx.lineTo(23.5, 0.5);
			ctx.lineTo(23.5, 23.5);
			ctx.lineTo(11.5, 23.5);
			ctx.lineTo(0.5, 12.5);
			ctx.closePath();
			ctx.fill();

			ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
			ctx.beginPath();
			ctx.moveTo(0.5, 12.5);
			ctx.lineTo(11.5, 12.5);
			ctx.lineTo(11.5, 23.5);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}
		else if (annotation.type === 'image') {
			let rect = position.rects[0];
			ctx.lineWidth = 2;
			ctx.strokeStyle = color;
			ctx.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		}
		else if (annotation.type === 'ink') {
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.lineWidth = position.width;
			ctx.beginPath();
			ctx.strokeStyle = color;
			for (let path of position.paths) {
				for (let i = 0; i < path.length - 1; i += 2) {
					let x = path[i];
					let y = path[i + 1];

					if (i === 0) {
						ctx.moveTo(x, y);
					}
					ctx.lineTo(x, y);
				}
			}
			ctx.stroke();
		}
		else if (annotation.type === 'text') {
			let position = annotation.position;
			let rect = position.rects[0];
			let width = rect[2] - rect[0];
			let lineHeight = position.fontSize * 1.2; // 1.2 is a common line height for many fonts
			ctx.fillStyle = annotation.color;
			ctx.font = position.fontSize + 'px ' + window.computedFontFamily;

			// Translation matrix where the drawing starts
			let x = rect[0];
			let y = rect[1];
			let translatedViewportMatrix = transform(viewport.transform, [1, 0, 0, 1, x, y]);

			// Rotation matrix
			let degrees = -position.rotation * Math.PI / 180;
			let cosValue = Math.cos(degrees);
			let sinValue = Math.sin(degrees);
			let rotationMatrix = [cosValue, sinValue, -sinValue, cosValue, 0, 0];

			// Flip matrix because text gets inverted otherwise
			let flipMatrix = [1, 0, 0, -1, 0, 0];
			// Combine flip and rotation matrices
			let flipAndRotationMatrix = transform(flipMatrix, rotationMatrix);

			// Annotation center without x and y coordinates because we translate the viewport
			let centerX = (rect[2] - rect[0]) / 2;
			let centerY = (rect[3] - rect[1]) / 2;

			// Calculate center in the viewport matrix
			let [x1, y1] = applyTransform([centerX, centerY], translatedViewportMatrix);
			let [x2, y2] = applyTransform([centerX, centerY], transform(translatedViewportMatrix, flipAndRotationMatrix));

			// Annotation center drift after applying flip and rotation matrix
			let deltaX = x1 - x2;
			let deltaY = y1 - y2;

			// Adjust delta x and y scale and sign
			let viewportWithoutTranslationMatrix = viewport.transform.slice();
			viewportWithoutTranslationMatrix[4] = viewportWithoutTranslationMatrix[5] = 0;
			[deltaX, deltaY] = applyInverseTransform([deltaX, deltaY], viewportWithoutTranslationMatrix);
			// Correct flipAndRotationMatrix to have rotation and flip around the annotation center
			flipAndRotationMatrix[4] = deltaX;
			flipAndRotationMatrix[5] = deltaY;

			let finalMatrix = transform(translatedViewportMatrix, flipAndRotationMatrix);
			ctx.transform(...finalMatrix);
			let lineIndex = 0;
			let lines = calculateLines(ctx, annotation.comment, width);
			for (let line of lines) {
				ctx.fillText(line, 0, lineIndex * lineHeight + lineHeight);
				lineIndex++;
			}
		}
		ctx.restore();
	}
}
