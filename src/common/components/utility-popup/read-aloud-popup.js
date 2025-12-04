import React, { useEffect, useMemo, useState } from 'react';
import cx from 'classnames';

import UtilityPopup from './common/utility-popup';
import IconAdvancedOptions from '../../../../res/icons/20/advanced-options.svg';
import IconSkipBack from '../../../../res/icons/20/skip-back.svg';
import IconPlay from '../../../../res/icons/20/play.svg';
import IconPause from '../../../../res/icons/20/pause.svg';
import IconSkipAhead from '../../../../res/icons/20/skip-ahead.svg';
import IconClose from '../../../../res/icons/20/x.svg';
import IconLoading from '../../../../res/icons/16/loading.svg';
import { useLocalization } from '@fluent/react';
import Select from '../common/select';
import { RemoteReadAloudProvider } from '../../read-aloud/remote/provider';
import { BrowserReadAloudProvider } from '../../read-aloud/browser/provider';

function ReadAloudPopup(props) {
	const { l10n } = useLocalization();

	let { params, voices, remoteInterface, onChange, onSetVoice, onOpenVoicePreferences, onClose } = props;

	let [showOptions, setShowOptions] = useState(false);
	let [speedWhileDragging, setSpeedWhileDragging] = useState(null);
	let [voiceMode, setVoiceMode] = useState('remote');
	let [allProviders, setAllProviders] = useState([]);
	let [controller, setController] = useState(null);
	let [isBuffering, setBuffering] = useState(false);

	let showSpinner = !params.segments || isBuffering;

	useEffect(() => {
		let provider = allProviders.find(p => p.id === params.voice);
		if (!provider) {
			setController(null);
			return undefined;
		}
		onChange({ segmentGranularity: provider.segmentGranularity, active: true });
		if (!params.segments) {
			setController(null);
			return undefined;
		}
		let controller = provider.getController(params.segments, params.backwardStopIndex, params.forwardStopIndex);
		setController(controller);
		return () => {
			controller.destroy();
			setBuffering(false);
		};
	}, [allProviders, onChange, params.backwardStopIndex, params.forwardStopIndex, params.segments, params.voice]);

	useEffect(() => {
		if (!controller) return;
		controller.speed = params.speed;
	}, [controller, params.speed]);

	let languages = useMemo(() => [...new Set(
		allProviders.map(provider => provider.lang).filter(Boolean)
	)], [allProviders]);

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

		let isLangSupported = lang => !languages.length || languages.includes(lang);

		// If the user's locale has the same language as the content locale
		// (but possibly a different region), use the user's locale
		if (userLocale.startsWith(contentLanguageCode) && isLangSupported(userLocale)) {
			return userLocale;
		}
		// Otherwise, if we know how to read the content locale, use that
		if (isLangSupported(params.lang)) {
			return params.lang;
		}
		// Fall back to US English
		if (isLangSupported('en-US')) {
			return 'en-US';
		}
		// Or, in the rare situation where the system can't read US English,
		// whatever the first locale it can read is
		return languages[0] ?? null;
	}, [params.lang, languages]);

	useEffect(() => {
		console.log(`Resolved ${params.lang} to ${resolvedLang}`);
	}, [params.lang, resolvedLang]);

	let providers = useMemo(
		() => allProviders.filter(p => p.lang === null || p.lang.startsWith(resolvedLang)),
		[allProviders, resolvedLang]
	);

	function handleSpeedChange(event) {
		if (speedWhileDragging === null) {
			let speed = parseFloat(event.target.value);
			onChange({ speed });
			onSetVoice(resolvedLang, params.voice, speed);
		}
		else {
			setSpeedWhileDragging(parseFloat(event.target.value));
		}
	}

	function handleSpeedPointerDown() {
		setSpeedWhileDragging(params.speed);
	}

	async function handleSpeedPointerUp() {
		if (speedWhileDragging !== null) {
			let paused = params.paused;
			if (!paused) {
				// Pause, then wait momentarily, because otherwise Web Speech
				// will read multiple lines at once
				onChange({ paused: true });
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			let speed = speedWhileDragging;
			onChange({ speed, paused });
			onSetVoice(resolvedLang, params.voice, speed);
			setSpeedWhileDragging(null);
		}
	}

	function handleVoiceModeChange(event) {
		setVoiceMode(event.target.value);
		onChange({ voice: null });
	}

	function handleLangChange(event) {
		let lang = event.target.value;
		onChange({ lang, voice: null });
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
		if (!controller) {
			return;
		}
		controller.paused = params.paused;
	}, [controller, params.paused]);

	useEffect(() => {
		if (!controller) {
			return;
		}
		controller.addEventListener('BufferingChange', () => {
			setBuffering(controller.buffering);
		});
		controller.addEventListener('ActiveSegmentChange', (event) => {
			onChange({ activeSegment: event.segment });
		});
		controller.addEventListener('Complete', () => {
			onChange({
				paused: true,
				activeSegment: null
			});
		});
	}, [controller, onChange]);

	useEffect(() => {
		let getProvidersAndSet = async () => {
			setAllProviders([]);
			let allProviders = await (voiceMode === 'remote'
				? RemoteReadAloudProvider.getAvailableProviders(remoteInterface)
				: BrowserReadAloudProvider.getAvailableProviders());
			setAllProviders(allProviders);
		};
		getProvidersAndSet();
	}, [voiceMode, remoteInterface]);

	useEffect(() => {
		if (params.voice && providers.some(provider => provider.id === params.voice)) {
			return;
		}

		let { voice, speed } = voices.get(resolvedLang) ?? {};
		if (!voice || !providers.some(provider => provider.id === voice)) {
			if (!providers.length) {
				return;
			}
			voice = providers[0].id;
			speed = params.speed;
		}
		onChange({
			voice,
			speed: speed,
			active: voice !== params.voice ? false : params.active,
		});
	}, [onChange, params.active, params.speed, params.voice, providers, resolvedLang, voices]);

	let displayNames = useMemo(() => new Intl.DisplayNames(undefined, {
		type: 'language',
		languageDisplay: 'standard'
	}), []);

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
					{showSpinner
						? <IconLoading
							className="loading-spinner"
							aria-busy={true}
						/>
						: <button
							className="toolbar-button"
							title={l10n.getString(`reader-read-aloud-${params.paused ? 'play' : 'pause'}`)}
							tabIndex="-1"
							onClick={() => onChange({ paused: !params.paused })}
						>{params.paused ? <IconPlay/> : <IconPause/>}</button>
					}
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
						aria-label={l10n.getString('reader-read-aloud-speed')}
						type="range"
						min="0.5"
						max="2.0"
						step="0.1"
						value={speedWhileDragging ?? params.speed}
						tabIndex="-1"
						onChange={handleSpeedChange}
						onPointerDown={handleSpeedPointerDown}
						onPointerUp={handleSpeedPointerUp}
						onPointerCancel={handleSpeedPointerUp}
					/>
					<label htmlFor="read-aloud-speed">{(speedWhileDragging ?? params.speed).toFixed(1)}×</label>
				</div>
				<Select
					aria-label={l10n.getString('reader-read-aloud-voice-mode')}
					value={voiceMode}
					tabIndex="-1"
					onChange={handleVoiceModeChange}
				>
					<option value="remote">{l10n.getString('reader-read-aloud-voice-mode-remote')}</option>
					<option value="browser">{l10n.getString('reader-read-aloud-voice-mode-browser')}</option>
				</Select>
				{voiceMode === 'browser' && (
					<Select
						aria-label="reader-read-aloud-language"
						value={resolvedLang}
						tabIndex="-1"
						onChange={handleLangChange}
					>
						{languages.map(language => (
							<option key={language} value={language}>{displayNames.of(language)}</option>
						))}
					</Select>
				)}
				{allProviders.length && (
					<div className="row voices" data-tabstop={1}>
						<Select
							value={params.voice || ''}
							tabIndex="-1"
							onChange={handleVoiceChange}
						>
							{providers.map((provider, i) => (
								<option key={i} value={provider.id}>{provider.label}</option>
							))}
							{voiceMode === 'browser' && <option value="more-voices">{l10n.getString('reader-read-aloud-more-voices')}</option>}
						</Select>
						<button className="help-button" aria-label={l10n.getString('general-help')}>?</button>
					</div>
				)}
			</>}
		</UtilityPopup>
	);
}

export default ReadAloudPopup;
