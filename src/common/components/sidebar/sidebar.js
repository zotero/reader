import React, { useImperativeHandle } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';
import AnnotationsView from './annotations-view';
// import { cleanFilter, filterAnnotations } from '../../../src/lib/search';

const Sidebar = React.forwardRef((props, ref) => {
	function scrollAnnotationIntoView(id) {
		setTimeout(() => {
			let node = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
			node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
		});
	}

	function editHighlightText(id) {
		document.querySelector(`[data-sidebar-annotation-id="${id}"]`).focus();
		setTimeout(() => {
			let node = document.querySelector(`[data-sidebar-annotation-id="${id}"] .content`);
			var clickEvent = document.createEvent('MouseEvents');
			clickEvent.initEvent('dblclick', true, true);
			node.dispatchEvent(clickEvent);
			node.focus();
		}, 50);
	}

	function openPageLabelPopup(id) {
		let node = document.querySelector(`[data-sidebar-annotation-id="${id}"] .page`);
		var clickEvent = document.createEvent('MouseEvents');
		clickEvent.initEvent('dblclick', true, true);
		node.dispatchEvent(clickEvent);
		node.focus();
	}

	useImperativeHandle(ref, () => ({
		scrollAnnotationIntoView,
		editHighlightText,
		openPageLabelPopup
	}));

	return (
		<div id="sidebarContainer" className="sidebarOpen">
			<div id="toolbarSidebar">
				<div className="splitToolbarButton toggled" data-tabstop={1}>
					{props.type === 'pdf' &&
						<button
							id="viewThumbnail"
							className={cx('toolbarButton', { toggled: props.view === 'thumbnails' })}
							title="Show Thumbnails" tabIndex={-1}
							onClick={() => props.onChangeView('thumbnails')}
						>
							<span></span>
						</button>
					}
					<button
						id="viewAnnotations"
						className={cx('toolbarButton', { toggled: props.view === 'annotations' })}
						title="Show Annotations"
						tabIndex={-1}
						onClick={() => props.onChangeView('annotations')}
					>
						<span></span>
					</button>
					<button
						id="viewOutline"
						className={cx('toolbarButton', { toggled: props.view === 'outline' })}
						title="Show Document Outline (double-click to expand/collapse all items)"
						tabIndex={-1}
						onClick={() => props.onChangeView('outline')}
					>
						<span></span>
					</button>
				</div>
			</div>
			<div id="sidebarContent" className="sidebar-content">
				{props.view === 'thumbnails' && props.thumbnailsView}
				{props.view === 'annotations' && <div id="annotationsView">{props.annotationsView}</div>}
				{props.view === 'outline' && props.outlineView}
			</div>
		</div>
	);
});

export default Sidebar;
