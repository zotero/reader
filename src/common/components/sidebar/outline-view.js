import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';
import { IconTreeItemCollapsed, IconTreeItemExpanded } from '../common/icons';



function Item({ item, children, onNavigate, onOpenLink, onUpdate }) {
	function handleExpandToggleClick(event) {
		item.expanded = !item.expanded;
		onUpdate();
	}

	function handleKeyDown(event) {
		event.preventDefault();
		if (event.key === 'Enter' && item.url) {
			onOpenLink(item.url);
		}
		if (item?.items.length) {
			if (event.key === 'Enter') {
				handleExpandToggleClick();
			}
			else if (!window.rtl && event.key === 'ArrowLeft' || window.rtl && event.key === 'ArrowRight') {
				item.expanded = false;
				onUpdate();
			}
			else if (!window.rtl && event.key === 'ArrowRight' || window.rtl && event.key === 'ArrowLeft') {
				item.expanded = true;
				onUpdate();
			}
		}
	}

	function handleFocus(event) {
		if (item.location) {
			onNavigate(item.location);
		}
	}

	function handleClick() {
		if (item.items?.length) {
			handleExpandToggleClick();
		}
	}

	function handleURLClick(event) {
		event.preventDefault();
		onOpenLink(item.url);
	}

	let toggle;
	if (item.items?.length) {
		toggle = <div className="toggle" onClick={handleExpandToggleClick}></div>;
	}
	else {
		toggle = <div className="toggle"></div>;
	}

	return (
		<li>
			<div
				className={cx('item', { expandable: !!item.items?.length, expanded: item.expanded })}
			>
				{toggle}
				<div
					className="title"
					tabIndex={-1}
					onFocus={handleFocus}
					onKeyDown={handleKeyDown}
					onClick={handleClick}
				>{item.title}{item.url && (<> [<a href={item.url} onClick={handleURLClick}>URL</a>]</>)}</div>
			</div>
			{children && <div className="children">{children}</div>}
		</li>
	);
}

function OutlineView({ outline, onNavigate, onOpenLink, onUpdate}) {
	const intl = useIntl();

	function handleUpdate() {
		onUpdate([...outline]);
	}

	function renderItems(items) {
		return (
			<ul>{items.map((item, index) => {
				return (
					<Item
						key={index}
						item={item}
						onNavigate={onNavigate}
						onOpenLink={onOpenLink}
						onUpdate={handleUpdate}
					>
						{item.expanded && item.items && renderItems(item.items)}
					</Item>
				);
			})}</ul>
		);
	}





	return (
		<div className="outline-view" data-tabstop="1">
			{renderItems(outline)}
		</div>
	);
}

export default OutlineView;
