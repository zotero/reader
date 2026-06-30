import { normalizeDegrees } from './utilities';
import { getRectRotationOnText } from '../selection';

function getHandleRect(rect, rotation, side, padding) {
	let [x1, y1, x2, y2] = rect;
	if (side === 'start') {
		return (
			rotation === 0 && [x1 - padding, y1, x1 + padding, y2]
			|| rotation === 90 && [x1, y2 - padding, x2, y2 + padding]
			|| rotation === 180 && [x2 - padding, y1, x2 + padding, y2]
			|| rotation === 270 && [x1, y1 - padding, x2, y1 + padding]
		);
	}
	return (
		rotation === 0 && [x2 - padding, y1, x2 + padding, y2]
		|| rotation === 90 && [x1, y1 - padding, x2, y1 + padding]
		|| rotation === 180 && [x1 - padding, y1, x1 + padding, y2]
		|| rotation === 270 && [x1, y2 - padding, x2, y2 + padding]
	);
}

export function getTextRangeHandle({ chars, pageIndex, rect, side, getRect, getViewportRotation, padding = 3 }) {
	let rotation = getRectRotationOnText(chars, rect);
	rotation += getViewportRotation(pageIndex);
	rotation = normalizeDegrees(rotation);
	let handleRect = getHandleRect(getRect(rect, pageIndex), rotation, side, padding);
	if (!handleRect) {
		return null;
	}
	return {
		pageIndex,
		rect: handleRect,
		rotation,
		side,
		vertical: [90, 270].includes(rotation)
	};
}
