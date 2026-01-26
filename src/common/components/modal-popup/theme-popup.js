import React, { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';
import { getCurrentColorScheme } from '../../lib/utilities';

function isValidHexColor(value) {
	return /^#?([a-fA-F0-9]{6})$/.test(value);
}

function isDarkTheme(bg, fg) {
	if (!isValidHexColor(bg) || !isValidHexColor(fg)) {
		return false;
	}

	let normalize = (value) => value.replace('#', '');
	let hexToRgb = (hex) => {
		let normalized = normalize(hex);
		return {
			r: parseInt(normalized.slice(0, 2), 16),
			g: parseInt(normalized.slice(2, 4), 16),
			b: parseInt(normalized.slice(4, 6), 16),
		};
	};

	let luminance = ({ r, g, b }) => {
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};

	let bgLum = luminance(hexToRgb(bg));
	let fgLum = luminance(hexToRgb(fg));

	return bgLum < fgLum;
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
	let { l10n } = useLocalization();

	let currentColorScheme = getCurrentColorScheme(colorScheme);
	let currentTheme = currentColorScheme === 'light' ? lightTheme : darkTheme;
	let bg = '#FFFFFF';
	let fg = '#000000';
	let inv = false;
	if (currentTheme) {
		bg = currentTheme.background;
		fg = currentTheme.foreground;
		inv = currentTheme.invertImages;
	}

	let nameRef = useRef();
	let [label, setLabel] = useState(params.theme?.label || '');
	let [background, setBackground] = useState(params.theme?.background || bg);
	let [foreground, setForeground] = useState(params.theme?.foreground || fg);
	let [invertImages, setInvertImages] = useState(params.theme?.invertImages ?? inv);

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
		if (invertImages) {
			theme.invertImages = true;
		}
		else {
			delete theme.invertImages;
		}

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

	function handleInvertImagesChange(event) {
		setInvertImages(event.target.checked);
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
					<label>{l10n.getString('reader-theme-name')}</label>
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
					<label>{l10n.getString('reader-background')}</label>
					<div className="input"><ColorPicker color={background} onChange={handleBackgroundChange}/></div>
					<label>{l10n.getString('reader-foreground')}</label>
					<div className="input"><ColorPicker color={foreground} onChange={handleForegroundChange}/></div>
					{isDarkTheme(background, foreground) && <Fragment>
						<div></div>
						<div>
							<div className="option">
								<input
									tabIndex={-1}
									data-tabstop={1}
									id="theme-invert-images"
									type="checkbox"
									checked={invertImages}
									onChange={handleInvertImagesChange}
								/>
								<label htmlFor="theme-invert-images">{l10n.getString('reader-theme-invert-images')}</label>
							</div>
						</div>
					</Fragment>}
				</div>
				<div className="row buttons">
					<button
						tabIndex={-1}
						data-tabstop={1}
						className="form-button"
						type="button"
						onClick={onClose}
					>{l10n.getString('general-cancel')}</button>
					<button
						tabIndex={-1}
						data-tabstop={1}
						type="submit"
						className="form-button primary"
						disabled={!canSave}
					>{l10n.getString('general-save')}</button>
				</div>
			</form>
		</DialogPopup>
	);
}

export default ThemePopup;
