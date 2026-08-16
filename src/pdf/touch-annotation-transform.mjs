const ACTION_TYPES = new Set(['moveAndDrag', 'resize', 'rotate']);
const DRAG_SLOP = 5;

export function shouldStartInlineTextAnnotationEditing(event, platform) {
	return platform === 'android' && event.pointerType === 'touch';
}

export function createTouchAnnotationTransform(event, action, annotationSelected, platform) {
	// Other platforms keep native touch gestures (scroll, pinch-zoom) over selected annotations
	if (platform !== 'android' || event.pointerType !== 'touch' || !annotationSelected || !ACTION_TYPES.has(action.type)) {
		return null;
	}
	return {
		pointerID: event.pointerId,
		target: event.target,
		x: event.clientX,
		y: event.clientY,
	};
}

export function touchAnnotationTransformMoved(transform, event) {
	return Math.hypot(event.clientX - transform.x, event.clientY - transform.y) >= DRAG_SLOP;
}
