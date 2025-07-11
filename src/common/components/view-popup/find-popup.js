import React, { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import cx from 'classnames';
import { debounce } from '../../lib/debounce';
import { DEBOUNCE_FIND_POPUP_INPUT } from '../../defines';

import IconChevronUp from '../../../../res/icons/20/chevron-up.svg';
import IconChevronDown from '../../../../res/icons/20/chevron-down.svg';
import IconClose from '../../../../res/icons/20/x.svg';
import { getCodeCombination, getKeyCombination } from '../../lib/utilities';

function FindPopup({ params, onChange, onFindNext, onFindPrevious, onAddAnnotation, tools }) {
	const { l10n } = useLocalization();
	const inputRef = useRef();
	const preventInputRef = useRef(false);
	const [query, setQuery] = useState(params.query);
	const currentParamsRef = useRef();

	currentParamsRef.current = params;

	const debounceInputChange = useCallback(debounce(value => {
		if (!inputRef.current) {
			return;
		}
		let query = inputRef.current.value;
		if (query !== currentParamsRef.current.query && !(query.length === 1 && RegExp(/^\p{Script=Latin}/, 'u').test(query))) {
			onChange({ ...currentParamsRef.current, query, active: true, result: null });
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
		if (!value.trim()) {
			onChange({ ...currentParamsRef.current, query: '', result: null });
			return;
		}
		if (preventInputRef.current) {
			preventInputRef.current = false;
			return;
		}
		debounceInputChange();
	}

	function handleInputKeyDown(event) {
		let key = getKeyCombination(event);
		let code = getCodeCombination(event);
		if (key === 'Enter') {
			if (params.active) {
				onFindNext();
			}
			else {
				onChange({ ...params, active: true });
			}
		}
		else if (key === 'Shift-Enter') {
			if (params.active) {
				onFindPrevious();
			}
			else {
				onChange({ ...params, active: true });
			}
		}
		else if (key === 'Escape') {
			onChange({ ...params, popupOpen: false, active: false, result: null });
			event.preventDefault();
			event.stopPropagation();
		}
		else if (code === 'Ctrl-Alt-Digit1') {
			preventInputRef.current = true;
			if (params.result?.annotation) {
				onAddAnnotation({ ...params.result.annotation, type: 'highlight', color: tools['highlight'].color }, true);
				// Close popup after adding annotation
				onChange({ ...params, popupOpen: false, active: false, result: null });
			}
		}
		else if (code === 'Ctrl-Alt-Digit2') {
			preventInputRef.current = true;
			if (params.result?.annotation) {
				onAddAnnotation({ ...params.result.annotation, type: 'underline', color: tools['underline'].color }, true);
				// Close popup after adding annotation
				onChange({ ...params, popupOpen: false, active: false, result: null });
			}
		}
	}

	function handleCloseClick() {
		onChange({ ...params, popupOpen: false, active: false, result: null });
	}

	function handleHighlightAllChange(event) {
		onChange({ ...params, highlightAll: event.currentTarget.checked, result: null });
	}

	function handleMatchCaseChange(event) {
		onChange({ ...params, caseSensitive: event.currentTarget.checked, result: null });
	}

	function handleWholeWordsChange(event) {
		onChange({ ...params, entireWord: event.currentTarget.checked, result: null });
	}

	return (
		<div className="find-popup" role="application">
			<div className="row input">
				<div className={cx('input-box', { loading: !params.result && params.active && params.query })}>
					<Localized id="reader-find-in-document-input" attrs={{ title: true, placeholder: true, 'aria-description': true }}>
						<input
							ref={inputRef}
							type="text"
							className="toolbar-text-input"
							value={query !== null ? query : params.query}
							tabIndex="-1"
							data-tabstop={1}
							autoComplete="off"
							onChange={handleInputChange}
							onKeyDown={handleInputKeyDown}
						/>
					</Localized>
					<div className="spinner-container">
						<div className="spinner"></div>
					</div>
				</div>
				<div className="group" data-tabstop={1}>
					<button
						className="previous toolbar-button"
						title={l10n.getString('reader-find-previous')}
						tabIndex="-1"
						disabled={!params.active || params.result?.total <= 1}
						onClick={onFindPrevious}
					><IconChevronUp/></button>
					<button
						className="next toolbar-button"
						title={l10n.getString('reader-find-next')}
						tabIndex="-1"
						disabled={!params.active || params.result?.total <= 1}
						onClick={onFindNext}
					><IconChevronDown/></button>
					<button
						className="close toolbar-button"
						title={l10n.getString('reader-close')}
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
					<label htmlFor="highlight-all">{l10n.getString('reader-highlight-all')}</label>
				</div>
				<div className="option">
					<input
						id="case-sensitive"
						type="checkbox"
						tabIndex="-1"
						checked={params.caseSensitive}
						onChange={handleMatchCaseChange}
					/>
					<label htmlFor="case-sensitive">{l10n.getString('reader-match-case')}</label>
				</div>
				<div className="option">
					<input
						id="entire-word"
						type="checkbox"
						tabIndex="-1"
						checked={params.entireWord}
						onChange={handleWholeWordsChange}
					/>
					<label htmlFor="entire-word">{l10n.getString('reader-whole-words')}</label>
				</div>
			</div>
			{params.result &&
				<div className="row result">
					{
						params.result.total > 0
							? (params.result.index + 1 + ' / ' + params.result.total)
							: l10n.getString('reader-phrase-not-found')
					}
				</div>
			}
		</div>
	);
}

export default FindPopup;
