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
import SpeechController from "../../speech-controller";

function ReadAloudPopup(props) {
	const { l10n } = useLocalization();

	let { params, onChange, onOpenVoicePreferences, onClose } = props;

	let [showOptions, setShowOptions] = useState(false);
	let [speechController, setSpeechController] = useState(null);
	let [wasPausedBeforeChangingSpeed, setWasPausedBeforeChangingSpeed] = useState(false);

	useEffect(() => {
		if (params.segments) {
			let speechController = new SpeechController({
				segments: params.segments,
				lang: params.lang,
			});
			speechController.addEventListener('ActiveSegmentChange', (event) => {
				onChange({ activeSegment: event.segment });
			});
			speechController.addEventListener('Complete', () => {
				onChange({ paused: true, activeSegment: null });
			});
			setSpeechController(speechController);

			return () => {
				speechController.dispose();
			};
		}
		return undefined;
	}, [params.segments, params.lang, onChange]);

	useEffect(() => {
		if (!speechController) return;
		speechController.speed = params.speed;
		speechController.voice = params.voice;
		speechController.paused = params.paused;
		speechController.update();
	}, [params.speed, params.voice, params.paused, speechController]);

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
		onChange({ lang: event.target.value });
	}

	function handleVoiceChange(event) {
		if (event.target.value === 'more-voices') {
			onOpenVoicePreferences();
			return;
		}
		onChange({ voice: event.target.value });
	}

	let resolvedLang = useMemo(() => {
		if (!speechController) {
			return undefined;
		}
		return resolveLocale(params.lang, speechController.languages);
	}, [params.lang, speechController]);

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
						onClick={() => speechController?.skipBack()}
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
						onClick={() => speechController?.skipAhead()}
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
			{speechController && showOptions && <>
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
				<select
					value={resolvedLang}
					tabIndex="-1"
					onChange={handleLangChange}
				>
					{[...speechController.languages].map(language => (
						<option key={language} value={language}>{displayNames.of(language)}</option>
					))}
				</select>
				<select
					value={params.voice || speechController.voice || ''}
					tabIndex="-1"
					onChange={handleVoiceChange}
				>
					{[...speechController.getVoices(resolvedLang)].map(([id, name], i) => (
						<option key={i} value={id}>{name}</option>
					))}
					<option value="more-voices">{l10n.getString('read-aloud-more-voices')}</option>
				</select>
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
	let langCode = locale.substr(0, 2);
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
