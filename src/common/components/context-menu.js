import React, { Fragment, useState, useCallback, useEffect, useLayoutEffect, useRef, useImperativeHandle } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import cx from 'classnames';
import { IconColor16 } from './common/icons';
import { debounce } from '../lib/debounce';
import { isFirefox, isSafari } from "../lib/utilities";

import IconEraser from '../../../res/icons/16/annotate-eraser.svg';

const VERTICAL_PADDING = 2;

function BasicRow({ item, onClose }) {
	function handleClick(event, item) {
		onClose();
		event.preventDefault();
		// Allow context menu to close, before a confirmation popup
		setTimeout(() => item.onCommand());
	}

	return (
		<button
			tabIndex={-1}
			className={cx('row basic', { checked: item.checked })}
			onClick={(event) => handleClick(event, item)}
			disabled={item.disabled}
		>
			{item.color && <div className="icon"><IconColor16 color={item.color}/></div>}
			{item.eraser && <div className="icon"><IconEraser/></div>}
			{item.label}
		</button>
	);
}

function SliderRow({ item }) {
	let [size, setSize] = useState(item.size);
	let inputRef = useRef();

	function handleChange(event) {
		setSize(sliderValueTransform(event.target.value));
		debounceInputChange();
	}

	const debounceInputChange = useCallback(debounce(() => {
		item.onCommand(sliderValueTransform(inputRef.current.value));
	}, 300), []);


	let { steps } = item;

	function findClosest(value) {
		let closestIndex = 0;
		let minDiff = Math.abs(steps[0] - value);

		for (let i = 1; i < steps.length; i++) {
			let diff = Math.abs(steps[i] - value);
			if (diff < minDiff) {
				minDiff = diff;
				closestIndex = i;
			}
		}
		return closestIndex;
	}

	function sliderValueTransform(sliderValue) {
		return steps[sliderValue];
	}

	function valueToSliderTransform(val) {
		return findClosest(val);
	}


	return (
		<div className={cx('row slider', { checked: item.checked }, { center: isFirefox || isSafari })}>
			<div>{<FormattedMessage id="pdfReader.size"/>}:</div>
			<input
				ref={inputRef}
				tabIndex={-1}
				type="range"
				min="0"
				max={steps.length - 1}
				value={valueToSliderTransform(size)}
				className="slider"
				id="myRange"
				disabled={item.disabled}
				onChange={handleChange}
			/>
			<div className="number">{size.toFixed(1)}</div>
		</div>
	);
}

function ContextMenu({ params, onClose }) {
	const intl = useIntl();

	const [position, setPosition] = useState({ style: {} });
	const [update, setUpdate] = useState();
	const containerRef = useRef();
	const searchStringRef = useRef('');
	const searchTimeoutRef = useRef(null);

	useEffect(() => {
		setUpdate({});
	}, [params]);

	useLayoutEffect(() => {
		if (update) {
			updatePopupPosition();
		}
	}, [update]);

	function updatePopupPosition() {
		let popupWidth = containerRef.current.offsetWidth;
		let popupHeight = containerRef.current.offsetHeight;

		let { x: left, y: top } = params;

		top += VERTICAL_PADDING;

		if (left + popupWidth > window.innerWidth) {
			left = window.innerWidth - popupWidth;
		}

		if (top + popupHeight > window.innerHeight) {
			top = window.innerHeight - popupHeight;
		}

		setPosition({ style: { top, left } });
	}


	function handlePointerDown(event) {
		if (event.target.classList.contains('context-menu-overlay')) {
			// Closing context menu overlay results in another thumbnail click
			setTimeout(onClose);
			event.stopPropagation();
		}
	}

	// Select a menuitem from typing, similar to native context menus
	function handleKeyDown(event) {
		let { key } = event;
		// Ignore non-characters
		if (key.length !== 1 || !key.match(/\S/)) return;

		// Clear search string after 3 seconds of no typing
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}
		searchTimeoutRef.current = setTimeout(() => {
			searchStringRef.current = '';
		}, 2000);

		// Keep track of what has been typed so far
		searchStringRef.current += key.toLowerCase();

		// Find all buttons with text that start with what has been typed
		let menuOptions = [...document.querySelectorAll(".context-menu button:not([disabled])")];
		let candidates = menuOptions.filter(option => option.textContent.toLowerCase().startsWith(searchStringRef.current));
		
		// Focus the first match
		if (candidates.length) {
			candidates[0].focus();
		}
	}

	function handleClick(event, item) {
		onClose();
		event.preventDefault();
		// Allow context menu to close, before a confirmation popup
		setTimeout(() => item.onCommand());
	}

	return (
		<div className="context-menu-overlay" onPointerDown={handlePointerDown}>
			<div ref={containerRef} className="context-menu" style={position.style} data-tabstop={1} onKeyDown={handleKeyDown}>
				{params.itemGroups.map((items, i) => (
					<div key={i} className="group">
						{items.map((item, i) => {
							if (item.slider) {
								return <SliderRow key={i} item={item}/>;
							}
							else {
								return <BasicRow key={i} item={item} onClose={onClose}/>;
							}
						})}
					</div>
				))}
			</div>
		</div>
	);
}

export default ContextMenu;

