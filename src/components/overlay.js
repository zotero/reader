'use strict';

import React, { useRef } from 'react';
import ReactDOM from 'react-dom';

function Overlay({ id, children, onClose }) {
	const containerRef = useRef();

	function handleContainerClick(event) {
		if (onClose && event.target.className === 'container') {
			onClose();
		}
	}

	function getContainer() {
		let container = document.getElementById('overlayContainer2');
		if (!container) {
			let outerContainer = document.getElementById('outerContainer');
			container = document.createElement('div');
			container.dir = document.documentElement.dir;
			container.id = 'overlayContainer2';
			outerContainer.append(container);
		}
		return container;
	}

	return ReactDOM.createPortal(
		<div
			ref={containerRef}
			id={id}
			className="container"
			onClick={handleContainerClick}
		>
			{children}
		</div>,
		getContainer()
	);
}

export default Overlay;
