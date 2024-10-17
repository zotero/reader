import React, { useRef } from 'react';
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
		<li>
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

function OutlineView({ outline, onNavigate, onOpenLink, onUpdate}) {
	let containerRef = useRef();

	function handleUpdate() {
		onUpdate([...outline]);
	}

	function handleSelect(item) {
		clearActive(outline);
		item.active = true;
		handleUpdate();
		if (item.location) {
			onNavigate(item.location);
		}
	}

	function handleKeyDown(event) {
		let { key } = event;

		let list = [];
		function flatten(items) {
			for (let item of items) {
				if ((item.matched !== false) || (item.childMatched !== false)) {
					list.push(item);
				}
				if (item.items && item.expanded && (item.childMatched !== false)) {
					flatten(item.items);
				}
			}
		}

		flatten(outline);

		let currentIndex = list.findIndex(x => x.active);
		let currentItem = list[currentIndex];

		if (key === 'ArrowUp') {
			let previousItem = list[currentIndex - 1];
			if (previousItem) {
				clearActive(outline);
				previousItem.active = true;
				if (previousItem.location) {
					onNavigate(previousItem.location);
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
					onNavigate(nextItem.location);
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

	return (
		<div
			ref={containerRef}
			className={cx('outline-view', { loading: outline === null })}
			data-tabstop="1"
			tabIndex={-1}
			id="outlineView"
			role="tabpanel"
			aria-labelledby="viewOutline"
			onKeyDown={handleKeyDown}
		>
			{outline === null ? <div className="spinner"/> : renderItems(outline)}
		</div>
	);
}

export default OutlineView;
