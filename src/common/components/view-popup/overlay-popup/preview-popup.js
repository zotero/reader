import React, { useRef } from 'react';
import ViewPopup from '../common/view-popup';

function PreviewPopup(props) {
	const innerRef = useRef();

	function handleRender() {
		let { x, y } = props.params;

		let viewportWidth = innerRef.current.offsetWidth;
		let viewportHeight = innerRef.current.offsetHeight;

		// Calculate the desired scroll positions
		const scrollLeft = x - viewportWidth / 2;
		const scrollTop = y - viewportHeight / 2;

		if (scrollTop > 0) {
			innerRef.current.scrollTop = scrollTop;
		}
		if (scrollLeft > 0) {
			innerRef.current.scrollLeft = scrollLeft;
		}
	}

	return (
		<ViewPopup
			className="preview-popup"
			rect={props.params.rect}
			uniqueRef={{}}
			padding={10}
			onRender={handleRender}
		>
			<div dir="ltr" ref={innerRef} className="inner" tabIndex="-1" data-tabstop={1}>
				<img height={props.params.height} width={props.params.width} src={props.params.image}/>
			</div>
		</ViewPopup>
	);
}

export default PreviewPopup;
