import React, { useLayoutEffect, useRef } from 'react';
import cx from 'classnames';

function DialogPopup({ className, children, onClose, onSubmit }) {
	let overlayRef = useRef();

	useLayoutEffect(() => {
		let node = overlayRef.current.querySelector('[data-default-focus]');
		if (node) {
			node.focus();
		}
		else {
			overlayRef.current.focus();
		}
	}, []);

	function handlePointerDown(event) {
		if (event.target === overlayRef.current) {
			onClose?.();
		}
	}

	function handleKeyDown(event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (onSubmit) {
				onSubmit(event);
				return;
			}
			onClose?.();
		}
		else if (event.key === 'Escape') {
			event.preventDefault();
			onClose?.();
		}
	}

	return (
		<div
			ref={overlayRef}
			className="overlay dialog-popup-overlay"
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
			tabIndex={-1}
		>
			<div className={cx('modal-popup', className)}>
				{children}
			</div>
		</div>
	);
}
export default DialogPopup;
