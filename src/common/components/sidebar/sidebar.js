import React from 'react';
import { useLocalization } from '@fluent/react';
import cx from 'classnames';
import IconThumbnails from '../../../../res/icons/20/thumbnail.svg';
import IconAnnotations from '../../../../res/icons/20/annotation.svg';
import IconOutline from '../../../../res/icons/20/outline.svg';
import SearchBox from './search-box';

function Sidebar(props) {
	let { l10n } = useLocalization();

	function handleOutlineDoubleClick() {
		if (props.view !== 'outline' || props.outlineQuery !== '') {
			// Do nothing when in other views or under searching
			return;
		}

		function checkCollapsed(items) {
			var haveCollapsed = false;
			items.forEach((item) => {
				if (item.items?.length) {
					if (item.expanded === false || checkCollapsed(item.items)) {
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
			let containActive = false;
			const isMatch = (sourceString) => {
				sourceString = sourceString.toLowerCase();
				queryString = queryString.toLowerCase();
				return sourceString.includes(queryString);
			};
			items.forEach((item) => {
				if (queryString == '') {
					if ('expandedBak' in item) {
						if (item.expandedBak !== undefined) {
							item.expanded = item.expandedBak;
						}
						else {
							delete item.expanded;
						}
					}
					delete item.matched;
					delete item.childMatched;
					delete item.expandedBak;

					if (item.items?.length) {
						if (recursiveSearch(item.items, query).containActive) {
							item.expanded = true;
							containActive = true;
						}
					}
					if (item.active) {
						containActive = true;
					}
				}
				else {
					item.matched = isMatch(item.title);
					item.childMatched = false;
					item.expandedBak = ('expandedBak' in item) ? item.expandedBak : item.expanded;
					if (item.items?.length) {
						delete item.expanded;
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
			return {
				items: items,
				containActive: containActive
			};
		}
		props.onUpdateOutlineQuery(query);
		props.onUpdateOutline([...recursiveSearch(props.outline, query).items]);
	}

	return (
		<div id="sidebarContainer" className="sidebarOpen" role="application">
			<div className="sidebar-toolbar">
				<div className="start" data-tabstop={1} role="tablist">
					{props.type === 'pdf' &&
						<button
							id="viewThumbnail"
							className={cx('toolbar-button', { active: props.view === 'thumbnails' })}
							tabIndex={-1}
							title={l10n.getString('reader-show-thumbnails')}
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
						title={l10n.getString('reader-show-annotations')}
						role="tab"
						aria-selected={props.view === 'annotations' }
						aria-controls="annotationsView"
						onClick={() => props.onChangeView('annotations')}
					><IconAnnotations/></button>
					<button
						id="viewOutline"
						className={cx('toolbar-button', { active: props.view === 'outline' })}
						tabIndex={-1}
						title={l10n.getString('reader-show-outline')}
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
							placeholder={l10n.getString('reader-search-annotations')}
						/>
					}
					{props.view === 'outline' &&
						<SearchBox
							query={props.outlineQuery}
							onInput={handleOutlineSearchInput}
							placeholder={l10n.getString('reader-search-outline')}
						/>
					}
				</div>
			</div>
			<div id="sidebarContent" className="sidebar-content">
				<div className={cx("viewWrapper", { hidden: props.view !== 'thumbnails'})}>
					{props.thumbnailsView}
				</div>
				<div id="annotationsView" role="tabpanel" aria-labelledby="viewAnnotations" className={cx("viewWrapper", { hidden: props.view !== 'annotations'})}>
					{props.annotationsView}
				</div>
				<div className={cx("viewWrapper", { hidden: props.view !== 'outline'})} role="tabpanel">
					{props.outlineView}
				</div>
			</div>
		</div>
	);
}

export default Sidebar;
