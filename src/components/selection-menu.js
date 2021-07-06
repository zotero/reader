'use strict';

import React from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { annotationColors } from '../lib/colors';

function SelectionMenu(props) {
	const intl = useIntl();

	function handleColorPick(color) {
		props.onHighlight(color);
	}

	return (
		<div className="selection-menu">
			<div className="colors">
				{annotationColors.map((color, index) => (<button
					key={index}
					className="toolbarButton global-color"
					style={{ color: color[1] }}
					title={intl.formatMessage({ id: color[0] })}
					onClick={() => handleColorPick(color[1])}
				/>))}
			</div>
			{props.enableAddToNote &&
			<div className="wide-button" onClick={props.onAddToNote}>
				<FormattedMessage id="pdfReader.addToNote"/>
			</div>}
		</div>
	);
}

export default SelectionMenu;
