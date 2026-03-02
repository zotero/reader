import React, { useRef } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';

function PasswordPopup({ params, onEnterPassword }) {
	let { l10n } = useLocalization();
	let inputRef = useRef();
	function handleSubmit(event) {
		event.preventDefault();
		onEnterPassword(inputRef.current.value);
	}

	return (
		<DialogPopup className="password-popup" onSubmit={handleSubmit}>
			<form onSubmit={handleSubmit}>
				<div className="row description">{l10n.getString('reader-enter-password')}</div>
				<div className="row"><input type="password" ref={inputRef}/></div>
			</form>
		</DialogPopup>
	);
}

export default PasswordPopup;
