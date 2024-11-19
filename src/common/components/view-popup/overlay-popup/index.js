import React from 'react';
import PreviewPopup from './preview-popup';
import LinkPopup from './link-popup';
import FootnotePopup from './footnote-popup';
import ReferencePopup from './reference/reference-popup';
import CitationPopup from './reference/citation-popup';
import ImagePopup from "./image-popup";


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
	else if (props.params.type === 'citation') {
		return <CitationPopup {...props}/>;
	}
	else if (props.params.type === 'reference') {
		return <ReferencePopup {...props}/>;
	}
	else if (props.params.type === 'image') {
		return <ImagePopup {...props}/>;
	}
}

export default OverlayPopup;
