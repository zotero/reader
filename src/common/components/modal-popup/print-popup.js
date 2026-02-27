import React, { Fragment, useState } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';

function PrintPopup({ params }) {
	let { l10n } = useLocalization();
	let [includeAnnotations, setIncludeAnnotations] = useState(true);

	function handleIncludeAnnotationsCheckboxChange(event) {
		setIncludeAnnotations(event.target.checked);
	}

	function handlePrint() {
		window.print(includeAnnotations);
	}

	function handleCancel() {
		window.abortPrint();
	}

	return (
		<DialogPopup className="print-popup" onSubmit={handlePrint} onClose={handleCancel}>
			{params.percent === undefined && (
				<Fragment>
					<div className="row checkbox">
						<input
							id="renumber-auto-detect"
							type="checkbox"
							tabIndex={-1}
							data-tabstop={1}
							checked={includeAnnotations}
							onChange={handleIncludeAnnotationsCheckboxChange}
						/>
						<label htmlFor="renumber-auto-detect">{l10n.getString('reader-include-annotations')}</label>
					</div>
					<div className="row buttons" data-tabstop={1}>
						<button
							tabIndex={-1}
							className="form-button"
							onClick={handleCancel}
						>{l10n.getString('general-cancel')}</button>
						<button
							tabIndex={-1}
							data-default-focus={true}
							className="form-button primary"
							onClick={handlePrint}
						>{l10n.getString('general-print')}</button>
					</div>
				</Fragment>
			)}
			{params.percent !== undefined && (
				<Fragment>
					<div className="row description">{l10n.getString('reader-preparing-document-for-printing')}</div>
					<div className="row progress">
						<progress max="100" value={params.percent}>{params.percent}%</progress>
					</div>
					<div className="row buttons" data-tabstop={1}>
						<button
							tabIndex={-1}
							className="form-button"
							onClick={handleCancel}
						>{l10n.getString('general-cancel')}</button>
					</div>
				</Fragment>
			)}
		</DialogPopup>
	);
}

export default PrintPopup;
