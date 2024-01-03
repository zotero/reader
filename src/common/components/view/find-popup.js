import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle, useLayoutEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import { debounce } from '../../lib/debounce';
import { DEBOUNCE_FIND_POPUP_INPUT } from '../../defines';

import IconChevronUp from '../../../../res/icons/20/chevron-up.svg';
import IconChevronDown from '../../../../res/icons/20/chevron-down.svg';
import IconClose from '../../../../res/icons/20/x.svg';

function FindPopup({ params, onChange, onFindNext, onFindPrevious }) {
	const inputRef = useRef();
	const [query, setQuery] = useState(params.query);

	const debounceInputChange = useCallback(debounce(value => {
		let query = inputRef.current.value;
		if (!(query.length === 1 && RegExp(/^\p{Script=Latin}/, 'u').test(query))) {
			onChange({ ...params, query, active: true, result: null });
		}
	}, DEBOUNCE_FIND_POPUP_INPUT), [onChange]);

	useLayoutEffect(() => {
		if (params.popupOpen) {
			inputRef.current?.focus();
		}
	}, [params.popupOpen]);

	useEffect(() => {
		setQuery(params.query);
	}, [params.query]);

	function handleInputChange(event) {
		let value = event.target.value;
		setQuery(value);
		debounceInputChange();
	}

	function handleInputKeyDown(event) {
		if (event.key === 'Enter') {
			if (params.active) {
				if (event.shiftKey) {
					onFindPrevious();
				}
				else {
					onFindNext();
				}
			}
			else {
				onChange({ ...params, active: true });
			}
		}
	}

	function handleCloseClick() {
		onChange({ ...params, popupOpen: false, active: false });
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
		<div className="find-popup">
			<div className="row input">
				<input
					ref={inputRef}
					type="text"
					title="Find"
					className="toolbar-text-input"
					placeholder="Find in document…"
					value={query !== null ? query : params.query}
					tabIndex="-1"
					data-tabstop={1}
					autoComplete="off"
					onChange={handleInputChange}
					onKeyDown={handleInputKeyDown}
				/>
				<div className="group" data-tabstop={1}>
					<button
						className="previous toolbar-button"
						title="Find the previous occurrence of the phrase"
						tabIndex="-1"
						disabled={params.result?.total <= 1}
						onClick={onFindPrevious}
					><IconChevronUp/></button>
					<button
						className="next toolbar-button"
						title="Find the next occurrence of the phrase"
						tabIndex="-1"
						disabled={params.result?.total <= 1}
						onClick={onFindNext}
					><IconChevronDown/></button>
					<button
						className="close toolbar-button"
						title="Close"
						tabIndex="-1"
						onClick={handleCloseClick}
					><IconClose/></button>
				</div>
			</div>
			<div className="row options" data-tabstop={1}>
				<div className="option">
					<input
						id="highlight-all"
						type="checkbox"
						tabIndex="-1"
						checked={params.highlightAll}
						onChange={handleHighlightAllChange}
					/>
					<label htmlFor="highlight-all">Highlight all</label>
				</div>
				<div className="option">
					<input
						id="case-sensitive"
						type="checkbox"
						tabIndex="-1"
						checked={params.caseSensitive}
						onChange={handleMatchCaseChange}
					/>
					<label htmlFor="case-sensitive">Match case</label>
				</div>
				<div className="option">
					<input
						id="entire-word"
						type="checkbox"
						tabIndex="-1"
						checked={params.entireWord}
						onChange={handleWholeWordsChange}
					/>
					<label htmlFor="entire-word">Whole words</label>
				</div>
			</div>
			{params.result &&
				<div className="row result">
					{
						params.result.total > 0
							? (params.result.index + 1 + ' / ' + params.result.total)
							: (<FormattedMessage id="pdfReader.phraseNotFound"/>)
					}
				</div>
			}
		</div>
	);
}

export default FindPopup;
