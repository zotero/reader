import React, { useState, useRef, useLayoutEffect, useEffect, useCallback, useId } from 'react';
import cx from 'classnames';
import IconChevronDown8 from '../../../../res/icons/8/chevron-8.svg';

const ROW_HEIGHT = 24;
const SCROLL_PADDING = 10; // 5px on each vertical edge of .scroll-container

function snapMaxHeight(maxH, overhead, scrollContainer) {
	if (!scrollContainer) {
		let available = maxH - overhead - SCROLL_PADDING;
		let rows = Math.floor(available / ROW_HEIGHT);
		if (rows < 1) rows = 1;
		return rows * ROW_HEIGHT + SCROLL_PADDING + overhead;
	}
	// Snap to actual item boundaries to avoid cutting items in half,
	// even when non-uniform-height elements like dividers are present
	let availableHeight = maxH - overhead - SCROLL_PADDING;
	let totalHeight = 0;
	for (let child of scrollContainer.children) {
		let childHeight = child.offsetHeight;
		let style = getComputedStyle(child);
		childHeight += parseFloat(style.marginTop) + parseFloat(style.marginBottom);
		if (totalHeight + childHeight > availableHeight) break;
		totalHeight += childHeight;
	}
	if (totalHeight === 0) totalHeight = ROW_HEIGHT;
	return totalHeight + SCROLL_PADDING + overhead;
}

function findSelectedOption(options, value) {
	return options.find(o => o.value === value) ?? null;
}

function CustomSelect({ value, onChange, options, 'aria-label': ariaLabel, tabIndex, disabled, className, showSecondaryLabelOnMenu }) {
	let [open, setOpen] = useState(false);
	let [focusedId, setFocusedId] = useState(null);

	let [canScrollUp, setCanScrollUp] = useState(false);
	let [canScrollDown, setCanScrollDown] = useState(false);

	let triggerRef = useRef();
	let dropdownRef = useRef();
	let overlayRef = useRef();
	let scrollContainerRef = useRef();
	let scrollAnimRef = useRef(null);
	let openedByPointerRef = useRef(false);
	let ignorePointerRef = useRef(false);
	let fullMaxHeightRef = useRef(0);
	let currentMaxHeightRef = useRef(0);
	let dropdownTopRef = useRef(0);
	let measuredOverheadRef = useRef(0);

	let [dropdownPosition, setDropdownPosition] = useState(null);

	let idPrefix = useId();

	let selectableItems = options.filter(item => !item.divider && !item.disabled && !item.header);

	// Type-ahead search
	let searchStringRef = useRef('');
	let searchTimeoutRef = useRef(null);

	let selectedOption = findSelectedOption(options, value);

	function getOptionId(value) {
		return `${idPrefix}-option-${value}`;
	}

	function findSelectableIndex(id) {
		return selectableItems.findIndex(item => getOptionId(item.value) === id);
	}

	function openDropdown() {
		setDropdownPosition(null);
		setOpen(true);
		let selectedIdx = selectableItems.findIndex(item => item.value === value);
		if (selectedIdx === -1) selectedIdx = 0;
		if (selectableItems[selectedIdx]) {
			setFocusedId(getOptionId(selectableItems[selectedIdx].value));
		}
	}

	function closeDropdown() {
		setOpen(false);
		setFocusedId(null);
		if (openedByPointerRef.current) {
			triggerRef.current?.blur();
		}
		else {
			triggerRef.current?.focus();
		}
	}

	function selectValue(val) {
		closeDropdown();
		if (val !== value) {
			onChange?.(val);
		}
	}

	function moveFocus(direction) {
		let currentIdx = findSelectableIndex(focusedId);
		let nextIdx = currentIdx + direction;
		if (nextIdx >= 0 && nextIdx < selectableItems.length) {
			setFocusedId(getOptionId(selectableItems[nextIdx].value));
		}
	}

	function handleTriggerKeyDown(event) {
		switch (event.key) {
			case 'Enter':
			case ' ':
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				openedByPointerRef.current = false;
				openDropdown();
				break;
			default:
				break;
		}
	}

	function handleDropdownKeyDown(event) {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				ignorePointerRef.current = true;
				moveFocus(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				ignorePointerRef.current = true;
				moveFocus(-1);
				break;
			case 'Home':
				event.preventDefault();
				ignorePointerRef.current = true;
				if (selectableItems.length) {
					setFocusedId(getOptionId(selectableItems[0].value));
				}
				break;
			case 'End':
				event.preventDefault();
				ignorePointerRef.current = true;
				if (selectableItems.length) {
					setFocusedId(getOptionId(selectableItems[selectableItems.length - 1].value));
				}
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				event.stopPropagation();
				{
					let focused = selectableItems.find(item => getOptionId(item.value) === focusedId);
					if (focused && !focused.disabled) {
						selectValue(focused.value);
					}
				}
				break;
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				closeDropdown();
				break;
			case 'Tab':
				event.preventDefault();
				closeDropdown();
				break;
			default:
				if (event.key.length === 1 && event.key.match(/\S/)) {
					handleTypeAhead(event.key);
				}
				break;
		}
	}

	function handleTypeAhead(char) {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}
		searchTimeoutRef.current = setTimeout(() => {
			searchStringRef.current = '';
		}, 2000);

		searchStringRef.current += char.toLowerCase();

		let candidates = selectableItems.filter(
			item => item.label.toLowerCase().startsWith(searchStringRef.current)
		);

		if (candidates.length) {
			setFocusedId(getOptionId(candidates[0].value));
		}
	}

	let updateScrollIndicators = useCallback(() => {
		let el = scrollContainerRef.current;
		if (!el) return;
		setCanScrollUp(el.scrollTop > 0);
		setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
	}, []);

	let wheelAccumRef = useRef(0);

	let handleWheel = useCallback((event) => {
		event.preventDefault();
		let el = scrollContainerRef.current;
		if (!el) return;

		let delta = event.deltaY;
		// Reset accumulator on direction change
		if ((wheelAccumRef.current > 0 && delta < 0) || (wheelAccumRef.current < 0 && delta > 0)) {
			wheelAccumRef.current = 0;
		}
		wheelAccumRef.current += delta;

		// Scroll one row each time the accumulated delta crosses the threshold
		let threshold = ROW_HEIGHT;
		let steps = Math.trunc(wheelAccumRef.current / threshold);
		if (steps !== 0) {
			wheelAccumRef.current -= steps * threshold;
			el.scrollTop += steps * ROW_HEIGHT;
			updateScrollIndicators();
			expandDropdownIfNeeded();
		}
	}, [updateScrollIndicators]);

	function handleOverlayPointerDown(event) {
		event.stopPropagation();
		if (event.target === event.currentTarget) {
			event.preventDefault();
			closeDropdown();
		}
	}

	function startScrolling(direction) {
		if (scrollAnimRef.current) return;
		let scroll = () => {
			let el = scrollContainerRef.current;
			if (el) {
				el.scrollTop += direction * ROW_HEIGHT;
				updateScrollIndicators();
				expandDropdownIfNeeded();
			}
		};
		scroll();
		scrollAnimRef.current = setInterval(scroll, 150);
	}

	function stopScrolling() {
		if (scrollAnimRef.current) {
			clearInterval(scrollAnimRef.current);
			scrollAnimRef.current = null;
		}
	}

	function expandDropdownIfNeeded() {
		let el = scrollContainerRef.current;
		if (!el) return;

		let currentMax = currentMaxHeightRef.current;
		let fullMax = fullMaxHeightRef.current;
		if (!fullMax || currentMax >= fullMax) return;

		let padding = 8;
		let expanded = false;

		// Expand downward if there's hidden content below and room in the viewport
		let hiddenBelow = el.scrollHeight - el.scrollTop - el.clientHeight;
		let spaceBelow = window.innerHeight - padding - (dropdownTopRef.current + currentMax);
		if (hiddenBelow > 0 && spaceBelow > 0) {
			let expandBy = Math.min(spaceBelow, hiddenBelow);
			currentMax = Math.min(currentMax + expandBy, fullMax);
			expanded = true;
		}

		// Snap after downward expansion to establish the stable bottom edge
		let bottomEdge = dropdownTopRef.current + currentMax;
		if (expanded) {
			currentMax = snapMaxHeight(currentMax, measuredOverheadRef.current, el);
			bottomEdge = dropdownTopRef.current + currentMax;
		}

		// Expand upward if there's hidden content above and room in the viewport
		let hiddenAbove = el.scrollTop;
		let spaceAbove = dropdownTopRef.current - padding;
		if (hiddenAbove > 0 && spaceAbove > 0) {
			let expandBy = Math.min(spaceAbove, hiddenAbove);
			let newMax = Math.min(currentMax + expandBy, fullMax);
			let actualExpand = newMax - currentMax;
			if (actualExpand > 0) {
				currentMax = newMax;
				currentMax = snapMaxHeight(currentMax, measuredOverheadRef.current, el);
				// Derive top from the fixed bottom edge so it never drifts
				let topExpand = currentMax - (bottomEdge - dropdownTopRef.current);
				if (topExpand > 0) {
					dropdownTopRef.current -= topExpand;
					el.scrollTop -= topExpand;
				}
				expanded = true;
			}
		}

		if (expanded) {
			currentMaxHeightRef.current = currentMax;
			setDropdownPosition(pos => pos && ({
				...pos,
				top: dropdownTopRef.current,
				maxHeight: currentMax,
			}));
		}
	}

	useEffect(() => {
		if (open && overlayRef.current) {
			overlayRef.current.focus();
		}
		if (!open) {
			stopScrolling();
		}
	}, [open]);

	// Attach wheel listener as non-passive so we can preventDefault()
	useEffect(() => {
		let el = scrollContainerRef.current;
		if (!open || !el) return undefined;
		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => el.removeEventListener('wheel', handleWheel);
	}, [handleWheel, open]);

	// Always scroll focused item into view
	useEffect(() => {
		if (!focusedId || !open) return;
		let el = document.getElementById(focusedId);
		if (el) {
			el.scrollIntoView({ block: 'nearest' });
			updateScrollIndicators();
			expandDropdownIfNeeded();
		}
	}, [focusedId, open, updateScrollIndicators]);

	// Align selected item over trigger
	useLayoutEffect(() => {
		if (!open || !dropdownRef.current || !triggerRef.current || !scrollContainerRef.current) return;

		let triggerRect = triggerRef.current.getBoundingClientRect();
		let dropdown = dropdownRef.current;
		let scroller = scrollContainerRef.current;
		let padding = 8;

		let selectedEl = scroller.querySelector('[aria-selected="true"]');

		scroller.scrollTop = 0;

		let scrollHeight = scroller.scrollHeight;
		let dropdownWidth = Math.max(dropdown.offsetWidth, triggerRect.width);
		let measuredOverhead = dropdown.offsetHeight - scroller.clientHeight;
		measuredOverheadRef.current = measuredOverhead;
		let maxHeight = snapMaxHeight(window.innerHeight - padding * 2, measuredOverhead, scroller);
		let dropdownHeight = Math.min(dropdown.offsetHeight, maxHeight);

		let triggerCenter = triggerRect.top + triggerRect.height / 2;

		let top;
		let scrollTop = 0;
		let initialMaxHeight = maxHeight;

		if (selectedEl) {
			let selectedCenter = selectedEl.offsetTop + selectedEl.offsetHeight / 2;

			// Calculate initial constrained height
			// Show items from top of list through selected + 1 buffer item
			let selectedBottom = selectedEl.offsetTop + selectedEl.offsetHeight;
			let buffer = ROW_HEIGHT;
			let candidate = selectedBottom + buffer + SCROLL_PADDING + measuredOverhead;
			candidate = Math.max(candidate, 80);
			candidate = snapMaxHeight(candidate, measuredOverhead, scroller);
			let useConstrainedHeight = candidate < dropdownHeight;
			let effectiveHeight = useConstrainedHeight ? candidate : dropdownHeight;

			// Ideal: position dropdown so the selected item center aligns with trigger center
			top = triggerCenter - selectedCenter;

			// If the dropdown would extend above the viewport, clamp and scroll
			if (top < padding) {
				scrollTop = padding - top;
				top = padding;
			}

			// Same for below the viewport
			if (top + effectiveHeight > window.innerHeight - padding) {
				top = window.innerHeight - padding - effectiveHeight;
				// Recalculate scroll so selected item aligns with trigger
				scrollTop = selectedCenter - (triggerCenter - top);
			}

			// Clamp scroll
			let expectedClientHeight = effectiveHeight - measuredOverhead;
			scrollTop = Math.max(0, Math.min(scrollTop, scrollHeight - expectedClientHeight));

			// Finalize initial max height with actual scrollTop
			if (useConstrainedHeight) {
				let visibleSelectedBottom = selectedBottom - scrollTop;
				initialMaxHeight = visibleSelectedBottom + buffer + SCROLL_PADDING + measuredOverhead;
				initialMaxHeight = Math.max(initialMaxHeight, 80);
				initialMaxHeight = Math.min(initialMaxHeight, maxHeight);
			}
		}
		else {
			top = triggerRect.top;
			if (top + dropdownHeight > window.innerHeight - padding) {
				top = window.innerHeight - padding - dropdownHeight;
			}
			if (top < padding) {
				top = padding;
			}
		}

		let left = triggerRect.left;
		if (left + dropdownWidth > window.innerWidth - padding) {
			left = window.innerWidth - padding - dropdownWidth;
		}
		if (left < padding) {
			left = padding;
		}

		// Expand to fill available viewport space
		if (initialMaxHeight < maxHeight) {
			let clientHeight = initialMaxHeight - measuredOverhead;

			let hiddenBelow = scrollHeight - scrollTop - clientHeight;
			let spaceBelow = window.innerHeight - padding - (top + initialMaxHeight);
			if (hiddenBelow > 0 && spaceBelow > 0) {
				let expandBy = Math.min(spaceBelow, hiddenBelow);
				initialMaxHeight = Math.min(initialMaxHeight + expandBy, maxHeight);
			}

			let hiddenAbove = scrollTop;
			let spaceAbove = top - padding;
			if (hiddenAbove > 0 && spaceAbove > 0) {
				let expandBy = Math.min(spaceAbove, hiddenAbove);
				let newMax = Math.min(initialMaxHeight + expandBy, maxHeight);
				let actualExpand = newMax - initialMaxHeight;
				if (actualExpand > 0) {
					initialMaxHeight = newMax;
					top -= actualExpand;
					scrollTop -= actualExpand;
				}
			}
		}

		// If the dropdown ended up very short but has more content to show,
		// move it upward to use available viewport space
		let minDesiredHeight = 300;
		if (initialMaxHeight < minDesiredHeight && scrollHeight + measuredOverhead > initialMaxHeight) {
			let spaceAbove = top - padding;
			let growBy = Math.min(minDesiredHeight - initialMaxHeight, spaceAbove);
			if (growBy > 0) {
				initialMaxHeight += growBy;
				top -= growBy;
			}
		}

		initialMaxHeight = snapMaxHeight(initialMaxHeight, measuredOverhead, scroller);
		fullMaxHeightRef.current = maxHeight;
		currentMaxHeightRef.current = initialMaxHeight;
		dropdownTopRef.current = top;

		scroller.scrollTop = scrollTop;

		setDropdownPosition({
			top,
			left,
			maxHeight: initialMaxHeight,
			minWidth: triggerRect.width,
		});
		setTimeout(() => {
			// Mysteriously, this does not work unless it's in a setTimeout(),
			// even if moved to useEffect
			updateScrollIndicators();
		});
	}, [open, updateScrollIndicators, value]);

	return (
		<div className={cx('custom-select', className)}>
			<button
				type="button"
				ref={triggerRef}
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-activedescendant={open ? focusedId : undefined}
				aria-label={ariaLabel}
				tabIndex={tabIndex}
				disabled={disabled}
				className="custom-select-trigger"
				onClick={() => {
					if (open) {
						closeDropdown();
					}
					else {
						openedByPointerRef.current = true;
						openDropdown();
					}
				}}
				onKeyDown={!open ? handleTriggerKeyDown : undefined}
			>
				<span className="label">{selectedOption?.label ?? ''}</span>
				<IconChevronDown8 className="chevron"/>
			</button>
			{open && (
				<div ref={overlayRef} className="custom-select-overlay" tabIndex={-1} onPointerDown={handleOverlayPointerDown} onKeyDown={handleDropdownKeyDown}>
					<div
						ref={dropdownRef}
						className="custom-select-dropdown"
						aria-label={ariaLabel}
						style={{
							'--row-height': ROW_HEIGHT + 'px',
							...(dropdownPosition || { visibility: 'hidden' }),
						}}
					>
						<div
							className={cx('scroll-indicator up', { hidden: !canScrollUp })}
							onPointerEnter={() => startScrolling(-1)}
							onPointerLeave={stopScrolling}
						>
							<IconChevronDown8 style={{ transform: 'rotate(180deg)' }}/>
						</div>
						<div
							ref={scrollContainerRef}
							className={cx('scroll-container', { 'can-scroll-up': canScrollUp, 'can-scroll-down': canScrollDown })}
							role="listbox"
							onPointerMove={() => ignorePointerRef.current = false}
							onPointerLeave={() => {
								if (!ignorePointerRef.current) {
									setFocusedId(null);
								}
							}}
							onScroll={() => {
								updateScrollIndicators();
								expandDropdownIfNeeded();
							}}
						>
							{options.map((item, index) => {
								if (item.divider) {
									return <div key={`d-${index}`} className="divider" role="separator"/>;
								}
								if (item.header) {
									return <div key={`h-${index}`} className="header" role="presentation" onPointerEnter={() => {
										if (!ignorePointerRef.current) {
											setFocusedId(null);
										}
									}}>{item.label}</div>;
								}
								let isSelected = item.value === value;
								let isFocused = focusedId === getOptionId(item.value);
								return (
									<div
										key={item.value}
										id={getOptionId(item.value)}
										className={cx('option', { selected: isSelected, focused: isFocused, disabled: item.disabled })}
										role="option"
										aria-selected={isSelected}
										aria-disabled={item.disabled || undefined}
										dir="auto"
										onPointerEnter={() => {
											if (!ignorePointerRef.current) {
												setFocusedId(getOptionId(item.value));
											}
										}}
										onPointerUp={() => {
											if (!item.disabled) {
												selectValue(item.value);
											}
										}}
									>
										<span className="label">{item.label}</span>
										{showSecondaryLabelOnMenu && item.secondaryLabel && (
											<span className="secondary-label">{item.secondaryLabel}</span>
										)}
									</div>
								);
							})}
						</div>
						<div
							className={cx('scroll-indicator down', { hidden: !canScrollDown })}
							onPointerEnter={() => startScrolling(1)}
							onPointerLeave={stopScrolling}
						>
							<IconChevronDown8/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default CustomSelect;
