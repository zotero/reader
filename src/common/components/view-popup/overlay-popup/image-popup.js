import React, { useState } from 'react';
import { useLocalization } from '@fluent/react';
import cx from 'classnames';

function ImagePopup({ params, onClose }) {
	let { l10n } = useLocalization();
	let [show, setShow] = useState(false);

	let { src, title, alt, rect } = params;

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
			aria-label={l10n.getString('reader-zoom-out')}
			style={{ '--rect-left': rect[0] + 'px', '--rect-top': rect[1] + 'px', '--rect-right': rect[2] + 'px', '--rect-bottom': rect[3] + 'px' }}
			onClick={handleClose}
		>
			<img src={src} title={title} alt={alt} onLoad={handleLoad} onTransitionEnd={handleTransitionEnd} />
		</div>
	);
}

export default ImagePopup;
