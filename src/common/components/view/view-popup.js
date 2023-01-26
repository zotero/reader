import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';

// TODO: Resizing window doesn't properly reposition annotation popup on x axis, in EPUB view
function ViewPopup({ id, rect, className, uniqueRef, padding, children, onRender }) {
	const [popupPosition, setPopupPosition] = useState(null);
	const [update, setUpdate] = useState();
	const containerRef = useRef();
	const xrect = useRef();

	const initialized = useRef(false);

	const pos = useRef(null);

	useEffect(() => {
		if (xrect.current) {
			let dx = rect[0] - xrect.current[0];
			let dy = rect[1] - xrect.current[1];
			xrect.current = rect;

			pos.current.left += dx;
			pos.current.top += dy;
		}
	});

	useLayoutEffect(() => {
		if (initialized.current) {
			onRender && onRender();
		}
	});

	useLayoutEffect(() => {
		updatePopupPosition();
	}, [uniqueRef]);

	function updatePopupPosition() {
		let width = containerRef.current.offsetWidth;
		let height = containerRef.current.offsetHeight;

		let parent = containerRef.current.parentNode;
		let viewRect = parent.getBoundingClientRect();
		viewRect = [viewRect.left, viewRect.top, viewRect.right, viewRect.bottom];



		let annotationCenterLeft = rect[0] + (rect[2] - rect[0]) / 2;

		let left = annotationCenterLeft - width / 2;

		let isTop = true;

		let top;
		if (rect[3] + height + padding < viewRect[3]) {
			top = rect[3] + padding;
			isTop = false;
		}
		else if (rect[1] - padding - height > 0) {
			top = rect[1] - padding - height;
		}
		else {
			top = rect[3] + padding;
			isTop = false;
		}


		xrect.current = rect;





		pos.current = { top, left, isTop };

		setPopupPosition({});
		initialized.current = true;
	}


	let pointerClass = {};
	if (pos.current) {
		pointerClass['page-popup-' + (pos.current.isTop ? 'top' : 'bottom')] = true;
	}

	return (
		<div
			ref={containerRef}
			className={cx('view-popup', className, { ...pointerClass })}
			style={pos.current && { transform: `translate(${pos.current.left}px, ${pos.current.top}px)` }}
		>
			{children}
		</div>
	);
}

export default ViewPopup;
