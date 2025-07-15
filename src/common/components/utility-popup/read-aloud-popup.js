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
import { getAvailableProviders, waitForProviders } from '../../read-aloud-provider';

function ReadAloudPopup(props) {
	const { l10n } = useLocalization();

	let { params, voices, onChange, onSetVoice, onOpenVoicePreferences, onClose } = props;

	let [showOptions, setShowOptions] = useState(false);
	let [wasPausedBeforeChangingSpeed, setWasPausedBeforeChangingSpeed] = useState(false);
	let [allProviders, setAllProviders] = useState(() => getAvailableProviders());

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
		let contentLanguageCode;
		try {
			contentLanguageCode = new Intl.Locale(params.lang).language;
		}
		catch (e) {
			console.warn(`Invalid locale: ${params.lang}`);
			contentLanguageCode = 'en';
		}

		let userLocale = navigator.languages[0];

		// If the user's locale has the same language as the content locale
		// (but possibly a different region), use the user's locale
		if (userLocale.startsWith(contentLanguageCode) && languages.includes(userLocale)) {
			return userLocale;
		}
		// Otherwise, if we know how to read the content locale, use that
		if (languages.includes(params.lang)) {
			return params.lang;
		}
		// Fall back to US English
		if (languages.includes('en-US')) {
			return 'en-US';
		}
		// Or, in the rare situation where the system can't read US English,
		// whatever the first locale it can read is
		return languages[0];
	}, [params.lang, languages]);

	useEffect(() => {
		console.log(`Resolved ${params.lang} to ${resolvedLang}`);
	}, [params.lang, resolvedLang]);

	let providers = useMemo(
		() => allProviders.filter(p => p.lang.startsWith(resolvedLang)),
		[allProviders, resolvedLang]
	);

	function handleSpeedChange(event) {
		let speed = parseFloat(event.target.value);
		onChange({ speed });
		onSetVoice(resolvedLang, params.voice, speed);
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
		let voice = event.target.value;
		onChange({ voice });
		onSetVoice(resolvedLang, voice, params.speed);
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

	useEffect(() => {
		let waitForProvidersAndSet = async () => {
			await waitForProviders();
			setAllProviders(getAvailableProviders());
		};
		waitForProvidersAndSet();
	}, []);

	useEffect(() => {
		if (!params.voice) {
			let { voice, speed } = voices.get(resolvedLang)
				?? { voice: providers[0].id, speed: params.speed };
			onChange({ voice, speed });
		}
	}, [onChange, params.speed, params.voice, providers, resolvedLang, voices]);

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

export default ReadAloudPopup;
