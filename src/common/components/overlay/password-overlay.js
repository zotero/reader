import BasicOverlay from './common/basic-overlay';
import { FormattedMessage } from 'react-intl';
import React, { useRef } from 'react';

function PasswordOverlay({ params, onEnterPassword }) {
	let inputRef = useRef();
	function handleSubmit(event) {
		event.preventDefault();
		onEnterPassword(inputRef.current.value);
	}

	return (
		<BasicOverlay className="password-overlay dialog">
			<form onSubmit={handleSubmit}>
				<div className="row description"><FormattedMessage id="pdfReader.enterPassword"/></div>
				<div className="row"><input type="password" ref={inputRef}/></div>
			</form>
		</BasicOverlay>
	);
}

export default PasswordOverlay;
