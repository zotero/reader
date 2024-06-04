import React from 'react';
import ViewPopup from '../common/view-popup';

function PreviewPopup(props) {
	return (
		<ViewPopup
			className="preview-popup"
			rect={props.params.rect}
			uniqueRef={{}}
			padding={10}
		>
			<div className="inner">
				<img style={{ maxHeight: props.params.height + 'px', maxWidth: props.params.width + 'px' }} src={props.params.image}/>
			</div>
		</ViewPopup>
	);
}

export default PreviewPopup;
