import BasicOverlay from './common/basic-overlay';
import { FormattedMessage } from 'react-intl';
import React, { Fragment, useRef, useState } from 'react';

function PrintOverlay({ params }) {
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
		<BasicOverlay className="print-overlay dialog">
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
						<label htmlFor="renumber-auto-detect"><FormattedMessage id="pdfReader.includeAnnotations"/></label>
					</div>
					<div className="row buttons" data-tabstop={1}>
						<button
							tabIndex={-1}
							className=""
							onClick={handleCancel}
						><FormattedMessage id="general.cancel"/></button>
						<button
							tabIndex={-1}
							data-default-focus={true}
							className="primary"
							onClick={handlePrint}
						><FormattedMessage id="general.print"/></button>
					</div>
				</Fragment>
			)}
			{params.percent !== undefined && (
				<Fragment>
					<div className="row description"><FormattedMessage id="pdfReader.preparingDocumentForPrinting"/>
					</div>
					<div className="row progress">
						<progress max="100" value={params.percent}>{params.percent}%</progress>
					</div>
					<div className="row buttons" data-tabstop={1}>
						<button
							tabIndex={-1}
							className="overlayButton"
							onClick={handleCancel}
						><FormattedMessage id="general.cancel"/></button>
					</div>
				</Fragment>
			)}
		</BasicOverlay>
	);
}

export default PrintOverlay;
