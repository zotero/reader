import React, { useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import cx from 'classnames';

const VIEW_MIN_SIZE = 20; // Percent

// TODO: Reset size on resizer double click

function SplitViewResizer(props) {
	const [resizing, setResizing] = useState(false);
	const resizerRef = useRef();
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


		let size;
		if (document.body.classList.contains('enable-horizontal-split-view')) {
			let y = event.clientY;
			let br = resizerRef.current.parentNode.getBoundingClientRect();
			let p = Math.floor((br.height - (y - br.top)) / br.height * 100);
			if (p < 20) {
				p = 20;
			}
			else if (p > 80) {
				p = 80;
			}
			size = p;
		}
		else {
			let x = event.clientX;
			let br = resizerRef.current.parentNode.getBoundingClientRect();
			let p = Math.floor((br.width - (x - br.left)) / br.width * 100);
			if (p < 20) {
				p = 20;
			}
			else if (p > 80) {
				p = 80;
			}
			size = p;
			if (window.rtl) {
				size = 100 - size;
			}
		}







		//
		//
		// let width = window.innerWidth - event.clientX;
		// if (document.documentElement.dir === 'rtl') {
		// 	width = event.clientX;
		// }
		//
		//
		//
		//
		//
		//
		// let maxWidth = 100 - VIEW_MIN_WIDTH;
		// if (width > maxWidth) {
		// 	width = maxWidth;
		// }
		// if (width < VIEW_MIN_WIDTH) {
		// 	width = VIEW_MIN_WIDTH;
		// }
		props.onResize(size + '%');
	}

	function handlePointerUp() {
		setResizing(false);
	}

	function handlePointerDown() {
		setResizing(true);
	}

	return (
		<div
			ref={resizerRef}
			className={cx('split-view-resizer', { resizing })}
			onPointerDown={handlePointerDown}
		/>
	);
}

export default SplitViewResizer;
