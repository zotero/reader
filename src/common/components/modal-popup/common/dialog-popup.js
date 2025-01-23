import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';

function DialogPopup({ className, children, onClose }) {
	let overlayRef = useRef();

	useLayoutEffect(() => {
		let node = overlayRef.current.querySelector('[data-default-focus]');
		if (node) {
			node.focus();
		}
	}, []);

	function handlePointerDown(event) {
		if (event.target === overlayRef.current) {
			if (onClose) {
				onClose();
			}
		}
	}

	return (
		<div ref={overlayRef} className="overlay dialog-popup-overlay" onPointerDown={handlePointerDown}>
			<div className={cx('modal-popup', className)}>
				{children}
			</div>
		</div>
	);
}
export default DialogPopup;
