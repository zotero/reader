import React, { useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';

import UtilityPopup from './common/utility-popup';
import IconAdvancedOptions from '../../../../res/icons/20/advanced-options.svg';
import IconSkipBack from '../../../../res/icons/20/skip-back.svg';
import IconPlay from '../../../../res/icons/20/play.svg';
import IconPause from '../../../../res/icons/20/pause.svg';
import IconSkipAhead from '../../../../res/icons/20/skip-ahead.svg';
import IconAnnotate from '../../../../res/icons/20/read-aloud-annotate.svg';
import IconLoading from '../../../../res/icons/16/loading.svg';
import IconClock from '../../../../res/icons/12/clock.svg';
import { Localized, useLocalization } from '@fluent/react';
import Select from '../common/select';
import LanguageRegionSelect from '../../read-aloud/components/language-region-select';
import { RemoteReadAloudProvider } from '../../read-aloud/remote/provider';
import { BrowserReadAloudProvider } from '../../read-aloud/browser/provider';
import { BrowserReadAloudVoice } from '../../read-aloud/browser/voice';
import { getAllRegions, getSupportedLanguages, getVoicesForLanguage, resolveLanguage } from '../../read-aloud/lang';
import { useSamplePlayback } from '../../read-aloud/components/use-sample-playback';
import { useMediaControls } from '../../read-aloud/components/use-media-controls';

const URGENT_THRESHOLD_SECONDS = 3 * 60;

function ReadAloudPopup(props) {
	let { params, voices: persistedVoices, remoteInterface, title, loggedIn, onChange, onSetVoice, onOpenVoicePreferences, onOpenLearnMore, onLogIn, onAddAnnotation, onSkip } = props;
	let controller = params.controller;

	let [showOptions, setShowOptions] = useState(false);
	let [voiceMode, setVoiceMode] = useState(null);
	let [allVoices, setAllVoices] = useState([]);
	let [isBuffering, setBuffering] = useState(false);
	let [showSpinner, setShowSpinner] = useState(false);
	let [secondsRemaining, setSecondsRemaining] = useState(null);
	let [error, setError] = useState(null);
	let [pausedAfterQuotaExhausted, setPausedAfterQuotaExhausted] = useState(false);

	let { playSample, stopSample } = useSamplePlayback();

	let voicesForMode = useMemo(
		() => allVoices.filter((voice) => {
			let voiceModeHere = voice instanceof BrowserReadAloudVoice ? 'browser' : 'remote';
			return voiceMode === null || voiceModeHere === voiceMode;
		}),
		[allVoices, voiceMode]
	);

	let currentLanguages = useMemo(
		() => getSupportedLanguages(voicesForMode),
		[voicesForMode]
	);

	let availableRegions = useMemo(
		() => getAllRegions(voicesForMode),
		[voicesForMode]
	);

	let effectiveLang = useMemo(
		() => (params.region ? `${params.lang}-${params.region}` : params.lang),
		[params.lang, params.region]
	);

	let voicesForSelection = useMemo(
		() => getVoicesForLanguage(voicesForMode, effectiveLang),
		[voicesForMode, effectiveLang]
	);

	let { voice: persistedVoice, region: persistedRegion, speed: persistedSpeed } = useMemo(() => {
		let lang = resolveLanguage(params.lang, Object.keys(persistedVoices));
		if (!lang) return {};
		return persistedVoices.get(lang) ?? {};
	}, [params.lang, persistedVoices]);

	let paramsRef = useRef(params);
	let pausedRef = useRef(params.paused);
	let pausedAfterQuotaExhaustedRef = useRef(pausedAfterQuotaExhausted);
	let effectiveLangRef = useRef(effectiveLang);
	useEffect(() => {
		paramsRef.current = params;
		pausedRef.current = params.paused;
	}, [params]);
	useEffect(() => {
		pausedAfterQuotaExhaustedRef.current = pausedAfterQuotaExhausted;
	}, [pausedAfterQuotaExhausted]);
	useEffect(() => {
		effectiveLangRef.current = effectiveLang;
	}, [effectiveLang]);

	useEffect(() => {
		let showBufferingSpinner = !params.segments || isBuffering;
		if (!showBufferingSpinner) {
			setShowSpinner(false);
			return undefined;
		}
		let timeout = setTimeout(() => setShowSpinner(showBufferingSpinner), 250);
		return () => clearTimeout(timeout);
	}, [isBuffering, params.segments]);

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
		// Use ref to access activeSegment so we don't rerun when it changes
		if (params.segments && paramsRef.current.activeSegment && params.segments.includes(paramsRef.current.activeSegment)) {
			backwardStopIndex = params.segments.indexOf(paramsRef.current.activeSegment);
		}
		let controller = voice.getController(effectiveLangRef.current, params.segments, backwardStopIndex, params.forwardStopIndex);
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
		controller.addEventListener('Error', () => {
			if (controller.error === 'quota-exceeded') {
				setShowOptions(true);
			}
			onChange({ paused: true });
			setError(controller.error);
		});
		controller.addEventListener('ErrorCleared', () => {
			setError(null);
		});

		let voiceMode = voice instanceof BrowserReadAloudVoice ? 'browser' : 'remote';
		setVoiceMode(voiceMode);
		setError(null);

		return () => {
			controller.destroy();
		};
	}, [allVoices, onChange, params.backwardStopIndex, params.forwardStopIndex, params.lang, params.region, params.segments, params.voice]);

	useEffect(() => {
		if (!controller) return;
		controller.speed = params.speed;
	}, [controller, params.speed]);

	// Reset region when it becomes unavailable
	useEffect(() => {
		let regionsForLang = availableRegions[params.lang] || [];
		if (params.region && !regionsForLang.includes(params.region)) {
			onChange({ region: null, voice: null });
		}
	}, [availableRegions, onChange, params.lang, params.region]);

	useEffect(() => {
		if (!controller) {
			return;
		}
		controller.paused = params.paused;
	}, [controller, params.paused]);

	useEffect(() => {
		if (!params.paused) {
			stopSample();
		}
	}, [params.paused, stopSample]);

	useMediaControls({
		active: !!controller,
		title,
		paused: params.paused,
		speed: params.speed,
		useSilentAudio: voiceMode === 'browser',
		onSetPaused: paused => onChange({ paused }),
		onSkipBack: () => {
			controller?.skipBack();
			onSkip();
		},
		onSkipAhead: () => {
			controller?.skipAhead();
			onSkip();
		},
	});

	useEffect(() => {
		if (!controller) {
			setSecondsRemaining(null);
			return undefined;
		}

		let updateRemaining = () => {
			setSecondsRemaining(controller.secondsRemaining);

			let isQuotaExhausted = controller.error === 'quota-exhausted';
			let isQuotaLow = isQuotaExhausted
				|| (controller.secondsRemaining !== null
					&& controller.secondsRemaining < URGENT_THRESHOLD_SECONDS);
			if (isQuotaLow) {
				setShowOptions(true);
			}
			if (isQuotaExhausted && !paramsRef.current.paused) {
				if (pausedAfterQuotaExhaustedRef.current) {
					setVoiceMode('browser');
				}
				else {
					onChange({ paused: true });
					setPausedAfterQuotaExhausted(true);
				}
			}
		};
		updateRemaining();

		let interval = setInterval(updateRemaining, 10_000);
		return () => clearInterval(interval);
	}, [controller, params.paused, onChange]);

	useEffect(() => {
		if (!controller) {
			return undefined;
		}
		let interval = setInterval(() => controller.refreshCreditsRemaining(), 60_000);
		return () => clearInterval(interval);
	}, [controller]);

	useEffect(() => {
		let cancelled = false;

		let fetchVoicesAndSet = async () => {
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
			if (!cancelled) {
				setAllVoices([...remoteVoices, ...browserVoices]);
			}
		};
		fetchVoicesAndSet();

		return () => {
			cancelled = true;
		};
	}, [loggedIn, remoteInterface]);

	useEffect(() => {
		if (params.voice && voicesForSelection.some(v => v.id === params.voice)) {
			onSetVoice(params.lang, params.region, params.voice, params.speed);
			return;
		}

		let voice = persistedVoice;
		let region = params.region || persistedRegion || '';
		let speed = persistedSpeed || 1;
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
		onSetVoice(params.lang, region, voice, params.speed);
	}, [onChange, onSetVoice, params.active, params.lang, params.region, params.speed, params.voice, persistedRegion, persistedSpeed, persistedVoice, voicesForSelection]);

	function handleVoiceModeChange(event) {
		setVoiceMode(event.target.value);
		onChange({ voice: null });
	}

	function handleLangChange(lang) {
		onChange({ lang, region: null, voice: null });
	}

	function handleRegionChange(region) {
		onChange({ region, voice: null });
	}

	return (
		<UtilityPopup className={cx('read-aloud-popup', { expanded: showOptions })}>
			<PlaybackControls
				showOptions={showOptions}
				onToggleOptions={() => setShowOptions(!showOptions)}
				showSpinner={showSpinner}
				paused={params.paused}
				onPlayPause={() => onChange({ paused: !params.paused })}
				controller={controller}
				onAddAnnotation={onAddAnnotation}
				onSkip={onSkip}
			/>
			{showOptions && <>
				<SpeedSlider
					speed={params.speed}
					onChange={onChange}
					onSetVoice={onSetVoice}
					lang={params.lang}
					region={params.region}
					voice={params.voice}
					paused={params.paused}
					pausedRef={pausedRef}
				/>
				<VoiceModeSelect
					loggedIn={loggedIn}
					voiceMode={voiceMode}
					onVoiceModeChange={handleVoiceModeChange}
					onLogIn={onLogIn}
				/>
				<LanguageRegionSelect
					languages={currentLanguages}
					regions={availableRegions}
					lang={params.lang}
					region={params.region}
					onLangChange={handleLangChange}
					onRegionChange={handleRegionChange}
					tabIndex="-1"
				/>
				<VoiceSelect
					voices={voicesForSelection}
					voiceMode={voiceMode}
					selectedVoice={params.voice}
					effectiveLang={effectiveLang}
					onOpenVoicePreferences={onOpenVoicePreferences}
					playSample={playSample}
					onChange={onChange}
				/>
				{secondsRemaining !== null && (
					<RemainingTime secondsRemaining={secondsRemaining} onOpenLearnMore={onOpenLearnMore}/>
				)}
			</>}
			{error !== null && error !== 'quota-exceeded' && (
				<ErrorMessage error={error} onRetry={controller?.retry
					? () => {
						onChange({ paused: false });
						controller.retry();
					}
					: null}/>
			)}
		</UtilityPopup>
	);
}

function PlaybackControls(props) {
	const { l10n } = useLocalization();

	let { showOptions, onToggleOptions, showSpinner, paused, onPlayPause, controller, onAddAnnotation, onSkip } = props;

	function handleAddAnnotation() {
		let segment = controller?.getSegmentToAnnotate();
		if (segment) {
			onAddAnnotation(segment);
		}
	}

	return (
		<div className="row buttons" data-tabstop={1}>
			<div className="group">
				<button
					className={cx('toolbar-button', { active: showOptions })}
					title={l10n.getString('reader-read-aloud-options')}
					tabIndex="-1"
					onClick={onToggleOptions}
				><IconAdvancedOptions/></button>
			</div>
			<div className="group">
				<button
					className="toolbar-button"
					title={l10n.getString('reader-read-aloud-skip-back')}
					tabIndex="-1"
					onClick={(event) => {
						controller?.skipBack(event.altKey ? 'sentence' : 'paragraph', event.shiftKey);
						onSkip();
					}}
				><IconSkipBack/></button>
				{showSpinner
					? <IconLoading
						className="loading-spinner"
						aria-busy={true}
					/>
					: <button
						className="toolbar-button"
						title={l10n.getString(`reader-read-aloud-${paused ? 'play' : 'pause'}`)}
						tabIndex="-1"
						onClick={onPlayPause}
					>{paused ? <IconPlay/> : <IconPause/>}</button>
				}
				<button
					className="toolbar-button"
					title={l10n.getString('reader-read-aloud-skip-ahead')}
					tabIndex="-1"
					onClick={(event) => {
						controller?.skipAhead(event.altKey ? 'sentence' : 'paragraph', event.shiftKey);
						onSkip();
					}}
				><IconSkipAhead/></button>
			</div>
			<div className="group">
				<button
					className="toolbar-button"
					title={l10n.getString('reader-read-aloud-add-annotation')}
					tabIndex="-1"
					onClick={handleAddAnnotation}
				><IconAnnotate/></button>
			</div>
		</div>
	);
}

function SpeedSlider(props) {
	const { l10n } = useLocalization();

	let { speed, onChange, onSetVoice, lang, region, voice, paused, pausedRef } = props;
	let [speedWhileDragging, setSpeedWhileDragging] = useState(null);

	function handleSpeedChange(event) {
		if (speedWhileDragging === null) {
			let newSpeed = parseFloat(event.target.value);
			onChange({ speed: newSpeed });
			onSetVoice(lang, region, voice, newSpeed);
		}
		else {
			setSpeedWhileDragging(parseFloat(event.target.value));
		}
	}

	function handleSpeedPointerDown() {
		setSpeedWhileDragging(speed);
	}

	async function handleSpeedPointerUp() {
		// Capture all values before awaiting to avoid race conditions
		let newSpeed = speedWhileDragging;
		if (newSpeed === null) {
			return;
		}
		let wasPaused = pausedRef.current;

		if (!wasPaused) {
			// Pause, then wait momentarily, because otherwise Web Speech
			// will read multiple lines at once
			onChange({ paused: true });
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		onChange({ speed: newSpeed, paused: wasPaused });
		onSetVoice(lang, region, voice, newSpeed);
		setSpeedWhileDragging(null);
	}

	return (
		<div className="row speed" data-tabstop={1}>
			<input
				id="read-aloud-speed"
				aria-label={l10n.getString('reader-read-aloud-speed')}
				type="range"
				min="0.5"
				max="2.0"
				step="0.1"
				value={speedWhileDragging ?? speed}
				tabIndex="-1"
				onChange={handleSpeedChange}
				onPointerDown={handleSpeedPointerDown}
				onPointerUp={handleSpeedPointerUp}
				onPointerCancel={handleSpeedPointerUp}
			/>
			<label htmlFor="read-aloud-speed">{(speedWhileDragging ?? speed).toFixed(1)}×</label>
		</div>
	);
}

function VoiceModeSelect(props) {
	const { l10n } = useLocalization();

	let { loggedIn, voiceMode, onVoiceModeChange, onLogIn } = props;

	if (loggedIn) {
		return (
			<Select
				aria-label={l10n.getString('reader-read-aloud-voice-mode')}
				value={voiceMode ?? 'remote'}
				tabIndex="-1"
				onChange={onVoiceModeChange}
			>
				<option value="remote">{l10n.getString('reader-read-aloud-voice-mode-remote')}</option>
				<option value="browser">{l10n.getString('reader-read-aloud-voice-mode-browser')}</option>
			</Select>
		);
	}

	return (
		<div className="row log-in">
			<Localized id="reader-read-aloud-log-in-link" elems={{
				'log-in': <button data-l10n-name="log-in" onClick={onLogIn}></button>,
			}}>
				<span/>
			</Localized>
		</div>
	);
}

function VoiceSelect(props) {
	const { l10n } = useLocalization();

	let { voices, voiceMode, selectedVoice, effectiveLang, onVoiceChange, onOpenVoicePreferences, playSample, onChange } = props;

	function handleVoiceChange(event) {
		if (event.target.value === 'more-voices') {
			onOpenVoicePreferences();
			return;
		}
		let voiceId = event.target.value;
		let voice = voices.find(v => v.id === voiceId);
		onChange({ voice: voiceId, paused: true });
		if (voice) {
			playSample(voice, effectiveLang);
		}
	}

	if (!voices.length) {
		return null;
	}

	return (
		<div className="row voices" data-tabstop={1}>
			<Select
				aria-label={l10n.getString('reader-read-aloud-voice')}
				value={selectedVoice || ''}
				tabIndex="-1"
				onChange={handleVoiceChange}
			>
				{voices.map((voice, i) => (
					<option key={i} value={voice.id}>{voice.label}</option>
				))}
				{voiceMode === 'browser' && <option value="more-voices">{l10n.getString('reader-read-aloud-more-voices')}</option>}
			</Select>
			<button className="help-button" aria-label={l10n.getString('general-help')}>?</button>
		</div>
	);
}

function RemainingTime(props) {
	const { l10n } = useLocalization();

	let { secondsRemaining, onOpenLearnMore } = props;

	let remainingFormatted = useMemo(() => {
		if (secondsRemaining === null) return null;

		let hours = Math.floor(secondsRemaining / (60 * 60));
		let minutes = Math.ceil((secondsRemaining % (60 * 60)) / 60);

		if ('DurationFormat' in Intl) {
			return new Intl.DurationFormat(undefined, {
				style: 'narrow',
				hoursDisplay: 'auto',
				minutesDisplay: 'always',
			}).format({ hours, minutes });
		}

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		else {
			return `${minutes}m`;
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
				{remainingFormatted}
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

	let { error, onRetry } = props;

	return (
		<div
			className="row error"
			aria-label={l10n.getString('reader-read-aloud-error')}
		>
			{l10n.getString(`reader-read-aloud-error-${error}`)}
			{onRetry && (
				<button onClick={onRetry}>{l10n.getString('reader-read-aloud-retry')}</button>
			)}
		</div>
	);
}

export default ReadAloudPopup;
