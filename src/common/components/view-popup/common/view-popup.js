import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';

// TODO: Resizing window doesn't properly reposition annotation popup on x axis, in EPUB view
function ViewPopup({ id, rect, className, uniqueRef, padding, children, onRender }) {
	const [popupPosition, setPopupPosition] = useState(null);
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
		} else {
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

		let annotationCenterLeft = rect[0] + (rect[2] - rect[0]) / 2;
		let left = annotationCenterLeft - width / 2;

		let side;
		let top;
		if (left < 0) {
			side = 'right';
			left = rect[2] + padding;
			top = rect[1] + ((rect[3] - rect[1]) - height) / 2;
			if (top < 0) {
				top = rect[1];
			} else if (top + height > viewRect[3]) {
				top = (rect[1] + (rect[3] - rect[1])) - height;
			}
		} else if (left + width > viewRect[2]) {
			side = 'left';
			left = rect[0] - width - padding;
			top = rect[1] + ((rect[3] - rect[1]) - height) / 2;
			if (top < 0) {
				top = rect[1];
			} else if (top + height > viewRect[3]) {
				top = (rect[1] + (rect[3] - rect[1])) - height;
			}
		} else if (rect[3] + height + padding < viewRect[3]) {
			top = rect[3] + padding;
			side = 'bottom';
		} else if (rect[1] - padding - height > 0) {
			top = rect[1] - padding - height;
			side = 'top';
		} else {
			top = rect[3] + padding;
			side = 'top';

			if (rect[0] < (viewRect[2] - viewRect[0]) / 2) {
				side = 'right';
				left = rect[2] + padding;
				top = rect[1] + ((rect[3] - rect[1]) - height) / 2;
				if (top < 0) {
					top = rect[1];
				} else if (top + height > viewRect[3]) {
					top = (rect[1] + (rect[3] - rect[1])) - height;
				}
			} else {
				side = 'left';
				left = rect[0] - width - padding;
				top = rect[1] + ((rect[3] - rect[1]) - height) / 2;
				if (top < 0) {
					top = rect[1];
				} else if (top + height > viewRect[3]) {
					top = (rect[1] + (rect[3] - rect[1])) - height;
				}
			}

			if (left < padding) {
				left = padding;
			}
			else if (left + width > viewRect[2] - padding) {
				left = viewRect[2] - width - padding;
			}
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

	return (
		<div
			ref={containerRef}
			className={cx('view-popup', className, { ...pointerClass })}
			style={pos.current ? { transform: `translate(${pos.current.left}px, ${pos.current.top}px)` } : {}}
		>
			{children}
		</div>
	);
}

export default ViewPopup;
