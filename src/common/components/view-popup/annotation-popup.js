import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import { ANNOTATION_COLORS } from '../../defines';
import { FormattedMessage } from 'react-intl';
import ViewPopup from './common/view-popup';
import { PopupPreview } from '../common/preview';

function AnnotationPopup(props) {
	let { annotation } = props;
	return (
		<ViewPopup
			className="annotation-popup"
			rect={props.params.rect}
			uniqueRef={props.params.annotation.id}
			padding={20}
		>
			<PopupPreview
				type={props.type}
				readOnly={(props.readOnly || annotation.readOnly)}
				annotation={annotation}
				isExpandable={false}
				enableText={false}
				enableImage={false}
				enableComment={!(props.readOnly || annotation.readOnly) || annotation.comment}
				enableTags={!(props.readOnly || annotation.readOnly) || annotation.tags.length > 0}
				onUpdate={(comment) => {
					props.onChange({ id: popupAnnotation.id, comment });
				}}
				onColorChange={(color) => {
					props.onChange({ id: popupAnnotation.id, color });
				}}
				onOpenTagsPopup={props.onOpenTagsPopup}
				onChange={props.onChange}
				onOpenPageLabelPopup={props.onOpenPageLabelPopup}
				onOpenContextMenu={props.onOpenAnnotationContextMenu}
				onDragStart={(event) => {
					props.onSetDataTransferAnnotations(event.dataTransfer, [popupAnnotation]);
				}}
			/>
		</ViewPopup>
	);
}

export default AnnotationPopup;
