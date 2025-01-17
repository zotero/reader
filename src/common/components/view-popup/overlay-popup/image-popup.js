import React, { useState } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';

function ImagePopup({ params, onClose }) {
	let { src, title, alt, rect } = params;

	const intl = useIntl();
	let [show, setShow] = useState(false);

	function handleLoad() {
		setShow(true);
	}

	function handleClose() {
		setShow(false);
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			onClose();
		}
	}

	function handleTransitionEnd() {
		if (!show) {
			onClose();
		}
	}

	return (
		<div
			className={cx('image-popup', { show })}
			role="button"
			aria-label={intl.formatMessage({ id: 'pdfReader.zoomOut' })}
			style={{ '--rect-left': rect[0] + 'px', '--rect-top': rect[1] + 'px', '--rect-right': rect[2] + 'px', '--rect-bottom': rect[3] + 'px' }}
			onClick={handleClose}
		>
			<img src={src} title={title} alt={alt} onLoad={handleLoad} onTransitionEnd={handleTransitionEnd} />
		</div>
	);
}

export default ImagePopup;
