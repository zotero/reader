import React, { useLayoutEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import ViewPopup from '../common/view-popup';

function LinkPopup(props) {
	const intl = useIntl();
	const containerRef = useRef();

	function handleLinkClick(event) {
		event.preventDefault();
		props.onOpenLink(event.target.href);
	}

	return (
		<ViewPopup
			className="link-popup"
			rect={props.params.rect}
			uniqueRef={props.params.ref}
			padding={10}
		>
			<a href={props.params.url} onClick={handleLinkClick}>{props.params.url}</a>
		</ViewPopup>
	);
}

export default LinkPopup;
