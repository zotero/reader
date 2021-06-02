'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';
import cx from 'classnames';

function Toolbar(props) {
	const intl = useIntl();

	function getContainerNode() {
		return document.getElementById('toolbarViewerMiddle');
	}

	function handleColorPick(event) {
		props.onColorPick(event.currentTarget.id);
	}

	let { toggled, color, onMode } = props;
	let containerNode = getContainerNode();
	return ReactDOM.createPortal(
		<div className="tool-group annotation-tools">
			<button
				tabIndex={18}
				data-l10n-id="highlight_tool"
				className={cx('toolbarButton highlight', {
					toggled: toggled === 'highlight'
				})}
				title={intl.formatMessage({ id: 'pdfReader.highlightText' })}
				onClick={() => {
					onMode('highlight');
				}}>
				<span className="button-background"/>
			</button>
			<button
				tabIndex={19}
				className={cx('toolbarButton note', {
					toggled: toggled === 'note'
				})}
				title={intl.formatMessage({ id: 'pdfReader.addNote' })}
				onClick={() => {
					onMode('note');
				}}
			>
				<span className="button-background"/>
			</button>
			<button
				tabIndex={20}
				className={cx('toolbarButton area', {
					toggled: toggled === 'image'
				})}
				title={intl.formatMessage({ id: 'pdfReader.selectArea' })}
				onClick={() => {
					onMode('image');
				}}
			>
				<span className="button-background"/>
			</button>
			<button
				id="reader-toolbar-button-color-picker"
				tabIndex={21}
				className="toolbarButton global-color"
				style={{ color }}
				title={intl.formatMessage({ id: 'pdfReader.pickColor' })}
				onClick={handleColorPick}
			>
				<span className="button-background"/>
				<span className="dropmarker"/>
			</button>
		</div>,
		containerNode
	);
}

export default Toolbar;
