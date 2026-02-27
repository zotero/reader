import React, { useEffect, useRef, useState } from 'react';
import cx from 'classnames';

const EDGE_PADDING = 10;

function UtilityPopup(props) {
	let { children, className } = props;

	let ref = useRef();
	let [dragOrigin, setDragOrigin] = useState(null);
	let [x, setX] = useState(null);
	let [y, setY] = useState(null);

	let [windowWidth, windowHeight] = useWindowSize();

	useEffect(() => {
		if (!ref.current || x === null || y === null) {
			return;
		}
		let left = Math.max(Math.min(x, windowWidth - ref.current.offsetWidth - EDGE_PADDING), EDGE_PADDING);
		let top = Math.max(Math.min(y, windowHeight - ref.current.offsetHeight - EDGE_PADDING), EDGE_PADDING);
		ref.current.style.left = `${left}px`;
		ref.current.style.top = `${top}px`;
	}, [x, y, windowWidth, windowHeight]);

	function getOffset(event) {
		let boundingRect = ref.current.getBoundingClientRect();
		return [event.clientX - boundingRect.x, event.clientY - boundingRect.y];
	}

	let handlePointerDown = (event) => {
		if (event.button !== 0 || event.target.closest('input, button, select, a')) {
			return;
		}
		ref.current.setPointerCapture(event.pointerId);
		setDragOrigin(getOffset(event));
	};

	let handlePointerMove = (event) => {
		if (!dragOrigin || !ref.current.hasPointerCapture(event.pointerId)) {
			return;
		}
		let x = event.clientX - dragOrigin[0];
		let y = event.clientY - dragOrigin[1];
		setX(x);
		setY(y);
	};

	let handlePointerUp = (event) => {
		if (!dragOrigin || !ref.current.hasPointerCapture(event.pointerId)) {
			return;
		}
		ref.current.releasePointerCapture(event.pointerId);
		setDragOrigin(null);
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
			ref={ref}
		>
			{children}
		</div>
	);
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
