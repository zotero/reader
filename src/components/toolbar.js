'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames'

class Toolbar extends React.Component {
	getContainerNode() {
		return document.getElementById('toolbarViewerMiddle');
	}

	handleColorPick = (event) => {
		this.props.onColorPick(event.screenX, event.screenY)
	}

	render() {
		let { toggled, color, onColorClick, onMode } = this.props;
		let containerNode = this.getContainerNode();
		return ReactDOM.createPortal(
			<div className="tool-group annotation-tools">
				<button
					data-l10n-id='highlight_tool'
					className={cx('toolbarButton highlight', {
						toggled: toggled === 'highlight'
					})}
					title="Highlight Text"
					onClick={() => {
						onMode('highlight');
					}}>
					<span data-l10n-id="highlight_tool_label">Highlight</span>
				</button>
				<button
					data-l10n-id='note_tool'
					className={cx('toolbarButton note', {
						toggled: toggled === 'note'
					})}
					title="Add Note"
					onClick={() => {
						onMode('note');
					}}>
					<span data-l10n-id="note_tool_label">Note</span>
				</button>
				<button
					data-l10n-id='area_tool'
					className={cx('toolbarButton area', {
						toggled: toggled === 'image'
					})}
					title="Select Area"
					onClick={() => {
						onMode('image');
					}}>
					<span data-l10n-id="area_tool_label">Area</span>
				</button>
				<button
					data-l10n-id='global_color'
					className="toolbarButton global-color"
					style={{ color }}
					title="Pick a Color"
					onClick={this.handleColorPick}
				>
					<span data-l10n-id="global_color_label">Global Color</span>
					<span className="dropmarker"></span>
				</button>
			</div>,
			containerNode
		);
	}
}

export default Toolbar;
