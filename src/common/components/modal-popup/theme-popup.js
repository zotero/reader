import { FormattedMessage } from 'react-intl';
import React, { useLayoutEffect, useRef, useState } from 'react';
import cx from 'classnames';

import DialogPopup from './common/dialog-popup';
import { DEFAULT_THEMES } from '../../defines';
import { getCurrentColorScheme } from '../../lib/utilities';

function isValidHexColor(value) {
	return /^#?([a-fA-F0-9]{6})$/.test(value);
}

function ColorPicker({ color, onChange }) {
	let colorInputRef = useRef();

	function handleFocus(event) {
		event.target.select();
	}

	function handleChange(event) {
		onChange(event.target.value.toUpperCase());
	}

	function handleColorClick() {
		colorInputRef.current.click();
	}

	return (
		<div className="color-picker">
			<input
				type="color"
				ref={colorInputRef}
				value={color}
				onChange={handleChange}
			/>
			<div className="button-outer">
				<button
					className="button"
					type="button"
					style={{ backgroundColor: isValidHexColor(color) && color || 'transparent' }}
					title={isValidHexColor(color) && color}
					tabIndex={-1}
					data-tabstop={1}
					onClick={handleColorClick}
				/>
			</div>
			<input
				type="text"
				tabIndex={-1}
				data-tabstop={1}
				value={color}
				placeholder="#000000"
				pattern="^#[0-9a-fA-F]{6}$"
				maxLength={7}
				onFocus={handleFocus}
				onChange={handleChange}
			/>
		</div>
	);
}

function ThemePopup({ params, customThemes, colorScheme, lightTheme, darkTheme, onSaveCustomThemes, onClose }) {
	let currentColorScheme = getCurrentColorScheme(colorScheme);
	let currentTheme = currentColorScheme === 'light' ? lightTheme : darkTheme;
	let bg = '#FFFFFF';
	let fg = '#000000';
	if (currentTheme) {
		bg = currentTheme.background;
		fg = currentTheme.foreground;
	}

	let nameRef = useRef();
	let [label, setLabel] = useState(params.theme?.label || '');
	let [background, setBackground] = useState(params.theme?.background || bg);
	let [foreground, setForeground] = useState(params.theme?.foreground || fg);

	useLayoutEffect(() => {
		nameRef.current.focus();
	}, []);

	function handleSave(event) {
		let theme = {};

		let map = new Map(customThemes.map(theme => [theme.id, theme]));

		if (params.theme) {
			theme = { ...params.theme };
		}
		else {
			let i = 1;
			while (1) {
				let id = 'custom' + i;
				if (!map.has(id)) {
					theme.id = id;
					break;
				}
				i++;
			}
		}

		theme.label = label.trim();
		theme.background = background;
		theme.foreground = foreground;

		if (params.theme) {
			map.set(params.theme.id, theme);
		}
		else {
			map.set(theme.id, theme);
		}
		onSaveCustomThemes(Array.from(map.values()));
	}

	function handleInput(event) {
		setLabel(event.target.value);
	}

	function handleBackgroundChange(color) {
		setBackground(color);
	}

	function handleForegroundChange(color) {
		setForeground(color);
	}

	function handleSubmit(event) {
		event.preventDefault();
		handleSave();
	}

	let nameInvalid = !label.trim().length;

	let canSave = (
		!nameInvalid
		&& isValidHexColor(background)
		&& isValidHexColor(foreground)
	);

	return (
		<DialogPopup className="theme-popup">
			<form onSubmit={handleSubmit}>
				<div className="grid">
					<label><FormattedMessage id="pdfReader.themeName"/></label>
					<div className="input">
						<input
							type="text"
							ref={nameRef}
							tabIndex={-1}
							value={label}
							data-tabstop={1}
							onInput={handleInput}
						/>
					</div>
					<label><FormattedMessage id="pdfReader.background"/></label>
					<div className="input"><ColorPicker color={background} onChange={handleBackgroundChange}/></div>
					<label><FormattedMessage id="pdfReader.foreground"/></label>
					<div className="input"><ColorPicker color={foreground} onChange={handleForegroundChange}/></div>
				</div>
				<div className="row buttons">
					<button
						tabIndex={-1}
						data-tabstop={1}
						className="form-button"
						type="button"
						onClick={onClose}
					><FormattedMessage id="general.cancel"/></button>
					<button
						tabIndex={-1}
						data-tabstop={1}
						type="submit"
						className="form-button primary"
						disabled={!canSave}
					><FormattedMessage id="general.save"/></button>
				</div>
			</form>
		</DialogPopup>
	);
}

export default ThemePopup;
