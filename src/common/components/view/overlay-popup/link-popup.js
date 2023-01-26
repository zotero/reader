import React, { useLayoutEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import ViewPopup from '../view-popup';

function LinkPopup(props) {
	const intl = useIntl();
	const containerRef = useRef();

	return (
		<ViewPopup
			className="link-popup"
			rect={props.params.rect}
			uniqueRef={props.params.ref}
			padding={10}
		>
			<div>A popup to display a link and provide additional actions<br/>(i.e. import an article)</div>
			<a href={props.params.url}>{props.params.url}</a>
		</ViewPopup>
	);
}

export default LinkPopup;
