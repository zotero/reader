import React, { useImperativeHandle } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';
import AnnotationsView from './annotations-view';
// import { cleanFilter, filterAnnotations } from '../../../src/lib/search';
import { useIntl } from 'react-intl';


import IconThumbnails from '../../../../res/icons/20/thumbnail.svg';
import IconAnnotations from '../../../../res/icons/20/annotation.svg';
import IconOutline from '../../../../res/icons/20/outline.svg';
import SearchBox from './search-box';

function Sidebar(props) {
	const intl = useIntl();

	function handleSearchInput(query) {
		props.onChangeFilter({ ...props.filter, query });
	}

	return (
		<div id="sidebarContainer" className="sidebarOpen">
			<div className="sidebar-toolbar">
				<div className="start" data-tabstop={1} role="tablist">
					{props.type === 'pdf' &&
						<button
							id="viewThumbnail"
							className={cx('toolbar-button', { active: props.view === 'thumbnails' })}
							title="Show Thumbnails" tabIndex={-1}
							onClick={() => props.onChangeView('thumbnails')}
							role="tab"
							aria-selected={props.view === 'thumbnails' }
							aria-controls='thumbnailsView'
						><IconThumbnails/></button>
					}
					<button
						id="viewAnnotations"
						className={cx('toolbar-button', { active: props.view === 'annotations' })}
						title="Show Annotations"
						tabIndex={-1}
						onClick={() => props.onChangeView('annotations')}
						role="tab"
						aria-selected={props.view === 'annotations' }
						aria-controls='annotationsView'
					><IconAnnotations/></button>
					<button
						id="viewOutline"
						className={cx('toolbar-button', { active: props.view === 'outline' })}
						title="Show Document Outline (double-click to expand/collapse all items)"
						tabIndex={-1}
						onClick={() => props.onChangeView('outline')}
						role="tab"
						aria-selected={props.view === 'outline' }
						aria-controls='outlineView'
					><IconOutline/></button>
				</div>
				<div className="end">
					{props.view === 'annotations' &&
						<SearchBox
							query={props.filter.query}
							onInput={handleSearchInput}
							placeholder={intl.formatMessage({ id: 'pdfReader.searchAnnotations' })}
						/>
					}
				</div>
			</div>
			<div id="sidebarContent" className="sidebar-content">
				{props.view === 'thumbnails' && props.thumbnailsView}
				{props.view === 'annotations' && <div id="annotationsView" role="tabpanel" aria-labelledby='viewAnnotations'>{props.annotationsView}</div>}
				{props.view === 'outline' && props.outlineView}
			</div>
		</div>
	);
}

export default Sidebar;
