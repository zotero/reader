'use strict';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';

const LEFT_OR_RIGHT_TOOLTIP_CENTER = 20;
const VERTICAL_PADDING = 10;

function Popup({ id, data, className, children, onClose }) {
	const [position, setPosition] = useState({ style: {}, classes: {} });
	const [update, setUpdate] = useState();
	const containerRef = useRef();

	useEffect(() => {
		setUpdate({});
	}, [data]);

	useLayoutEffect(() => {
		if (update) {
			updatePopupPosition();
		}
	}, [update]);

	function handlePointerDown(event) {
		if (event.target.classList.contains('popup-overlay')) {
			onClose();
		}
	}

	function getContainer() {
		let container = document.getElementById('popupContainer');
		if (!container) {
			let outerContainer = document.getElementById('outerContainer');
			container = document.createElement('div');
			container.dir = document.documentElement.dir;
			container.id = 'popupContainer';
			outerContainer.append(container);
		}
		return container;
	}

	function updatePopupPosition() {
		let horizontal = 'center';
		let vertical = 'bottom';

		let popupWidth = containerRef.current.offsetWidth;
		let popupHeight = containerRef.current.offsetHeight;

		let rect = data.rect;

		let top = rect[3] + VERTICAL_PADDING;
		let left = rect[0] + (rect[2] - rect[0]) / 2 - popupWidth / 2;

		if (left < 0) {
			left = rect[0] + (rect[2] - rect[0]) / 2 - LEFT_OR_RIGHT_TOOLTIP_CENTER;
			horizontal = 'left';
		}
		else if (left + popupWidth > window.innerWidth) {
			left = rect[0] + (rect[2] - rect[0]) / 2 - (popupWidth - LEFT_OR_RIGHT_TOOLTIP_CENTER);
			horizontal = 'right';
		}

		if (top + popupHeight > window.innerHeight) {
			vertical = 'top';
			top = rect[1] - popupHeight - VERTICAL_PADDING;
		}

		// If still outside of visible screen area
		if (left < 0) {
			left = 0;
			horizontal = 'left';
		}
		else if (left + popupWidth > window.innerWidth) {
			left = window.innerWidth - popupWidth;
			horizontal = 'right';
		}

		setPosition({
			style: {
				top,
				left
			},
			classes: {
				['popup-' + vertical]: true,
				['popup-' + horizontal]: true
			}
		});
	}

	return ReactDOM.createPortal(
		<div className="popup-overlay" onPointerDown={handlePointerDown}>
			<div
				id={id}
				ref={containerRef}
				className={cx('popup', className, position.classes)}
				style={position.style}
			>
				{children}
			</div>
		</div>,
		getContainer()
	);
}

export default Popup;
