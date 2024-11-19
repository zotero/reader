import React from 'react';
import { useIntl } from "react-intl";

function ImagePopup({ params, onClose }) {
	let { src, title, alt } = params;

	const intl = useIntl();

	return (
		<div className="image-popup" role="button" aria-label={intl.formatMessage({ id: 'pdfReader.zoomOut' })} onClick={onClose}>
			<img src={src} title={title} alt={alt} />
		</div>
	);
}

export default ImagePopup;
