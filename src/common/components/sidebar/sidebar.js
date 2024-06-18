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
							tabIndex={-1}
							title={intl.formatMessage({ id: 'pdfReader.showThumbnails' })}
							role="tab"
							aria-selected={props.view === 'thumbnails' }
							aria-controls="thumbnailsView"
							onClick={() => props.onChangeView('thumbnails')}
						><IconThumbnails/></button>
					}
					<button
						id="viewAnnotations"
						className={cx('toolbar-button', { active: props.view === 'annotations' })}
						tabIndex={-1}
						title={intl.formatMessage({ id: 'pdfReader.showAnnotations' })}
						role="tab"
						aria-selected={props.view === 'annotations' }
						aria-controls="annotationsView"
						onClick={() => props.onChangeView('annotations')}
					><IconAnnotations/></button>
					<button
						id="viewOutline"
						className={cx('toolbar-button', { active: props.view === 'outline' })}
						tabIndex={-1}
						title={intl.formatMessage({ id: 'pdfReader.showOutline' })}
						role="tab"
						aria-selected={props.view === 'outline' }
						aria-controls="outlineView"
						onClick={() => props.onChangeView('outline')}
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
				{props.view === 'annotations' && <div id="annotationsView" role="tabpanel" aria-labelledby="viewAnnotations">{props.annotationsView}</div>}
				{props.view === 'outline' && props.outlineView}
			</div>
		</div>
	);
}

export default Sidebar;
