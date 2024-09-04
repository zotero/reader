import { useIntl } from 'react-intl';
import React, { useState, useRef, useEffect } from 'react';
import cx from 'classnames';
import IconMagnifier16 from '../../../../res/icons/16/magnifier-2.svg';
import IconMagnifier20 from '../../../../res/icons/20/magnifier.svg';
import IconSearchCancel from '../../../../res/icons/14/searchfield-cancel.svg';

function SearchBox({ query, placeholder, onInput }) {
	const intl = useIntl();
	const [expanded, setExpanded] = useState(!!query.length);
	const inputRef = useRef(null);
	const inputRef2 = useRef(null);

	function handleInput(event) {
		onInput(event.target.value);
	}

	function handleClear(event) {
		onInput('');
		event.preventDefault();
	}

	function handleKeyDown(event) {
		if (event.key === 'Escape') {
			if (event.target.value) {
				handleClear(event);
				event.stopPropagation();
			}
		}
	}

	function handleFocus() {
		setExpanded(true);
	}

	function handleBlur() {
		if (!inputRef.current.value.length) {
			setExpanded(false);
		}
	}

	function handleMagnifierClick() {
		// If reader window isn't focused, then focusing search input
		// doesn't trigger the focus event for this input.
		// This is partially caused by .preventDefault() in focus manager
		// which is necessary to keep the reader view focused while pressing
		// buttons in the UI, but it seems the downside of this is that reader
		// window can't be focused as well (when the focus was in items list,
		// note editor, context pane, etc.)
		// The problem only exists on Windows and Linux, not macOS
		window.focus();
		inputRef.current.focus();
	}

	function handleClearButton(event) {
		handleClear(event);
		// Make sure focus remain on the input - it can get lost if the button is clicked
		// via screen readers' cursor
		inputRef.current.focus();
	}

	return (
		<div ref={inputRef2} className={`search-box ${expanded ? 'expanded' : ''}`}>
			<div className="btn magnifier" onClick={handleMagnifierClick} aria-hidden="true">{expanded ? <IconMagnifier16/> : <IconMagnifier20/>}</div>
			<input
				ref={inputRef}
				id="searchInput"
				type="text"
				placeholder={placeholder}
				value={query}
				autoComplete="off"
				data-tabstop={1}
				onChange={handleInput}
				onKeyDown={handleKeyDown}
				onFocus={handleFocus}
				onBlur={handleBlur}
			/>
			{query.length !== 0 && <div className="btn clear" role="button" aria-label={intl.formatMessage({ id: 'general.clear' })} onClick={handleClearButton}><IconSearchCancel/></div>}
		</div>
	);
}

export default SearchBox;
