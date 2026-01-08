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
import IconClock from '../../../../res/icons/12/clock.svg';
import { Localized, useLocalization } from '@fluent/react';
import Select from '../common/select';
import { RemoteReadAloudProvider } from '../../read-aloud/remote/provider';
import { BrowserReadAloudProvider } from '../../read-aloud/browser/provider';
import { BrowserReadAloudVoice } from '../../read-aloud/browser/voice';
import { getSupportedLanguages, resolveLanguage } from '../../read-aloud/lang';

const URGENT_THRESHOLD_SECONDS = 60;

function ReadAloudPopup(props) {
	const { l10n } = useLocalization();

	let { params, voices: persistedVoices, remoteInterface, loggedIn, onChange, onSetVoice, onOpenVoicePreferences, onOpenLearnMore, onClose, onLogIn } = props;

	let [showOptions, setShowOptions] = useState(false);
	let [speedWhileDragging, setSpeedWhileDragging] = useState(null);
	let [voiceMode, setVoiceMode] = useState(null);
	let [allVoices, setAllVoices] = useState([]);
	let [isBuffering, setBuffering] = useState(false);
	let [secondsRemaining, setSecondsRemaining] = useState(null);
	let [error, setError] = useState(null);
	let [pausedAfterQuotaExhausted, setPausedAfterQuotaExhausted] = useState(false);

	let controller = params.controller;
	let showSpinner = !params.segments || isBuffering;

	useEffect(() => {
		let voice = allVoices.find(v => v.id === params.voice);
		if (!voice) {
			onChange({ controller: undefined });
			return undefined;
		}
		onChange({ segmentGranularity: voice.segmentGranularity, active: true });
		if (!params.segments) {
			onChange({ controller: undefined });
			return undefined;
		}
		let backwardStopIndex = params.backwardStopIndex;
		if (params.segments && params.activeSegment) {
			backwardStopIndex = params.segments.indexOf(params.activeSegment);
		}
		let controller = voice.getController(params.segments, backwardStopIndex, params.forwardStopIndex);
		onChange({ controller });

		controller.addEventListener('BufferingChange', () => {
			setBuffering(controller.buffering);
		});
		controller.addEventListener('ActiveSegmentChanging', (event) => {
			onChange({ activeSegment: event.segment });
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
		controller.addEventListener('error', () => {
			if (controller.error === 'quota-exceeded') {
				setShowOptions(true);
			}
			setError(controller.error);
		});

		let voiceMode = voice instanceof BrowserReadAloudVoice ? 'browser' : 'remote';
		setVoiceMode(voiceMode);

		return () => {
			controller.destroy();
		};
	}, [allVoices, onChange, params.backwardStopIndex, params.forwardStopIndex, params.segments, params.voice]);

	useEffect(() => {
		if (!controller) return;
		controller.speed = params.speed;
	}, [controller, params.speed]);

	let languages = useMemo(() => getSupportedLanguages(allVoices), [allVoices]);
	let resolvedLang = useMemo(() => resolveLanguage(params.lang, languages), [params.lang, languages]);

	useEffect(() => {
		console.log(`Resolved ${params.lang} to ${resolvedLang}`);
	}, [params.lang, resolvedLang]);

	let voicesForSelection = useMemo(
		() => allVoices.filter((voice) => {
			let voiceModeHere = voice instanceof BrowserReadAloudVoice ? 'browser' : 'remote';
			return (voiceMode === null || voiceModeHere === voiceMode)
				&& (voice.lang === null || voice.lang.startsWith(resolvedLang));
		}),
		[allVoices, resolvedLang, voiceMode]
	);

	let { voice: persistedVoice, speed: persistedSpeed } = persistedVoices.get(resolvedLang) ?? {};

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
	}

	useEffect(() => {
		if (!controller) {
			return;
		}
		controller.paused = params.paused;
	}, [controller, params.paused]);

	useEffect(() => {
		if (!controller) {
			setSecondsRemaining(null);
			return undefined;
		}

		let updateRemaining = () => {
			setSecondsRemaining(controller.secondsRemaining);

			let isQuotaExhausted = controller.error === 'quota-exhausted' || controller.secondsRemaining === 0;
			let isQuotaLow = isQuotaExhausted
				|| (controller.secondsRemaining !== null
					&& controller.secondsRemaining < URGENT_THRESHOLD_SECONDS);
			if (isQuotaLow) {
				setShowOptions(true);
			}
			if (isQuotaExhausted && !params.paused) {
				if (pausedAfterQuotaExhausted) {
					setVoiceMode('browser');
				}
				else {
					onChange({ paused: true });
					setPausedAfterQuotaExhausted(true);
				}
			}
		};
		updateRemaining();

		let interval = setInterval(updateRemaining, 1000);
		return () => clearInterval(interval);
	}, [controller, onChange, params.paused, pausedAfterQuotaExhausted]);

	useEffect(() => {
		let fetchVoicesAndSet = async () => {
			setAllVoices([]);
			let remoteProvider = new RemoteReadAloudProvider(remoteInterface);
			let browserProvider = new BrowserReadAloudProvider();

			let handleError = (e) => {
				console.error(e);
				return [];
			};
			let [remoteVoices, browserVoices] = await Promise.all([
				loggedIn ? remoteProvider.getVoices().catch(handleError) : [],
				browserProvider.getVoices().catch(handleError),
			]);
			setAllVoices([...remoteVoices, ...browserVoices]);
		};
		fetchVoicesAndSet();
	}, [loggedIn, remoteInterface]);

	useEffect(() => {
		if (params.voice && voicesForSelection.some(v => v.id === params.voice)) {
			onSetVoice(resolvedLang, params.voice, params.speed);
			return;
		}

		let voice = persistedVoice;
		let speed = persistedSpeed;
		if (!voice || !voicesForSelection.some(v => v.id === voice)) {
			if (!voicesForSelection.length) {
				return;
			}
			voice = voicesForSelection[0].id;
			speed = params.speed;
		}
		onChange({
			voice,
			speed,
			active: voice !== params.voice ? false : params.active,
		});
		onSetVoice(resolvedLang, voice, params.speed);
	}, [onChange, onSetVoice, params.active, params.speed, params.voice, persistedSpeed, persistedVoice, resolvedLang, voicesForSelection]);

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
				{loggedIn && (
					<Select
						aria-label={l10n.getString('reader-read-aloud-voice-mode')}
						value={voiceMode ?? 'remote'}
						tabIndex="-1"
						onChange={handleVoiceModeChange}
					>
						<option value="remote">{l10n.getString('reader-read-aloud-voice-mode-remote')}</option>
						<option value="browser">{l10n.getString('reader-read-aloud-voice-mode-browser')}</option>
					</Select>
				)}
				{!loggedIn && (
					<div className="row log-in">
						<Localized id="reader-read-aloud-log-in" elems={{
							'log-in': <button data-l10n-name="log-in" onClick={onLogIn}></button>,
						}}>
							<span/>
						</Localized>
					</div>
				)}
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
				{!!voicesForSelection.length && (
					<div className="row voices" data-tabstop={1}>
						<Select
							aria-label={l10n.getString('reader-read-aloud-voice')}
							value={params.voice || ''}
							tabIndex="-1"
							onChange={handleVoiceChange}
						>
							{voicesForSelection.map((voice, i) => (
								<option key={i} value={voice.id}>{voice.label}</option>
							))}
							{voiceMode === 'browser' && <option value="more-voices">{l10n.getString('reader-read-aloud-more-voices')}</option>}
						</Select>
						<button className="help-button" aria-label={l10n.getString('general-help')}>?</button>
					</div>
				)}
				{secondsRemaining !== null && (
					<RemainingTime secondsRemaining={secondsRemaining} onOpenLearnMore={onOpenLearnMore}/>
				)}
			</>}
			{error !== null && error !== 'quota-exceeded' && (
				<ErrorMessage error={error}/>
			)}
		</UtilityPopup>
	);
}

function RemainingTime(props) {
	const { l10n } = useLocalization();

	let { secondsRemaining, onOpenLearnMore } = props;

	let secondsRemainingFormatted = useMemo(() => {
		if (secondsRemaining === null) return null;

		let hours = Math.floor(secondsRemaining / (60 * 60));
		let minutes = Math.floor(secondsRemaining / 60);
		let seconds = Math.floor(secondsRemaining % 60);

		if ('DurationFormat' in Intl) {
			return new Intl.DurationFormat(undefined, {
				style: 'digital',
				hoursDisplay: 'auto',
			}).format({ hours, minutes, seconds });
		}

		// Fall back to H:m:ss format if Intl.DurationFormat isn't available
		if (hours > 0) {
			return `${hours}:${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
		else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}, [secondsRemaining]);

	let urgent = secondsRemaining < URGENT_THRESHOLD_SECONDS;

	return (
		<div
			className="row remaining-time"
			aria-label={l10n.getString('reader-read-aloud-remaining-time')}
		>
			<div className={cx('time-indicator', { urgent })}>
				<IconClock/>
				{secondsRemainingFormatted}
				<button onClick={onOpenLearnMore}>{l10n.getString('reader-read-aloud-learn-more')}</button>
			</div>
			{urgent && (
				<div className="message">{l10n.getString('reader-read-aloud-low-credit-message')}</div>
			)}
		</div>
	);
}

function ErrorMessage(props) {
	const { l10n } = useLocalization();

	let { error } = props;

	return (
		<div
			className="row error"
			aria-label={l10n.getString('reader-read-aloud-error')}
		>
			{l10n.getString(`reader-read-aloud-error-${error}`)}
		</div>
	);
}

export default ReadAloudPopup;
