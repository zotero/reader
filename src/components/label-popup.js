'use strict';

import React, { useState, useEffect, useRef } from 'react';
import Overlay from './overlay';
import { FormattedMessage } from 'react-intl';

function LabelPopup({ data, onUpdate, onClose }) {
	let [label, setLabel] = useState(data.label);
	let [checked, setChecked] = useState(data.checked);
	let overlayRef = useRef();
	let inputRef = useRef();

	useEffect(() => {
		inputRef.current.focus();
		inputRef.current.select();
	}, []);

	function handleUpdateClick() {
		onUpdate(checked, label.trim());
	}

	function handleInputKeydown(event) {
		if (event.key === 'Enter') {
			handleUpdateClick();
		}
	}

	function handleChange(event) {
		setLabel(event.target.value);
	}

	function handleRadioChange(event) {
		setChecked(event.target.value);
	}

	let forceSingle = false;
	if (parseInt(label) != label || parseInt(label) < 1) {
		forceSingle = true;
		if (data.single) {
			checked = 'single';
		}
		else {
			checked = 'selected';
		}
	}

	let disabled = !label.trim().length;

	return (
		<Overlay id="labelOverlay">
			<div className="dialog" ref={overlayRef}>
				<div className="row">
					<input
						ref={inputRef}
						type="text"
						className="toolbarField"
						value={label}
						maxLength={16}
						onChange={handleChange}
						onKeyDown={handleInputKeydown}/>
				</div>
				<div className="row radio">
					{data.single && <div className="choice">
						<input
							type="radio"
							id="renumber-selected"
							name="renumber"
							value="single"
							checked={checked === 'single' && !disabled}
							onChange={handleRadioChange} disabled={disabled}
						/>
						<label htmlFor="renumber-selected"><FormattedMessage id="pdfReader.thisAnnotation"/></label>
					</div>}
					{data.selected && <div className="choice">
						<input
							type="radio"
							id="renumber-selected"
							name="renumber"
							value="selected"
							checked={checked === 'selected' && !disabled}
							disabled={disabled} onChange={handleRadioChange}
						/>
						<label htmlFor="renumber-selected"><FormattedMessage id="pdfReader.selectedAnnotations"/></label>
					</div>}
					{data.page && <div className="choice">
						<input
							type="radio"
							id="renumber-page"
							name="renumber"
							value="page"
							checked={checked === 'page'}
							disabled={forceSingle || disabled}
							onChange={handleRadioChange}
						/>
						<label htmlFor="renumber-page"><FormattedMessage id="pdfReader.thisPage"/></label>
					</div>}
					{data.from && <div className="choice">
						<input
							type="radio"
							id="renumber-from-page"
							name="renumber"
							value="from"
							checked={checked === 'from'}
							disabled={forceSingle || disabled}
							onChange={handleRadioChange}
						/>
						<label htmlFor="renumber-from-page"><FormattedMessage id="pdfReader.thisPageAndLaterPages"/></label>
					</div>}
					{data.all && <div className="choice">
						<input
							type="radio"
							id="renumber-all"
							name="renumber"
							value="all"
							checked={checked === 'all'}
							disabled={forceSingle || disabled}
							onChange={handleRadioChange}
						/>
						<label htmlFor="renumber-all"><FormattedMessage id="pdfReader.allPages"/></label>
					</div>}
				</div>
				<div className="buttonRow">
					<button
						className="overlayButton cancel"
						onClick={onClose}
					><FormattedMessage id="general.cancel"/></button>
					<button
						className="overlayButton submit"
						onClick={handleUpdateClick}
						disabled={disabled}
					><FormattedMessage id="general.update"/></button>
				</div>
			</div>
		</Overlay>
	);
}

export default LabelPopup;