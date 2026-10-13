import React, { useEffect, useId, useRef } from 'react';
import cx from 'classnames';

function Listbox({ value, onChange, options, 'aria-label': ariaLabel, tabIndex, className, showSecondaryLabel }) {
	let searchStringRef = useRef('');
	let searchTimeoutRef = useRef(null);

	let idPrefix = useId();

	let selectableItems = options.filter(item => !item.divider && !item.header && !item.disabled);

	function getOptionId(optionValue) {
		return `${idPrefix}-option-${optionValue}`;
	}

	function scrollOptionIntoView(optionValue) {
		if (optionValue === null || optionValue === undefined) {
			return;
		}
		document.getElementById(getOptionId(optionValue))?.scrollIntoView({ block: 'nearest' });
	}

	function selectIndex(index) {
		if (index < 0 || index >= selectableItems.length) {
			return;
		}
		let item = selectableItems[index];
		if (item.value !== value) {
			onChange?.(item.value);
		}
	}

	function selectRelative(offset) {
		let index = selectableItems.findIndex(item => item.value === value);
		if (index === -1) {
			selectIndex(offset > 0 ? 0 : selectableItems.length - 1);
		}
		else {
			selectIndex(index + offset);
		}
	}

	function handleKeyDown(event) {
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				event.stopPropagation();
				selectRelative(event.key === 'ArrowDown' ? 1 : -1);
				break;
			case 'Home':
				event.preventDefault();
				event.stopPropagation();
				selectIndex(0);
				break;
			case 'End':
				event.preventDefault();
				event.stopPropagation();
				selectIndex(selectableItems.length - 1);
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

		let candidate = selectableItems.find(
			item => item.label.toLowerCase().startsWith(searchStringRef.current)
		);
		if (candidate && candidate.value !== value) {
			onChange?.(candidate.value);
		}
	}

	useEffect(() => {
		scrollOptionIntoView(value);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	return (
		<div
			className={cx('listbox', className)}
			role="listbox"
			aria-label={ariaLabel}
			aria-activedescendant={value === null || value === undefined ? undefined : getOptionId(value)}
			tabIndex={tabIndex}
			onKeyDown={handleKeyDown}
			onPointerDown={(event) => {
				// Force focus in case clicking on tabindex="-1" isn't enough
				// for automatic :focus-visible in this browser
				event.currentTarget.focus({ focusVisible: true });
			}}
		>
			{options.map((item, index) => {
				if (item.divider) {
					return <div key={`d-${index}`} className="divider" role="separator"/>;
				}
				if (item.header) {
					return <div key={`h-${index}`} className="header" role="presentation">{item.label}</div>;
				}
				let isSelected = item.value === value;
				return (
					<div
						key={item.value}
						id={getOptionId(item.value)}
						className={cx('option', { selected: isSelected, disabled: item.disabled })}
						role="option"
						aria-selected={isSelected}
						aria-disabled={item.disabled || undefined}
						dir="auto"
						onClick={() => {
							if (!item.disabled && item.value !== value) {
								onChange?.(item.value);
							}
						}}
					>
						<span className="label">{item.label}</span>
						{showSecondaryLabel && item.secondaryLabel && (
							<span className="secondary-label">{item.secondaryLabel}</span>
						)}
					</div>
				);
			})}
		</div>
	);
}

export default Listbox;
