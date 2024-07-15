import React from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import cx from 'classnames';
import { ANNOTATION_COLORS } from '../../defines';
import ViewPopup from './common/view-popup';
import CustomSections from '../common/custom-sections';

import { IconColor16 } from '../common/icons';

import IconHighlight from '../../../../res/icons/16/annotate-highlight.svg';
import IconUnderline from '../../../../res/icons/16/annotate-underline.svg';

function SelectionPopup(props) {
	const intl = useIntl();

	function handleColorPick(color) {
		let type = props.textSelectionAnnotationMode;
		props.onAddAnnotation({ ...props.params.annotation, type, color });
	}

	function handleAddToNote() {
		props.onAddToNote([props.params.annotation]);
	}

	return (
		<ViewPopup
			className="selection-popup"
			rect={props.params.rect}
			uniqueRef={{}}
			padding={20}
		>
			<div className="colors" data-tabstop={1}>
				{ANNOTATION_COLORS.map((color, index) => (<button
					key={index}
					tabIndex={-1}
					className="toolbar-button color-button"
					title={intl.formatMessage({ id: color[0] })}
					onClick={() => handleColorPick(color[1])}
				><IconColor16 color={color[1]}/></button>))}
			</div>
			<div className="tool-toggle">
				<button
					className={cx('highlight', { active: props.textSelectionAnnotationMode === 'highlight' })}
					onClick={() => props.onChangeTextSelectionAnnotationMode('highlight')}
				><IconHighlight/></button>
				<button
					className={cx('underline', { active: props.textSelectionAnnotationMode === 'underline' })}
					onClick={() => props.onChangeTextSelectionAnnotationMode('underline')}
				><IconUnderline/></button>
			</div>
			{props.enableAddToNote &&
				<button className="toolbar-button wide-button" data-tabstop={1} onClick={handleAddToNote}>
					<FormattedMessage id="pdfReader.addToNote"/>
				</button>}
			<CustomSections type="TextSelectionPopup" annotation={props.params.annotation}/>
		</ViewPopup>
	);
}

export default SelectionPopup;
