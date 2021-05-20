'use strict';

import React from 'react';
import { FormattedMessage } from 'react-intl';
import { annotationColors } from '../lib/colors';

class SelectionMenu extends React.Component {
	handleColorPick = (color) => {
		this.props.onHighlight(color);
	}

	handleAddToNote = (event) => {

	}

	render() {
		return (
			<div className="selection-menu">
				<div className="colors">
					{annotationColors.map((color, index) => (<button
						key={index}
						className="toolbarButton global-color"
						style={{ color: color[1] }}
						onClick={() => this.handleColorPick(color[1])}
					/>))}
				</div>
				{this.props.enableAddToNote &&
				<div className="wide-button" onClick={this.props.onAddToNote}>
					<FormattedMessage id="pdfReader.addToNote"/>
				</div>}
			</div>
		);
	}
}

export default SelectionMenu;
