import React, { useEffect, useMemo, useState } from 'react';
import cx from 'classnames';

import UtilityPopup from './common/utility-popup';
import IconAdvancedOptions from '../../../../res/icons/20/advanced-options.svg';
import IconSkipBack from '../../../../res/icons/20/skip-back.svg';
import IconPlay from '../../../../res/icons/20/play.svg';
import IconPause from '../../../../res/icons/20/pause.svg';
import IconSkipAhead from '../../../../res/icons/20/skip-ahead.svg';
import IconClose from '../../../../res/icons/20/x.svg';
import { useLocalization } from '@fluent/react';
import Select from "../common/select";
import { getAvailableProviders } from "../../read-aloud-provider";

function ReadAloudPopup(props) {
	const { l10n } = useLocalization();

	let { params, onChange, onOpenVoicePreferences, onClose } = props;

	let [showOptions, setShowOptions] = useState(false);
	let [wasPausedBeforeChangingSpeed, setWasPausedBeforeChangingSpeed] = useState(false);

	let controller = useMemo(() => {
		if (!params.segments) {
			return null;
		}
		return getAvailableProviders().find(p => p.id === params.voice)
				?.getController(params.segments, params.backwardStopIndex, params.forwardStopIndex)
			?? null;
	}, [params.backwardStopIndex, params.forwardStopIndex, params.segments, params.voice]);

	useEffect(() => {
		if (!controller) return;
		controller.speed = params.speed;
	}, [controller, params.speed]);

	useEffect(() => {
		return () => {
			controller?.destroy();
		};
	}, [controller]);

	let languages = useMemo(() => [...new Set(
		getAvailableProviders().map(provider => provider.lang)
	)], []);

	let resolvedLang = useMemo(() => {
		return resolveLocale(params.lang || 'en-US', languages);
	}, [params.lang, languages]);

	let providers = useMemo(() => {
		return getAvailableProviders().filter(p => p.lang.startsWith(resolvedLang));
	}, [resolvedLang]);

	function handleSpeedChange(event) {
		let input = event.target;
		onChange({ speed: parseFloat(input.value) });
	}

	// Pause while actively changing speed to avoid audio jank
	function handleSpeedPointerDown() {
		setWasPausedBeforeChangingSpeed(params.paused);
		onChange({ paused: true });
	}

	function handleSpeedPointerUp() {
		onChange({ paused: wasPausedBeforeChangingSpeed });
	}

	function handleLangChange(event) {
		onChange({ lang: event.target.value, voice: null });
	}

	function handleVoiceChange(event) {
		if (event.target.value === 'more-voices') {
			onOpenVoicePreferences();
			return;
		}
		onChange({ voice: event.target.value });
	}

	useEffect(() => {
		if (controller) {
			controller.paused = params.paused;
			controller.addEventListener('ActiveSegmentChange', (event) => {
				onChange({ activeSegment: event.segment });
			});
			controller.addEventListener('Complete', () => {
				onChange({ paused: true, activeSegment: null });
			});
		}
	}, [controller, onChange, params.paused]);

	if (!params.voice) {
		setTimeout(() => {
			onChange({ voice: providers[0].id });
		});
	}

	let displayNames = new Intl.DisplayNames(undefined, {
		type: 'language',
		languageDisplay: 'standard'
	});

	return (
		<UtilityPopup className="read-aloud-popup">
			<div className="row buttons" data-tabstop={1}>
				<div className="group">
					<button
						className={cx('toolbar-button', { active: showOptions })}
						title={l10n.getString('reader-read-aloud-options')}
						tabIndex="-1"
						onClick={() => setShowOptions(!showOptions)}
					><IconAdvancedOptions/></button>
				</div>
				<div className="group">
					<button
						className="toolbar-button"
						title={l10n.getString('reader-read-aloud-skip-back')}
						tabIndex="-1"
						onClick={() => controller?.skipBack()}
					><IconSkipBack/></button>
					<button
						className="toolbar-button"
						title={l10n.getString(`reader-read-aloud-${params.paused ? 'play' : 'pause'}`)}
						tabIndex="-1"
						onClick={() => onChange({ paused: !params.paused })}
					>{params.paused ? <IconPlay/> : <IconPause/>}</button>
					<button
						className="toolbar-button"
						title={l10n.getString('reader-read-aloud-skip-ahead')}
						tabIndex="-1"
						onClick={() => controller?.skipAhead()}
					><IconSkipAhead/></button>
				</div>
				<div className="group">
					<button
						className="toolbar-button"
						title={l10n.getString('reader-close')}
						tabIndex="-1"
						onClick={onClose}
					><IconClose/></button>
				</div>
			</div>
			{showOptions && <>
				<div className="row speed" data-tabstop={1}>
					<input
						id="read-aloud-speed"
						type="range"
						min="0.5"
						max="2.0"
						step="0.1"
						value={params.speed}
						tabIndex="-1"
						onChange={handleSpeedChange}
						onPointerDown={handleSpeedPointerDown}
						onPointerUp={handleSpeedPointerUp}
						onPointerCancel={handleSpeedPointerUp}
					/>
					<label htmlFor="read-aloud-speed">{params.speed.toFixed(1)}×</label>
				</div>
				<Select
					value={resolvedLang}
					tabIndex="-1"
					onChange={handleLangChange}
				>
					{languages.map(language => (
						<option key={language} value={language}>{displayNames.of(language)}</option>
					))}
				</Select>
				<div className="row voices" data-tabstop={1}>
					<Select
						value={params.voice || ''}
						tabIndex="-1"
						onChange={handleVoiceChange}
					>
						{providers.map((provider, i) => (
							<option key={i} value={provider.id}>{provider.label}</option>
						))}
						<option value="more-voices">{l10n.getString('read-aloud-more-voices')}</option>
					</Select>
					<button className="help-button" aria-label={l10n.getString('general-help')}>?</button>
				</div>
			</>}
		</UtilityPopup>
	);
}

function resolveLocale(locale, locales) {
	// Based on Zotero.Utilities.Internal.resolveLocale()

	// If the locale exists as-is, use it
	if (locales.includes(locale)) {
		return locale;
	}

	// If there's a locale with just the language, use that
	let langCode = locale.substring(0, 2);
	if (locales.includes(langCode)) {
		return langCode;
	}

	// Find locales matching language
	let possibleLocales = locales.filter(x => x.substring(0, 2) === langCode);

	// If none, use en-US
	if (!possibleLocales.length) {
		if (!locales.includes('en-US')) {
			throw new Error("Locales not available");
		}
		return 'en-US';
	}

	possibleLocales.sort((a, b) => {
		if (a === 'en-US') return -1;
		if (b === 'en-US') return 1;

		// Prefer canonical country (e.g., pt-PT over pt-BR)
		if (a.substring(0, 2) === a.substring(3, 2).toLowerCase()) {
			return -1;
		}
		if (b.substring(0, 2) === b.substring(3, 2).toLowerCase()) {
			return 1;
		}

		return a.substring(3, 2).localeCompare(b.substring(3, 2));
	});
	return possibleLocales[0];
}

export default ReadAloudPopup;
