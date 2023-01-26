import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import cx from 'classnames';

const SIDEBAR_DEFAULT_WIDTH = 240; // Pixels
const SIDEBAR_MIN_WIDTH = 180; // Pixels

function SidebarResizer(props) {
	const [resizing, setResizing] = useState(false);
	const handlePointerMoveCallback = useCallback(handlePointerMove, [resizing]);
	const handlePointerUpCallback = useCallback(handlePointerUp, [resizing]);

	useEffect(() => {
		window.addEventListener('pointermove', handlePointerMoveCallback);
		window.addEventListener('pointerup', handlePointerUpCallback);
		return () => {
			window.removeEventListener('pointermove', handlePointerMoveCallback);
			window.removeEventListener('pointerup', handlePointerUpCallback);
		};
	}, [handlePointerMoveCallback, handlePointerUpCallback]);

	function handlePointerMove(event) {
		if (!resizing) {
			return;
		}
		let width = event.clientX;
		if (document.documentElement.dir === 'rtl') {
			width = window.innerWidth - width;
		}
		let maxWidth = Math.floor(window.innerWidth / 2);
		if (width > maxWidth) {
			width = maxWidth;
		}
		if (width < SIDEBAR_MIN_WIDTH) {
			width = SIDEBAR_MIN_WIDTH;
		}
		props.onResize(width);
	}

	function handlePointerUp() {
		setResizing(false);
	}

	function handlePointerDown() {
		setResizing(true);
	}

	return (
		<div
			className={cx('sidebar-resizer', { resizing })}
			onPointerDown={handlePointerDown}
		/>
	);
}

export default SidebarResizer;
