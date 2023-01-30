import React, { Fragment, useState, useCallback, useEffect, useLayoutEffect, useRef, useImperativeHandle } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';
import { IconColor } from './common/icons'


const VERTICAL_PADDING = 2;

function ContextMenu({ params, onClose }) {
	const intl = useIntl();

	const [position, setPosition] = useState({ style: {} });
	const [update, setUpdate] = useState();
	const containerRef = useRef();

	useEffect(() => {
		setUpdate({});
	}, [params]);

	useLayoutEffect(() => {
		if (update) {
			updatePopupPosition();
		}
	}, [update]);

	function updatePopupPosition() {
		let popupWidth = containerRef.current.offsetWidth;
		let popupHeight = containerRef.current.offsetHeight;

		let { x: left, y: top } = params;

		top += VERTICAL_PADDING;

		if (left + popupWidth > window.innerWidth) {
			left = window.innerWidth - popupWidth;
		}

		if (top + popupHeight > window.innerHeight) {
			top = window.innerHeight - popupHeight;
		}

		setPosition({ style: { top, left } });
	}


	function handlePointerDown(event) {
		if (event.target.classList.contains('context-menu-overlay')) {
			// Closing context menu overlay results in another thumbnail click
			setTimeout(onClose);
		}
	}

	function handleClick(event, item) {
		onClose();
		event.preventDefault();
		// Allow context menu to close, before a confirmation popup
		setTimeout(() => item.onCommand());
	}

	return (
		<div className="context-menu-overlay" onPointerDown={handlePointerDown}>
			<div ref={containerRef} className="context-menu" style={position.style}>
				{params.itemGroups.map((items, i) => (
					<div key={i} className="group">
						{items.map((item, i) => (
							<button key={i} tabIndex={-1} className={cx('row', { checked: item.checked })}
									onClick={(event) => handleClick(event, item)} disabled={item.disabled}>{item.color &&
								<div className="icon"><IconColor color={item.color}/></div>}{item.label}</button>
						))}
					</div>
				))}
			</div>
		</div>
	);
}

export default ContextMenu;

