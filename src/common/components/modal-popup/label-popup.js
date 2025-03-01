
import React, { useState, useEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import TooltipPopup from './common/tooltip-popup';


function getData(params) {
	let annotations = [];

	let annotation = params.currentAnnotation;
	if (!annotation) {
		return;
	}

	let selectedAnnotations = params.selectedAnnotations.filter(x => !x.readOnly);
	if (selectedAnnotations.length && selectedAnnotations.includes(params.currentAnnotation)) {
		annotations = selectedAnnotations;
	}
	else {
		annotations = [params.currentAnnotation];
	}

	annotations.sort((a, b) => a.position.pageIndex - b.position.pageIndex);

	let single = annotations.length === 1;
	let selected = annotations.length > 1;

	let currentPageAnnotations = params.allAnnotations.filter(x => x.position.pageIndex === annotations[0].position.pageIndex);
	let fromCurrentPageAnnotations = params.allAnnotations.filter(x => x.position.pageIndex >= annotations[0].position.pageIndex);

	let page = currentPageAnnotations.some(x => !annotations.includes(x));
	let from = fromCurrentPageAnnotations.some(x => !annotations.includes(x));
	let all = params.allAnnotations.length !== currentPageAnnotations.length && params.allAnnotations.length !== fromCurrentPageAnnotations.length;

	let checked;

	if (from) {
		checked = 'from';
	}
	else if (all) {
		checked = 'all';
	}
	else if (page) {
		checked = 'page';
	}
	else if (selected) {
		checked = 'selected';
	}
	else {
		checked = 'single';
	}

	let { pageIndex } = annotation.position;
	let autoPageLabel = params.pageLabels.length && params.pageLabels[pageIndex] || (pageIndex + 1).toString();

	return {
		checked,
		pageLabel: annotation.pageLabel,
		autoPageLabel,
		single,
		selected,
		page,
		from,
		all
	};
}

function LabelPopup({ params, onUpdateAnnotations, onClose }) {
	let data = getData(params);
	let [label, setLabel] = useState(data.pageLabel);
	let [checked, setChecked] = useState(data.checked);
	let [auto, setAuto] = useState(false);
	let inputRef = useRef();
	const intl = useIntl();

	useEffect(() => {
		inputRef.current.focus();
		inputRef.current.select();
	}, []);

	function handleUpdateClick() {
		if (auto) {
			updateAnnotations('auto');
		}
		else {
			updateAnnotations(checked, label.trim());
		}
	}

	function handleInputKeydown(event) {
		if (event.key === 'Enter') {
			handleUpdateClick();
		}
	}

	function handleChange(event) {
		setLabel(event.target.value);
	}

	function handleCheckboxChange(event) {
		setAuto(event.target.checked);
	}

	function handleRadioChange(event) {
		setChecked(event.target.value);
	}
	function updateAnnotations(type, pageLabel) {
		let annotationsToUpdate = [];
		if (type === 'auto') {
			// TODO: Don't reset page labels if they can't be reliably extracted from text
			onClose();
			let annotations = params.allAnnotations.filter(x => !x.readOnly);
			for (let annotation of annotations) {
				let { pageIndex } = annotation.position;
				annotationsToUpdate.push({
					id: annotation.id,
					pageLabel: params.pageLabels[pageIndex] || (pageIndex + 1).toString()
				});
			}
			onUpdateAnnotations(annotationsToUpdate);
			return;
		}

		if (!pageLabel) {
			return;
		}

		let annotation = params.currentAnnotation;
		if (!annotation) {
			return;
		}
		annotation = { ...annotation };
		let pageIndex = annotation.position.pageIndex;

		let isNumeric = parseInt(pageLabel) == pageLabel;

		if (type === 'page') {
			let annotations = params.allAnnotations.filter(x => !x.readOnly);
			annotationsToUpdate = annotations.filter(x => x.position.pageIndex === pageIndex).map(({ id }) => ({ id }));
			annotationsToUpdate.forEach(x => x.pageLabel = pageLabel);
		}
		else if (type === 'selected' && !isNumeric) {
			annotationsToUpdate = params.selectedAnnotations.filter(x => !x.readOnly).map(({ id }) => ({ id }));
			annotationsToUpdate.forEach(x => x.pageLabel = pageLabel);
		}
		else if (type === 'single' || !isNumeric && type !== 'selected') {
			if (!annotation.readOnly) {
				annotationsToUpdate = [{ id: annotation.id, pageLabel }];
			}
		}
		else {
			let annotations = params.allAnnotations.filter(x => !x.readOnly);
			switch (type) {
				case 'selected':
					annotationsToUpdate = annotations.filter(x => params.selectedAnnotations.includes(x));
					break;
				case 'page':
					annotationsToUpdate = annotations.filter(x => x.position.pageIndex === pageIndex);
					break;
				case 'from':
					annotationsToUpdate = annotations.filter(x => x.position.pageIndex >= pageIndex);
					break;
				case 'all':
					annotationsToUpdate = annotations;
					break;
			}

			pageLabel = parseInt(pageLabel);

			annotationsToUpdate = annotationsToUpdate.map(x => ({ ...x }));
			for (let annotation of annotationsToUpdate) {
				let newPageLabel = pageLabel + (annotation.position.pageIndex - pageIndex);
				if (newPageLabel < 1) {
					continue;
				}
				annotation.pageLabel = newPageLabel.toString();
			}
			annotationsToUpdate = annotationsToUpdate.map(({ id, pageLabel }) => ({ id, pageLabel }));
		}

		onClose();

		onUpdateAnnotations(annotationsToUpdate);
	}


	let forceSingle = false;
	if (parseInt(label) != label || parseInt(label) < 1) {
		forceSingle = true;
		if (data.page && !['single', 'selected'].includes(checked)) {
			checked = 'page';
		}
		else if (data.single) {
			checked = 'single';
		}
		else {
			checked = 'selected';
		}
	}

	let disabled = !label.trim().length;

	if (auto) {
		if (data.all) {
			checked = 'all';
		}
		else if (data.from) {
			checked = 'from';
		}
		else if (data.page) {
			checked = 'page';
		}
		else if (data.selected) {
			checked = 'selected';
		}
		else if (data.single) {
			checked = 'single';
		}
	}

	return (
		<TooltipPopup className="label-popup" rect={params.rect} onClose={onClose}>
			<div className="row label">
				<div className="column first">
					<input
						ref={inputRef}
						type="text"
						tabIndex={-1}
						data-tabstop={1}
						className="toolbarField"
						value={auto ? data.autoPageLabel : label}
						disabled={auto}
						maxLength={32}
						onChange={handleChange}
						onKeyDown={handleInputKeydown}
						aria-label={intl.formatMessage({ id: "pdfReader.editPageNumber"})}
					/>
				</div>
				<div className="column second">
					<input
						id="renumber-auto-detect"
						type="checkbox"
						data-tabstop={1}
						tabIndex={-1}
						checked={auto}
						onChange={handleCheckboxChange}
					/>
					<label htmlFor="renumber-auto-detect"><FormattedMessage id="pdfReader.autoDetect"/></label>
				</div>
			</div>
			<fieldset className="radio row" data-tabstop={1}>
				<legend><FormattedMessage id="pdfReader.pageNumberPopupHeader"/></legend>
				{data.single && <div className="choice">
					<input
						type="radio"
						tabIndex={-1}
						id="renumber-selected"
						name="renumber"
						value="single"
						checked={checked === 'single' && !disabled}
						disabled={disabled || auto}
						onChange={handleRadioChange}
					/>
					<label htmlFor="renumber-selected"><FormattedMessage id="pdfReader.thisAnnotation"/></label>
				</div>}
				{data.selected && <div className="choice">
					<input
						type="radio"
						tabIndex={-1}
						id="renumber-selected"
						name="renumber"
						value="selected"
						checked={checked === 'selected' && !disabled}
						disabled={disabled || auto}
						onChange={handleRadioChange}
					/>
					<label htmlFor="renumber-selected"><FormattedMessage
						id="pdfReader.selectedAnnotations"/></label>
				</div>}
				{data.page && <div className="choice">
					<input
						type="radio"
						tabIndex={-1}
						id="renumber-page"
						name="renumber"
						value="page"
						checked={checked === 'page'}
						disabled={disabled || auto}
						onChange={handleRadioChange}
					/>
					<label htmlFor="renumber-page"><FormattedMessage id="pdfReader.thisPage"/></label>
				</div>}
				{data.from && <div className="choice">
					<input
						type="radio"
						tabIndex={-1}
						id="renumber-from-page"
						name="renumber"
						value="from"
						checked={checked === 'from'}
						disabled={forceSingle || disabled || auto}
						onChange={handleRadioChange}
					/>
					<label htmlFor="renumber-from-page"><FormattedMessage
						id="pdfReader.thisPageAndLaterPages"/></label>
				</div>}
				{(data.all) && <div className="choice">
					<input
						type="radio"
						tabIndex={-1}
						id="renumber-all"
						name="renumber"
						value="all"
						checked={checked === 'all'}
						disabled={forceSingle || disabled || auto}
						onChange={handleRadioChange}
					/>
					<label htmlFor="renumber-all"><FormattedMessage id="pdfReader.allPages"/></label>
				</div>}
			</fieldset>
			<div className="row buttons">
				<button
					tabIndex={-1}
					data-tabstop={1}
					className="form-button primary"
					disabled={disabled}
					onClick={handleUpdateClick}
				><FormattedMessage id="general.update"/></button>
			</div>
		</TooltipPopup>
	);
}

export default LabelPopup;


