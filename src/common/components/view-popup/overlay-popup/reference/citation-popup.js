import React, { useLayoutEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import ViewPopup from '../../common/view-popup';
import FormattedText from './common/formated-text';

function ReferenceRow({ reference, onNavigate, onOpenLink }) {
	function handleClick() {
		let { position } = reference;
		// onNavigate({ position });
	}

	return (
		<div className="reference-row" onClick={handleClick}><FormattedText chars={reference.chars} onOpenLink={onOpenLink}/></div>
	);
}

export default function CitationPopup(props) {
	const intl = useIntl();
	const containerRef = useRef();

	return (
		<ViewPopup
			className="citation-popup"
			rect={props.params.rect}
			uniqueRef={props.params.ref}
			padding={10}
		>
			<div className="inner">
				{props.params.references.map((reference, index) => {
					return <ReferenceRow key={index} reference={reference} onNavigate={props.onNavigate} onOpenLink={props.onOpenLink}/>;
				})}
			</div>
		</ViewPopup>
	);
}
