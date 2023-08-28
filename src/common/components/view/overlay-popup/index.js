import React from 'react';
import PortalPopup from './portal-popup';
import LinkPopup from './link-popup';
import FootnotePopup from './footnote-popup';


function OverlayPopup(props) {
	if (props.params.type === 'internal-link') {
		return <PortalPopup {...props}/>;
	}
	else if (props.params.type === 'external-link') {
		return <LinkPopup {...props}/>;
	}
	else if (props.params.type === 'footnote') {
		return <FootnotePopup {...props}/>;
	}
}

export default OverlayPopup;
