import React from 'react';
import cx from 'classnames';
import Editor from './editor';

function ExpandableEditor(props) {
	return (
		<div className={cx('expandable-editor', { expanded: props.expanded })}>
			<div className={cx('editor-view')}>
				<Editor{...props}/>
			</div>
		</div>
	);
}

export default ExpandableEditor;
