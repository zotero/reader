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

	function handleOutlineDoubleClick() {
		if (props.view !== 'outline' || props.outlineQuery !== '') {
			// Do nothing when in other views or under searching
			return;
		}

		function checkCollapsed(items) {
			var haveCollapsed = false;
			items.forEach((item) => {
				if (item.items?.length) {	
					if (item.expanded === false || checkCollapsed(item.items)){
						haveCollapsed = true;
					}
				}
			});
			return haveCollapsed;
		}
		function toggleCollapsed(items, value) {
			items.forEach((item) => {
				if (item.items?.length) {
					item.expanded = value;
					toggleCollapsed(item.items, value);
				}
			});
		}
		toggleCollapsed(props.outline, checkCollapsed(props.outline));
		props.onUpdateOutline([...props.outline]);
	}
	
	function handleSearchInput(query) {
		props.onChangeFilter({ ...props.filter, query });
	}

	function handleOutlineSearchInput(query) {
		function recursiveSearch(items, queryString) {
			const isMatch = (sourceString) => { 
				sourceString = sourceString.toLowerCase();
				queryString = queryString.toLowerCase();
				return sourceString.includes(queryString);
			}
			items.forEach((item) => {
				if (queryString == '') {
					item.matched = undefined;
					item.childMatched = undefined;
					item.expanded = (item.expandedBak !== undefined) ? item.expandedBak : item.expanded;
					item.expandedBak = undefined;
					if (item.items?.length) {	
						recursiveSearch(item.items, query);
					}
				}
				else {
					item.matched = isMatch(item.title);
					item.childMatched = false;
					item.expandedBak = (item.expandedBak !== undefined) ? item.expandedBak : item.expanded;
					if (item.items?.length) {	
						recursiveSearch(item.items, query);
						item.items.forEach((iitem) => {
							if ((iitem.matched === true) || (iitem.childMatched === true)) {
								item.childMatched = true;
								item.expanded = true;
							}
						});
					}
				}
			});
			return items;
		}
		props.onUpdateOutlineQuery(query);
    	props.onUpdateOutline([...recursiveSearch(props.outline, query)]);
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
						onDoubleClick={handleOutlineDoubleClick}
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
					{props.view === 'outline' &&
						<SearchBox
							query={props.outlineQuery}
							onInput={handleOutlineSearchInput}
							placeholder={intl.formatMessage({ id: 'pdfReader.searchOutline' })}
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
