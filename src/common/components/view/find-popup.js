import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle, useLayoutEffect } from 'react';

function FindPopup({ params, onChange, onFindNext, onFindPrevious }) {
	const inputRef = useRef();

	useLayoutEffect(() => {
		if (params.open) {
			inputRef.current?.focus();
		}
	}, [params.open]);

	function handleInputBlur(event) {
		if (!event.target.value) {
			onChange({ ...params, open: false });
		}
	}

	function handleInputChange(event) {
		onChange({ ...params, query: event.target.value });
	}

	function handleInputKeyDown(event) {
		if (event.key === 'Enter') {
			if (event.shiftKey) {
				onFindPrevious();
			}
			else {
				onFindNext();
			}
		}
	}

	function handleCloseClick() {
		onChange({ ...params, open: false });
	}

	function handleHighlightAllChange(event) {
		onChange({ ...params, highlightAll: event.currentTarget.checked });
	}

	function handleMatchCaseChange(event) {
		onChange({ ...params, caseSensitive: event.currentTarget.checked });
	}

	function handleWholeWordsChange(event) {
		onChange({ ...params, entireWord: event.currentTarget.checked });
	}

	return (
		<div className="find-popup findbar" id="findbar">
			<div id="findbarInputContainer">
				<input
					ref={inputRef}
					type="text"
					id="findInput"
					className="toolbarField"
					title="Find"
					placeholder="Find in document…"
					value={params.query}
					tabIndex="-1"
					data-tabstop={1}
					autoComplete="off"
					onBlur={handleInputBlur}
					onChange={handleInputChange}
					onKeyDown={handleInputKeyDown}
				/>
				<div className="splitToolbarButton" data-tabstop={1}>
					<button
						id="findPrevious"
						className="toolbarButton findPrevious"
						title="Find the previous occurrence of the phrase"
						tabIndex="-1"
						onClick={onFindPrevious}
					/>
					<div className="splitToolbarButtonSeparator"></div>
					<button
						id="findNext"
						className="toolbarButton findNext"
						title="Find the next occurrence of the phrase"
						tabIndex="-1"
						onClick={onFindNext}
					/>
				</div>
			</div>

			<div id="findOptions" data-tabstop={1}>
				<input type="checkbox" id="findHighlightAll" className="toolbarField" tabIndex="-1" checked={params.highlightAll} onChange={handleHighlightAllChange}/>
				<label htmlFor="findHighlightAll" className="toolbarLabel" data-l10n-id="find_highlight">Highlight all</label>
				<input type="checkbox" id="findMatchCase" className="toolbarField" tabIndex="-1" checked={params.caseSensitive} onChange={handleMatchCaseChange}/>
				<label htmlFor="findMatchCase" className="toolbarLabel" data-l10n-id="find_match_case_label">Match case</label>
				<input type="checkbox" id="findEntireWord" className="toolbarField" tabIndex="-1" checked={params.entireWord} onChange={handleWholeWordsChange}/>
				<label htmlFor="findEntireWord" className="toolbarLabel">Whole words</label>
			</div>
			<div id="findbarMessageContainer">
				<span id="findResultsCount" className="toolbarLabel">{params.resultsCount}</span>
				<span id="findMsg" className="toolbarLabel"></span>
			</div>
			<div id="findbarCloseContainer">
				<button className="findClose" onClick={handleCloseClick}/>
			</div>
		</div>
	);
}

export default FindPopup;
