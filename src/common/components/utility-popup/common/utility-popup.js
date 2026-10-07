import React, { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import cx from 'classnames';

import { ReaderContext } from '../../../reader';

const EDGE_PADDING = 10;

/**
 * @param {Object} props
 * @param {String} [props.className]
 * @param {String} [props.persistID] If set, the position is saved under this ID and restored in later sessions
 * @param {Function} [props.getDefaultPosition] (rect) => ({ x, y }), called after the first layout if
 * 	no position has been restored
 * @param {Function} [props.onDraggingChange] (dragging) => void
 * @param {Function} [props.onPointerMove]
 */
const UtilityPopup = forwardRef(function UtilityPopup(props, ref) {
	let { children, className, persistID, getDefaultPosition, onDraggingChange, onPointerMove } = props;

	let { getPopupPosition, setPopupPosition } = useContext(ReaderContext);

	let innerRef = useRef();
	let movedRef = useRef(false);
	let [dragOrigin, setDragOrigin] = useState(null);
	let [position, setPosition] = useState(() => (persistID && getPopupPosition?.(persistID)) || null);

	let [windowWidth, windowHeight] = useWindowSize();

	useImperativeHandle(ref, () => innerRef.current, []);

	// If we didn't restore a position, let the popup pick a starting one based on where
	// its stylesheet put it, so that it's kept in the window from then on
	useLayoutEffect(() => {
		if (position || !getDefaultPosition || !innerRef.current) {
			return;
		}
		setPosition(getDefaultPosition(innerRef.current.getBoundingClientRect()));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	let applyPosition = useCallback(() => {
		if (!innerRef.current || !position) {
			return;
		}
		let [left, top] = clampToWindow(position, innerRef.current, windowWidth, windowHeight);
		let style = innerRef.current.style;
		// Clear any positioning from the stylesheet (including logical properties,
		// centering margins, and centering transforms), since we're taking over
		style.inset = 'auto';
		style.margin = '0';
		style.transform = 'none';
		style.left = `${left}px`;
		style.top = `${top}px`;
	}, [position, windowWidth, windowHeight]);

	useLayoutEffect(() => {
		applyPosition();
	}, [applyPosition]);

	// Reclamp when the popup's own size changes, so that growing content can't
	// push it out of the window
	useEffect(() => {
		if (!innerRef.current || !position) {
			return undefined;
		}
		let resizeObserver = new ResizeObserver(() => applyPosition());
		resizeObserver.observe(innerRef.current);
		return () => resizeObserver.disconnect();
	}, [applyPosition, position]);

	function getOffset(event) {
		let boundingRect = innerRef.current.getBoundingClientRect();
		return [event.clientX - boundingRect.x, event.clientY - boundingRect.y];
	}

	let handlePointerDown = (event) => {
		if (event.button !== 0 || event.target.closest('input, button, select, a, [role="listbox"]')) {
			return;
		}
		innerRef.current.setPointerCapture(event.pointerId);
		movedRef.current = false;
		setDragOrigin(getOffset(event));
		onDraggingChange?.(true);
	};

	let handlePointerMove = (event) => {
		onPointerMove?.(event);
		if (!dragOrigin || !innerRef.current.hasPointerCapture(event.pointerId)) {
			return;
		}
		let x = event.clientX - dragOrigin[0];
		let y = event.clientY - dragOrigin[1];
		movedRef.current = true;
		setPosition({ x, y });
	};

	let handlePointerUp = (event) => {
		if (!dragOrigin || !innerRef.current.hasPointerCapture(event.pointerId)) {
			return;
		}
		innerRef.current.releasePointerCapture(event.pointerId);
		setDragOrigin(null);
		onDraggingChange?.(false);
		if (persistID && position && movedRef.current) {
			// Save the clamped position
			let [left, top] = clampToWindow(position, innerRef.current, windowWidth, windowHeight);
			setPopupPosition?.(persistID, { x: left, y: top });
		}
	};

	return (
		<div
			className={cx('utility-popup', className)}
			role="application"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			style={{ pointerEvents: dragOrigin ? 'none' : 'auto' }}
			ref={innerRef}
		>
			{children}
		</div>
	);
});

function clampToWindow(position, element, windowWidth, windowHeight) {
	return [
		Math.max(Math.min(position.x, windowWidth - element.offsetWidth - EDGE_PADDING), EDGE_PADDING),
		Math.max(Math.min(position.y, windowHeight - element.offsetHeight - EDGE_PADDING), EDGE_PADDING),
	];
}

function useWindowSize(win = window) {
	const [size, setSize] = useState([win.innerWidth, win.innerHeight]);

	useEffect(() => {
		let handleResize = () => {
			setSize([win.innerWidth, win.innerHeight]);
		};
		win.addEventListener('resize', handleResize);
		return () => {
			win.removeEventListener('resize', handleResize);
		};
	}, [win]);

	return size;
}

export default UtilityPopup;
