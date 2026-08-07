import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import cx from 'classnames';

// TODO: Resizing window doesn't properly reposition annotation popup on x axis, in EPUB view
function ViewPopup({ id, rect, className, uniqueRef, padding, preferTop, preferLeft, children, onRender }) {
	const [popupPosition, setPopupPosition] = useState(null);
	const [disableTransformForCaret, setDisableTransformForCaret] = useState(false);
	const containerRef = useRef();
	const xrect = useRef();

	const initialized = useRef(false);
	const pos = useRef(null);

	// Update the popup position when the `rect` changes
	useEffect(() => {
		if (xrect.current) {
			let dx = rect[0] - xrect.current[0];
			let dy = rect[1] - xrect.current[1];
			xrect.current = rect;

			pos.current.left += dx;
			pos.current.top += dy;

			setPopupPosition({}); // Trigger re-render
		}
		else {
			xrect.current = rect;
		}
	}, [rect]);

	useLayoutEffect(() => {
		if (initialized.current) {
			onRender && onRender();
		}
	}, [popupPosition]);

	useLayoutEffect(() => {
		updatePopupPosition();
		// Editor needs more time to get its final dimensions
		setTimeout(updatePopupPosition, 0);
	}, [uniqueRef, rect]);

	function updatePopupPosition() {
		if (!containerRef.current) {
			return;
		}

		let width = containerRef.current.offsetWidth;
		let height = containerRef.current.offsetHeight;

		let parent = containerRef.current.parentNode;
		let viewRect = parent.getBoundingClientRect();
		viewRect = [0, 0, viewRect.width, viewRect.height];

		function calculateTop() {
			let top = rect[1] + ((rect[3] - rect[1]) - height) / 2;
			if (top < 0) {
				top = rect[1];
			}
			else if (top + height > viewRect[3]) {
				top = (rect[1] + (rect[3] - rect[1])) - height;
			}
			return top;
		}

		let annotationCenterLeft = rect[0] + (rect[2] - rect[0]) / 2;
		let left = annotationCenterLeft - width / 2;

		let side;
		let top;
		if (left < 0) {
			side = 'right';
			left = rect[2] + padding;
			top = calculateTop();
		}
		else if (left + width > viewRect[2]) {
			side = 'left';
			left = rect[0] - width - padding;
			top = calculateTop();
		}
		else {
			// Try to place the popup on the preferred vertical side (bottom
			// by default, top if `preferTop`).
			// Fall back to the other side if the preferred one doesn't fit.
			let fitsAbove = rect[1] - padding - height > 0;
			let fitsBelow = rect[3] + height + padding < viewRect[3];
			if (preferTop ? fitsAbove : fitsBelow) {
				if (preferTop) {
					top = rect[1] - padding - height;
					side = 'top';
				}
				else {
					top = rect[3] + padding;
					side = 'bottom';
				}
			}
			else if (preferTop ? fitsBelow : fitsAbove) {
				if (preferTop) {
					top = rect[3] + padding;
					side = 'bottom';
				}
				else {
					top = rect[1] - padding - height;
					side = 'top';
				}
			}
			else {
				// Neither above nor below fits, so place the popup next to the
				// rect. If `preferLeft` is passed (not undefined), place on the
				// preferred side. Otherwise, place on the side with more room.
				let placeLeft = preferLeft === undefined
					? rect[0] >= (viewRect[2] - viewRect[0]) / 2
					: preferLeft;
				if (placeLeft) {
					side = 'left';
					left = rect[0] - width - padding;
				}
				else {
					side = 'right';
					left = rect[2] + padding;
				}
				top = calculateTop();
			}
		}

		if (left + width > viewRect[2] - padding) {
			left = viewRect[2] - width - padding;
		}
		if (left < padding) {
			left = padding;
		}
		if (top + height > viewRect[3] - padding) {
			top = viewRect[3] - height - padding;
		}
		if (top < padding) {
			top = padding;
		}

		xrect.current = rect;
		pos.current = { top, left, side };

		setPopupPosition({}); // Trigger re-render
		initialized.current = true;
	}

	let pointerClass = {};
	if (pos.current) {
		pointerClass['page-popup-' + pos.current.side + '-center'] = true;
	}

	function isTextEditableTarget(target) {
		return !!target?.closest?.('div[contenteditable="true"], input, textarea');
	}

	function handleFocusCapture(event) {
		if (isTextEditableTarget(event.target)) {
			setDisableTransformForCaret(true);
		}
	}

	function handleBlurCapture(event) {
		let stillInsidePopup = containerRef.current?.contains(event.relatedTarget);
		if (!stillInsidePopup) {
			setDisableTransformForCaret(false);
		}
	}

	let style = {};
	if (pos.current) {
		style = disableTransformForCaret
			? {
				left: pos.current.left, top: pos.current.top
			}
			: {
				transform: `translate(${pos.current.left}px, ${pos.current.top}px)`
			};

	}

	return (
		<div
			ref={containerRef}
			className={cx('view-popup', className, { ...pointerClass })}
			onFocusCapture={handleFocusCapture}
			onBlurCapture={handleBlurCapture}
			style={style}
		>
			{children}
		</div>
	);
}

export default ViewPopup;
