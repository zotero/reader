import React from 'react';
import ViewPopup from '../view-popup';

function PreviewPopup(props) {
	return (
		<ViewPopup
			className="preview-popup"
			rect={props.params.rect}
			uniqueRef={{}}
			padding={10}
		>
			<img width={props.params.width} height={props.params.height} src={props.params.image}/>
		</ViewPopup>
	);
}

export default PreviewPopup;
