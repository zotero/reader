import { getRangeRects } from './lib/utilities.js';

export const DOUBLE_TAP_DELAY = 300;
export const DOUBLE_TAP_SLOP = 48;
const DOUBLE_TAP_ZOOM_MARGIN = 16;
const DOUBLE_TAP_MAX_SCALE = 4;

function normalizeRect(rect) {
	if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) {
		return null;
	}
	return [
		Math.min(rect[0], rect[2]),
		Math.min(rect[1], rect[3]),
		Math.max(rect[0], rect[2]),
		Math.max(rect[1], rect[3]),
	];
}

function distanceToRect(point, rect) {
	let dx = Math.max(rect[0] - point[0], 0, point[0] - rect[2]);
	let dy = Math.max(rect[1] - point[1], 0, point[1] - rect[3]);
	return Math.hypot(dx, dy);
}

function mergeRects(rects) {
	return [
		Math.min(...rects.map(rect => rect[0])),
		Math.min(...rects.map(rect => rect[1])),
		Math.max(...rects.map(rect => rect[2])),
		Math.max(...rects.map(rect => rect[3])),
	];
}

function horizontallyConnected(a, b) {
	let overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
	let minWidth = Math.min(a[2] - a[0], b[2] - b[0]);
	return overlap > 0 && overlap >= minWidth * 0.2;
}

export function isDoubleTap(first, second) {
	return !!first
		&& second.time - first.time <= DOUBLE_TAP_DELAY
		&& second.time >= first.time
		&& Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_SLOP;
}

export function getTextBlockRect(chars, point) {
	if (!Array.isArray(chars) || !chars.length
			|| !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
		return null;
	}

	let closestIndex = -1;
	let closestDistance = Infinity;
	for (let i = 0; i < chars.length; i++) {
		let char = chars[i];
		let rect = !char.ignorable && normalizeRect(char.rect);
		if (!rect) {
			continue;
		}
		let distance = distanceToRect(point, rect);
		if (distance < closestDistance) {
			closestIndex = i;
			closestDistance = distance;
		}
	}
	if (closestIndex === -1) {
		return null;
	}

	let closestChar = chars[closestIndex];
	let maxDistance = Math.max(24, (closestChar.fontSize || 0) * 2);
	if (closestDistance > maxDistance) {
		return null;
	}

	let start = closestIndex;
	while (start > 0 && !chars[start - 1].paragraphBreakAfter) {
		start--;
	}
	let end = closestIndex;
	while (end < chars.length - 1 && !chars[end].paragraphBreakAfter) {
		end++;
	}

	let lines = [];
	let lineStart = start;
	for (let i = start; i <= end; i++) {
		if (!chars[i].lineBreakAfter && i !== end) {
			continue;
		}
		let rect = normalizeRect(getRangeRects(chars, lineStart, i)[0]);
		if (rect) {
			lines.push({ start: lineStart, end: i, rect });
		}
		lineStart = i + 1;
	}
	if (!lines.length) {
		return null;
	}

	let groups = [];
	for (let line of lines) {
		let group = groups.at(-1);
		if (!group || !horizontallyConnected(group.rect, line.rect)) {
			groups.push({ start: line.start, end: line.end, rect: line.rect });
		}
		else {
			group.end = line.end;
			group.rect = mergeRects([group.rect, line.rect]);
		}
	}

	return groups.find(group => closestIndex >= group.start && closestIndex <= group.end)?.rect || null;
}

export function getDoubleTapTargetScale(currentScale, blockWidth, viewportWidth) {
	if (!(currentScale > 0) || !(viewportWidth > 0)) {
		return null;
	}
	let availableWidth = Math.max(1, viewportWidth - DOUBLE_TAP_ZOOM_MARGIN * 2);
	let fittedScale = blockWidth > 0
		? currentScale * availableWidth / blockWidth
		: currentScale * 2;
	return Math.min(
		DOUBLE_TAP_MAX_SCALE,
		Math.max(currentScale * 1.25, fittedScale)
	);
}
