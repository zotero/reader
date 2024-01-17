import React from 'react';
import PreviewPopup from './preview-popup';
import LinkPopup from './link-popup';
import FootnotePopup from './footnote-popup';


function OverlayPopup(props) {
	if (props.params.type === 'internal-link') {
		return <PreviewPopup {...props}/>;
	}
	else if (props.params.type === 'external-link') {
		return <LinkPopup {...props}/>;
	}
	else if (props.params.type === 'footnote') {
		return <FootnotePopup {...props}/>;
	}
}

export default OverlayPopup;
