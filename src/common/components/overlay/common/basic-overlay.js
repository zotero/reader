import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';

function BasicOverlay({ className, children, onClose }) {
	let overlayRef = useRef();

	useLayoutEffect(() => {
		let node = overlayRef.current.querySelector('[data-default-focus]');
		if (node) {
			node.focus();
		}
	}, [])

	function handlePointerDown(event) {
		if (event.target.classList.contains('overlay')) {
			if (onClose) {
				onClose();
			}
		}
	}

	return (
		<div ref={overlayRef} className={cx('overlay basic-overlay', className)} onPointerDown={handlePointerDown}>
			<div className="popup">
				{children}
			</div>
		</div>
	);
}

export default BasicOverlay;
