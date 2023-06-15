import React, { useLayoutEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import ViewPopup from '../view-popup';

function PortalPopup(props) {
	const intl = useIntl();
	const containerRef = useRef();


	let width = 400;
	let height = 200;

	let x = props.params.rect[0];
	let y = props.params.rect[1];

	function handleOnRender() {
		let parent = containerRef.current;
		let top = parent.offsetTop;
		let left = parent.offsetLeft;
		let r = parent.getBoundingClientRect();
		let rect = [
			r.left,
			r.top,
			r.right,
			r.bottom,
		];
		props.onSetPortal({ rect, dest: props.params.dest });
	}


	// props.onSetPortal(props.params);

	return (
		<ViewPopup
			className="portal-popup"
			rect={props.params.rect}
			uniqueRef={{}}
			padding={10}
			onRender={handleOnRender}
		>
			<div className="inner" ref={containerRef} style={{ width: props.params.width + 'px', height: props.params.height + 'px' }}>

			</div>
		</ViewPopup>
	);
}

export default PortalPopup;
