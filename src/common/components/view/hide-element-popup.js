import React from 'react';

function HideElementPopup(props) {
	let { params, onClose, onCommit } = props;
	let text;

	if (params.selectedElement && params.clicked) {
		let selectedElementTag = '<' + params.selectedElement.tagName.toLowerCase() + '>';
		text = `Selected ${selectedElementTag} element.`;
	}
	else {
		text = 'Click an element on the page to hide it.';
	}

	return (
		<div className="hide-element-popup">
			<div className="hide-element-status">{text}</div>
			<div className="hide-element-buttons">
				<button
					className="toolbarButton"
					onClick={() => onClose(null)}
				>
					Cancel
				</button>
				<button
					className="toolbarButton"
					onClick={() => onCommit(params.selectedElement)}
					hidden={!params.selectedElement || !params.clicked}
				>
					Hide
				</button>
			</div>
		</div>
	);
}

export default HideElementPopup;
