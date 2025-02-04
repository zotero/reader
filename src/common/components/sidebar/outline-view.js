import React, { useEffect, useRef } from 'react';
import cx from 'classnames';
import IconChevronDown8 from '../../../../res/icons/8/chevron-8.svg';

function clearActive(items) {
	for (let item of items) {
		item.active = false;
		if (item.items) {
			clearActive(item.items);
		}
	}
}

function setActive(outline, path) {
	let items = outline;
	for (let i = 0; i < path.length; i++) {
		const index = path[i];
		const item = items[index];
		if (!item) return;

		// If the item is not expanded, set it as active and stop traversal
		if (!item.expanded) {
			item.active = true;
			return;
		}

		// If we are at the last index, set the item as active
		if (i === path.length - 1) {
			item.active = true;
			return;
		}

		// Move to the next level
		items = item.items || [];
	}
}

function needsActivation(outline, path) {
	let items = outline;
	let itemToActivate = null;

	for (let i = 0; i < path.length; i++) {
		const index = path[i];
		const item = items[index];
		// Invalid path
		if (!item) {
			return false;
		}

		// If the item is not expanded, it should be the active item
		if (!item.expanded) {
			itemToActivate = item;
			break;
		}

		// If we are at the last index, this is the item to activate
		if (i === path.length - 1) {
			itemToActivate = item;
			break;
		}

		// Move to the next level
		items = item.items || [];
	}

	// If there's no item to activate, return false
	if (!itemToActivate) return false;

	// Return true if the item is already active, false otherwise
	return !!itemToActivate.active;
}

function Item({ item, id, children, onOpenLink, onUpdate, onSelect }) {
	function handleExpandToggleClick() {
		item.expanded = !item.expanded;
		onUpdate();
	}

	function handlePointerDown() {
		onSelect(item);
	}

	function handleDoubleClick() {
		if (item.items?.length) {
			handleExpandToggleClick();
		}
	}

	function handleURLClick(event) {
		event.preventDefault();
		onOpenLink(item.url);
	}

	let toggle;
	if (item.items?.length && item.childMatched !== false) {
		toggle = <div className="toggle" onClick={handleExpandToggleClick}><IconChevronDown8/></div>;
	}
	else {
		toggle = <div className="toggle"></div>;
	}

	let { expanded, active } = item;

	return (
		<li id={`outline-${id}`} aria-label={item.title}>
			<div
				className={cx('item', { expandable: !!item.items?.length, unmatched: item.matched === false, expanded, active })}
				data-id={id}
			>
				{toggle}
				<div
					className="title"
					onPointerDown={handlePointerDown}
					onDoubleClick={handleDoubleClick}
				>{item.title}{item.url && (<> [<a href={item.url} onClick={handleURLClick}>URL</a>]</>)}</div>
			</div>
			{children && <div className="children">{children}</div>}
		</li>
	);
}

function OutlineView({ outline, currentOutlinePath, onNavigate, onOpenLink, onUpdate}) {
	let containerRef = useRef();

	useEffect(() => {
		if (currentOutlinePath && !needsActivation(outline, currentOutlinePath)) {
			clearActive(outline);
			setActive(outline, currentOutlinePath);
			handleUpdate();
			setTimeout(() => {
				containerRef.current.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}, 200);
		}
	}, [currentOutlinePath]);

	function handleUpdate() {
		onUpdate([...outline]);
	}

	function handleSelect(item) {
		clearActive(outline);
		item.active = true;
		handleUpdate();
		if (item.location) {
			onNavigate(item.location, { block: 'start' });
		}
	}

	function flatten(items, list = []) {
		for (let item of items) {
			if ((item.matched !== false) || (item.childMatched !== false)) {
				list.push(item);
			}
			if (item.items && item.expanded && (item.childMatched !== false)) {
				flatten(item.items, list);
			}
		}
		return list;
	}

	
	function handleKeyDown(event) {
		let { key } = event;

		let list = flatten(outline);

		let currentIndex = list.findIndex(x => x.active);
		let currentItem = list[currentIndex];

		if (key === 'ArrowUp') {
			let previousItem = list[currentIndex - 1];
			if (previousItem) {
				clearActive(outline);
				previousItem.active = true;
				if (previousItem.location) {
					onNavigate(previousItem.location, { block: 'start' });
				}
				let element = containerRef.current.querySelector(`[data-id="${currentIndex - 1}"]`);
				if (element) {
					element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				}
			}
		}
		else if (key === 'ArrowDown') {
			let nextItem = list[currentIndex + 1];
			if (nextItem) {
				clearActive(outline);
				nextItem.active = true;
				if (nextItem.location) {
					onNavigate(nextItem.location, { block: 'start' });
				}
				let element = containerRef.current.querySelector(`[data-id="${currentIndex + 1}"]`);
				if (element) {
					element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				}
			}
		}
		else if (key === 'Enter') {
			if (currentItem.items.length) {
				currentItem.expanded = !currentItem.expanded;
			}
			else if (currentItem.url) {
				onOpenLink(currentItem.url);
			}
		}
		else if (!window.rtl && event.key === 'ArrowLeft' || window.rtl && event.key === 'ArrowRight') {
			if (currentItem.items.length) {
				currentItem.expanded = false;
			}
		}
		else if (!window.rtl && event.key === 'ArrowRight' || window.rtl && event.key === 'ArrowLeft') {
			if (currentItem.items.length) {
				currentItem.expanded = true;
			}
		}
		else {
			return;
		}
		handleUpdate();
	}

	function renderItems(items, counter = ({ n: -1 })) {
		return (
			<ul>{items.map((item, index) => {
				counter.n++;
				return (
					((item.matched !== false) || (item.childMatched !== false)) &&
					<Item
						key={index}
						item={item}
						id={counter.n}
						onOpenLink={onOpenLink}
						onUpdate={handleUpdate}
						onSelect={handleSelect}
					>
						{item.expanded && item?.items && renderItems(item.items, counter)}
					</Item>
				);
			})}</ul>
		);
	}

	let active = flatten(outline || []).findIndex(item => item.active);
	return (
		<div
			ref={containerRef}
			className={cx('outline-view', { loading: outline === null })}
			data-tabstop="1"
			tabIndex={-1}
			id="outlineView"
			role="listbox"
			aria-labelledby="viewOutline"
			onKeyDown={handleKeyDown}
			aria-activedescendant={active !== -1 ? `outline-${active}` : null}
		>
			{outline === null ? <div className="spinner"/> : renderItems(outline)}
		</div>
	);
}

export default OutlineView;
