import React, { Fragment, useState, useCallback, useEffect, useLayoutEffect, useRef, useImperativeHandle } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';
import { IconColor } from './common/icons';
import { debounce } from '../lib/debounce';

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
		>{item.color && <div className="icon"><IconColor color={item.color}/></div>}{item.label}</button>
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

	var range1 = { sliderMin: 0, sliderMax: 4, valueStart: 0.2, valueEnd: 1.0, step: 0.2 };
	var range2 = { sliderMin: 5, sliderMax: 52, valueStart: 1.0, valueEnd: 25.0, step: 0.5 };

	function generateSteps() {
		var steps = [];
		for (let i = range1.valueStart; i <= range1.valueEnd; i += range1.step) {
			steps.push(parseFloat(i.toFixed(2)));
		}
		for (let i = range2.valueStart + range2.step; i <= range2.valueEnd; i += range2.step) {
			steps.push(parseFloat(i.toFixed(2)));
		}
		return steps;
	}

	var stepsArray = generateSteps();

	function findClosest(value) {
		let closestIndex = 0;
		let minDiff = Math.abs(stepsArray[0] - value);

		for (let i = 1; i < stepsArray.length; i++) {
			let diff = Math.abs(stepsArray[i] - value);
			if (diff < minDiff) {
				minDiff = diff;
				closestIndex = i;
			}
		}
		return closestIndex;
	}

	function sliderValueTransform(sliderValue) {
		return stepsArray[sliderValue];
	}

	function valueToSliderTransform(val) {
		return findClosest(val);
	}


	return (
		<div className={cx('row slider', { checked: item.checked })}>
			<div>Size:</div>
			<input
				ref={inputRef}
				tabIndex={-1}
				type="range"
				min="0"
				max={stepsArray.length - 1}
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
		}
	}

	function handleClick(event, item) {
		onClose();
		event.preventDefault();
		// Allow context menu to close, before a confirmation popup
		setTimeout(() => item.onCommand());
	}

	return (
		<div className="context-menu-overlay" onClick={handlePointerDown}>
			<div ref={containerRef} className="context-menu" style={position.style}>
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

