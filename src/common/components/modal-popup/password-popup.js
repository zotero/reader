import DialogPopup from './common/dialog-popup';
import { FormattedMessage } from 'react-intl';
import React, { useRef } from 'react';

function PasswordPopup({ params, onEnterPassword }) {
	let inputRef = useRef();
	function handleSubmit(event) {
		event.preventDefault();
		onEnterPassword(inputRef.current.value);
	}

	return (
		<DialogPopup className="password-popup">
			<form onSubmit={handleSubmit}>
				<div className="row description"><FormattedMessage id="pdfReader.enterPassword"/></div>
				<div className="row"><input type="password" ref={inputRef}/></div>
			</form>
		</DialogPopup>
	);
}

export default PasswordPopup;
