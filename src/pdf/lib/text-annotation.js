import {
	applyTransform,
	transform,
	inverseTransform,
	getRotationTransform,
	getScaleTransform
} from './utilities';

function measureHeight(comment, width, fontSize) {
	let customAnnotation = document.createElement('textarea');
	comment = comment || 'A';
	customAnnotation.value = comment;
	// $font-family-sans-serif
	customAnnotation.style.fontFamily = '"Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", Geneva, -apple-system, sans-serif';
	customAnnotation.style.fontSize = fontSize + 'px';
	customAnnotation.style.wordBreak = 'break-word';
	customAnnotation.style.pointerEvents = 'none';
	customAnnotation.style.position = 'absolute';
	customAnnotation.style.top = '0';
	customAnnotation.style.left = '0';
	customAnnotation.style.overflow = 'hidden';
	customAnnotation.style.visibility = 'hidden';
	customAnnotation.style.height = fontSize + 'px';
	customAnnotation.style.width = width + 'px';
	customAnnotation.style.padding = 0;
	customAnnotation.style.margin = 0;
	customAnnotation.style.outline = 'none';
	customAnnotation.style.border = 'none';
	document.body.append(customAnnotation);
	customAnnotation.offsetWidth;
	let height = customAnnotation.scrollHeight;
	customAnnotation.remove();
	return height;
}

function measureWidth(comment, fontSize) {
	let customAnnotation = document.createElement('textarea');
	comment = comment || 'A';
	customAnnotation.value = comment;
	// $font-family-sans-serif
	customAnnotation.style.fontFamily = '"Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", Geneva, -apple-system, sans-serif';
	customAnnotation.style.fontSize = fontSize + 'px';
	customAnnotation.style.wordBreak = 'break-word';
	customAnnotation.style.pointerEvents = 'none';
	customAnnotation.style.position = 'absolute';
	customAnnotation.style.top = '0';
	customAnnotation.style.left = '0';
	customAnnotation.style.overflow = 'hidden';
	customAnnotation.style.visibility = 'hidden';
	customAnnotation.style.height = 0;
	customAnnotation.style.width = 0;
	customAnnotation.style.padding = 0;
	customAnnotation.style.margin = 0;
	customAnnotation.style.outline = 'none';
	customAnnotation.style.border = 'none';
	customAnnotation.style.whiteSpace = 'nowrap';
	document.body.append(customAnnotation);
	customAnnotation.offsetWidth;
	let width = customAnnotation.scrollWidth;
	customAnnotation.remove();
	return width + 1;
}


export function measureTextAnnotationDimensions(annotation, options = {}) {
	let position = annotation.position;
	let rect = position.rects[0];
	let width;
	let enforceWidth = false;
	if (rect[3] - rect[1] >= 2 * position.fontSize || !options.adjustSingleLineWidth) {
		enforceWidth = true;
		width = (position.rects[0][2] - position.rects[0][0]);
	}
	else {
		width = measureWidth(annotation.comment, position.fontSize);
	}
	let height = measureHeight(annotation.comment, width, position.fontSize);
	if (height < 2 * position.fontSize && !enforceWidth) {
		width = measureWidth(annotation.comment, position.fontSize);
		width += 5;
		if (width > 300 && options.enableSingleLineMaxWidth) {
			width = 300;
			height = measureHeight(annotation.comment, 300, position.fontSize);
		}
	}
	let ppp = {
		pageIndex: annotation.position.pageIndex,
		rects: [[0, 0, width, height]]
	};
	width = ppp.rects[0][2] - ppp.rects[0][0];
	height = ppp.rects[0][3] - ppp.rects[0][1];
	let p = JSON.parse(JSON.stringify(annotation.position));
	p.rects[0][2] = p.rects[0][0] + width;
	p.rects[0][3] = p.rects[0][1] + height;
	rect = p.rects[0];
	let r1 = annotation.position.rects[0];
	let m1 = getRotationTransform(r1, annotation.position.rotation);
	let r2 = rect;
	let m2 = getRotationTransform(r2, annotation.position.rotation);
	let mm = getScaleTransform(r1, r2, m1, m2, 'br');
	let mmm = transform(m2, mm);
	mmm = inverseTransform(mmm);
	r2 = [
		...applyTransform(r2, m2),
		...applyTransform(r2.slice(2), m2)
	];
	rect = [
		...applyTransform(r2, mmm),
		...applyTransform(r2.slice(2), mmm)
	];
	rect = rect.map(value => parseFloat(value.toFixed(3)));
	p.rects = [rect];
	return p;
}
