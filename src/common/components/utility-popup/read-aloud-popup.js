import React, { useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';

import UtilityPopup from './common/utility-popup';
import IconAdvancedOptions from '../../../../res/icons/20/advanced-options.svg';
import IconSkipBack from '../../../../res/icons/20/skip-back.svg';
import IconPlay from '../../../../res/icons/20/play.svg';
import IconPause from '../../../../res/icons/20/pause.svg';
import IconSkipAhead from '../../../../res/icons/20/skip-ahead.svg';
import IconSkipBackGranular from '../../../../res/icons/20/skip-back-granular.svg';
import IconSkipAheadGranular from '../../../../res/icons/20/skip-ahead-granular.svg';
import IconAnnotate from '../../../../res/icons/20/read-aloud-annotate.svg';
import IconLoading from '../../../../res/icons/16/loading.svg';
import IconClock from '../../../../res/icons/12/clock.svg';
import { Localized, useLocalization } from '@fluent/react';
import CustomSelect from '../common/custom-select';
import LanguageRegionSelect from '../../read-aloud/components/language-region-select';
import { RemoteReadAloudProvider } from '../../read-aloud/remote/provider';
import { BrowserReadAloudProvider } from '../../read-aloud/browser/provider';
import { getBaseLanguage, getPreferredRegion, resolveLanguage } from '../../read-aloud/lang';
import { getSupportedLanguages, getVoicesForLanguage, getVoiceRegion } from '../../read-aloud/voice';
import { useSamplePlayback } from '../../read-aloud/components/use-sample-playback';
import { useMediaControls } from '../../read-aloud/components/use-media-controls';
import { buildVoiceOptions } from '../../read-aloud/voice-options';
import { formatTimeRemaining } from '../../lib/format-time-remaining';

const URGENT_THRESHOLD_MINUTES = 3;

function ReadAloudPopup(props) {
	let { params, persistedVoices, remoteInterface, title, loggedIn, onChange, onSetVoice, onOpenVoicePreferences, onPurchaseCredits, onLogIn, onAddAnnotation, onLockPosition } = props;
	let controller = params.controller;

	let [showOptions, setShowOptions] = useState(false);
	let [selectedTier, setSelectedTier] = useState(null);
	let [allVoices, setAllVoices] = useState([]);
	let [isBuffering, setBuffering] = useState(false);
	let [showSpinner, setShowSpinner] = useState(false);
	let [minutesRemaining, setMinutesRemaining] = useState(null);
	let [isQuotaExceeded, setQuotaExceeded] = useState(false);
	let [isQuotaLow, setQuotaLow] = useState(false);
	let [hasStandardMinutesRemaining, setHasStandardMinutesRemaining] = useState(false);
	let [error, setError] = useState(null);
	let [devMode, setDevMode] = useState(false);

	let { playSample, stopSample } = useSamplePlayback();

	let tiers = useMemo(
		() => new Set(allVoices.map(v => v.tier)),
		[allVoices]
	);

	let voices = useMemo(
		() => allVoices.filter((voice) => {
			return selectedTier === null || voice.tier === selectedTier;
		}),
		[allVoices, selectedTier]
	);

	let languages = useMemo(
		() => getSupportedLanguages(voices),
		[voices]
	);

	let voicesForLanguage = useMemo(
		() => getVoicesForLanguage(voices, params.lang),
		[voices, params.lang]
	);

	let { voice: persistedVoice, region: persistedRegion, speed: persistedSpeed, tierVoices: persistedTierVoices } = useMemo(() => {
		let lang = resolveLanguage(params.lang, [...persistedVoices.keys()]);
		if (!lang) return {};
		return persistedVoices.get(lang) ?? {};
	}, [params.lang, persistedVoices]);

	let currentVoiceRegion = useMemo(() => {
		let voice = allVoices.find(v => v.id === params.voice);
		return voice ? getVoiceRegion(voice) : null;
	}, [allVoices, params.voice]);

	// Memoize the best fallback voice ID to avoid non-primitive useEffect deps
	let fallbackVoiceID = useMemo(() => {
		if (!voicesForLanguage.length) {
			console.log('Voice fallback: no voices for language, returning null');
			return null;
		}
		let targetTier = selectedTier;
		if (!targetTier && persistedTierVoices) {
			let persistedTier = Object.keys(persistedTierVoices).pop();
			if (persistedTier) {
				targetTier = persistedTier;
			}
		}
		console.log(`Voice fallback: targetTier = ${targetTier}, selectedTier = ${selectedTier}, lang = ${params.lang}, ${voicesForLanguage.length} voices for language`);
		// Stay within targetTier unless it has no voices for this language
		let pool = targetTier
			? voicesForLanguage.filter(v => v.tier === targetTier)
			: voicesForLanguage;
		if (!pool.length) {
			console.log(`Voice fallback: no voices in tier ${targetTier}, falling back to all ${voicesForLanguage.length} voices`);
			pool = voicesForLanguage;
		}
		let isAvailable = id => id && pool.some(v => v.id === id);
		// Skip persisted voice when user explicitly selected a different region
		let regionChanged = params.region && persistedRegion && params.region !== persistedRegion;

		// 1. Tier-specific voice for this language
		if (!regionChanged && isAvailable(persistedTierVoices?.[targetTier])) {
			console.log(`Voice fallback: using tier-specific voice ${persistedTierVoices[targetTier]}`);
			return persistedTierVoices[targetTier];
		}
		// 2. Last-used voice for this language
		if (!regionChanged && isAvailable(persistedVoice)) {
			console.log(`Voice fallback: using last-used voice ${persistedVoice}`);
			return persistedVoice;
		}
		// 3. First voice matching the selected, persisted, or preferred region
		let region = params.region || persistedRegion || getPreferredRegion(params.lang);
		if (region) {
			let regionMatch = pool.find(v => getVoiceRegion(v) === region);
			if (regionMatch) {
				console.log(`Voice fallback: using region match ${regionMatch.id} (region: ${region})`);
				return regionMatch.id;
			}
		}
		console.log(`Voice fallback: no match found, returning null (persistedVoice = ${persistedVoice}, region = ${region}, pool = ${pool.length})`);
		return null;
	}, [params.lang, params.region, persistedRegion, persistedTierVoices, persistedVoice, selectedTier, voicesForLanguage]);

	// Fall back to local when selected tier when it becomes unavailable
	useEffect(() => {
		if (selectedTier !== null && !tiers.has(selectedTier) && tiers.has('local')) {
			setSelectedTier('local');
		}
	}, [selectedTier, tiers, onChange]);

	let paramsRef = useRef(params);
	let pausedRef = useRef(params.paused);
	let pendingSetVoiceRef = useRef(false);
	useEffect(() => {
		paramsRef.current = params;
		pausedRef.current = params.paused;
	}, [params]);

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
		if (!voice || !voicesForLanguage.some(v => v.id === params.voice)) {
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
		let controller = voice.getController(params.segments, backwardStopIndex, params.forwardStopIndex);
		onChange({ controller });

		controller.addEventListener('BufferingChange', () => {
			setBuffering(controller.buffering);
		});
		controller.addEventListener('ActiveSegmentChanging', (event) => {
			onChange({ activeSegment: event.segment, lastSkipGranularity: controller.lastSkipGranularity });
		});
		controller.addEventListener('ActiveSegmentChange', (event) => {
			onChange({ activeSegment: event.segment, lastSkipGranularity: controller.lastSkipGranularity });
		});
		controller.addEventListener('Complete', () => {
			onChange({
				paused: true,
				activeSegment: null
			});
		});
		controller.addEventListener('Error', () => {
			if (controller.error === 'quota-exceeded' || controller.error === 'daily-limit-exceeded') {
				setShowOptions(true);
			}
			onChange({ paused: true });
			setError(controller.error);
		});
		controller.addEventListener('ErrorCleared', () => {
			setError(null);
		});

		setSelectedTier(voice.tier);
		setError(null);

		return () => {
			controller.destroy();
		};
	}, [allVoices, onChange, params.backwardStopIndex, params.forwardStopIndex, params.lang, params.segments, params.voice, voicesForLanguage]);

	useEffect(() => {
		if (!controller) return;
		// Guard against redundant sets -- the setter restarts audio playback,
		// and this effect also re-runs on controller change with unchanged speed.
		if (controller.speed !== params.speed) {
			controller.speed = params.speed;
		}
	}, [controller, params.speed]);

	// Reset language when it becomes unavailable
	useEffect(() => {
		let baseLang = getBaseLanguage(params.lang);
		if (languages.length && !languages.some(l => getBaseLanguage(l) === baseLang)) {
			let resolved = resolveLanguage(params.lang, languages) || languages[0];
			onChange({ lang: resolved, region: null, voice: null });
		}
	}, [languages, onChange, params.lang]);

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
		useSilentAudio: true,
		onSetPaused: (paused) => {
			if (!paused) {
				onLockPosition();
			}
			onChange({ paused });
		},
		onSkipBack: () => {
			controller?.skipBack();
			onLockPosition();
		},
		onSkipAhead: () => {
			controller?.skipAhead();
			onLockPosition();
		},
	});

	useEffect(() => {
		if (!controller) {
			setMinutesRemaining(null);
			setQuotaExceeded(false);
			setQuotaLow(false);
			setHasStandardMinutesRemaining(false);
			return undefined;
		}

		let updateRemaining = () => {
			setMinutesRemaining(controller.minutesRemaining);
			setHasStandardMinutesRemaining(controller.hasStandardMinutesRemaining);

			let isQuotaExceeded = controller.error === 'quota-exceeded';
			let isQuotaLow = isQuotaExceeded
				|| (controller.minutesRemaining !== null
					&& controller.minutesRemaining < URGENT_THRESHOLD_MINUTES);
			setQuotaExceeded(isQuotaExceeded);
			setQuotaLow(isQuotaLow);
			if (isQuotaExceeded) {
				onChange({ paused: true });
			}
			if (isQuotaLow) {
				setShowOptions(true);
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
				setDevMode(remoteProvider.devMode);
			}
		};
		fetchVoicesAndSet();

		return () => {
			cancelled = true;
		};
	}, [loggedIn, remoteInterface]);

	useEffect(() => {
		if (params.voice && voicesForLanguage.some(v => v.id === params.voice)) {
			return;
		}

		if (!voicesForLanguage.length) {
			console.log('Voice selection: no voices for language, skipping');
			return;
		}

		let speed = persistedSpeed || 1;
		let voiceID = fallbackVoiceID;
		if (!voiceID) {
			console.log(`Voice selection: no fallback voice, using first voice ${voicesForLanguage[0].id}`);
			voiceID = voicesForLanguage[0].id;
			speed = params.speed;
		}
		else {
			console.log(`Voice selection: using fallback voice ${voiceID} (persistedSpeed = ${persistedSpeed})`);
		}

		console.log(`Voice selection: setting voice = ${voiceID}, speed = ${speed}, active = ${voiceID !== params.voice ? false : params.active} (was voice: ${params.voice})`);
		onChange({
			voice: voiceID,
			speed,
			active: voiceID !== params.voice ? false : params.active,
		});
	}, [allVoices, fallbackVoiceID, onChange, params.active, params.lang, params.speed, params.voice, persistedSpeed, selectedTier, voicesForLanguage]);

	// Persist voice after a manual language change, once the voice selection
	// effect has resolved the new voice.
	useEffect(() => {
		if (pendingSetVoiceRef.current && params.voice) {
			pendingSetVoiceRef.current = false;
			let voice = allVoices.find(v => v.id === params.voice);
			let tier = selectedTier || voice?.tier;
			let region = voice ? getVoiceRegion(voice) : null;
			onSetVoice({ lang: getBaseLanguage(params.lang), region, voice: params.voice, speed: params.speed, tier });
		}
	}, [allVoices, onSetVoice, params.lang, params.speed, params.voice, selectedTier]);

	function handleTierChange(value) {
		setSelectedTier(value);
		let restoredVoice = persistedTierVoices?.[value] ?? null;
		pendingSetVoiceRef.current = true;
		onChange({ voice: restoredVoice });
	}

	function handleUserVoiceSelect(voiceID) {
		onChange({ voice: voiceID });
		let voice = allVoices.find(v => v.id === voiceID);
		let tier = selectedTier || voice?.tier;
		let region = voice ? getVoiceRegion(voice) : null;
		onSetVoice({ lang: getBaseLanguage(params.lang), region, voice: voiceID, speed: params.speed, tier });
	}

	function handleLangChange(fullLang) {
		let base = getBaseLanguage(fullLang);
		let region = fullLang.includes('-') ? fullLang.substring(base.length + 1) : null;
		pendingSetVoiceRef.current = true;
		onChange({ lang: base, region, voice: null });
	}

	async function handleResetCredits() {
		if (controller) {
			await controller.resetCredits();
			setMinutesRemaining(controller.minutesRemaining);
		}
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
				onLockPosition={onLockPosition}
			/>
			{showOptions && <>
				<SpeedSlider
					speed={params.speed}
					paused={params.paused}
					onChange={onChange}
					onSetVoice={onSetVoice}
					lang={getBaseLanguage(params.lang)}
					region={currentVoiceRegion}
					voice={params.voice}
					tier={selectedTier}
				/>
				<TierSelect
					loggedIn={loggedIn}
					value={selectedTier}
					tiers={tiers}
					onChange={handleTierChange}
					onLogIn={onLogIn}
				/>
				<LanguageRegionSelect
					languages={languages}
					lang={currentVoiceRegion ? `${params.lang}-${currentVoiceRegion}` : params.lang}
					onLangChange={handleLangChange}
					tabIndex="-1"
				/>
				<VoiceSelect
					params={params}
					voices={voicesForLanguage}
					playSample={playSample}
					onChange={handleUserVoiceSelect}
					onOpenVoicePreferences={selectedTier === 'local' ? onOpenVoicePreferences : null}
				/>
				<RemainingTime
					minutesRemaining={minutesRemaining}
					isQuotaExceeded={isQuotaExceeded}
					isQuotaLow={isQuotaLow}
					switchTo={hasStandardMinutesRemaining ? 'standard' : 'local'}
					devMode={devMode}
					onPurchaseCredits={onPurchaseCredits}
					onResetCredits={handleResetCredits}
				/>
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

	let { showOptions, onToggleOptions, showSpinner, paused, onPlayPause, controller, onAddAnnotation, onLockPosition } = props;
	let [altDown, setAltDown] = useState(false);

	useEffect(() => {
		let handleKey = (event) => {
			setAltDown(event.altKey);
		};
		window.addEventListener('keydown', handleKey);
		window.addEventListener('keyup', handleKey);
		return () => {
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('keyup', handleKey);
		};
	}, []);

	function handleAddAnnotation() {
		let segment = controller?.getSegmentToAnnotate();
		if (segment) {
			onAddAnnotation(segment);
		}
	}

	return (
		<div
			className="row buttons"
			data-tabstop={1}
			onMouseMove={event => setAltDown(event.altKey)}
		>
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
						onLockPosition();
					}}
				>{altDown ? <IconSkipBackGranular/> : <IconSkipBack/>}</button>
				{showSpinner
					? <IconLoading
						className="loading-spinner"
						aria-busy={true}
					/>
					: <button
						className="toolbar-button"
						title={l10n.getString(`reader-read-aloud-${paused ? 'play' : 'pause'}`)}
						tabIndex="-1"
						onClick={() => {
							if (paused) {
								onLockPosition();
							}
							onPlayPause();
						}}
					>{paused ? <IconPlay/> : <IconPause/>}</button>
				}
				<button
					className="toolbar-button"
					title={l10n.getString('reader-read-aloud-skip-ahead')}
					tabIndex="-1"
					onClick={(event) => {
						controller?.skipAhead(event.altKey ? 'sentence' : 'paragraph', event.shiftKey);
						onLockPosition();
					}}
				>{altDown ? <IconSkipAheadGranular/> : <IconSkipAhead/>}</button>
			</div>
			<div className="group">
				<button
					className="toolbar-button"
					title={l10n.getString('reader-read-aloud-add-annotation', { key1: 'H', key2: 'U' })}
					tabIndex="-1"
					onClick={handleAddAnnotation}
				><IconAnnotate/></button>
			</div>
		</div>
	);
}

function SpeedSlider(props) {
	const { l10n } = useLocalization();

	let { speed, paused, onChange, onSetVoice, lang, region, voice, tier } = props;
	let [speedWhileDragging, setSpeedWhileDragging] = useState(null);
	let draggingRef = useRef(false);
	let wasPlayingRef = useRef(false);
	let isLocal = tier === 'local';

	function handleSpeedChange(event) {
		let newSpeed = parseFloat(event.target.value);
		if (!draggingRef.current) {
			onChange({ speed: newSpeed });
			onSetVoice({ lang, region, voice, speed: newSpeed, tier });
		}
		else if (isLocal) {
			setSpeedWhileDragging(newSpeed);
		}
		else {
			onChange({ speed: newSpeed });
		}
	}

	function handleSpeedPointerDown() {
		draggingRef.current = true;
		if (isLocal) {
			setSpeedWhileDragging(speed);
			wasPlayingRef.current = !paused;
			if (!paused) {
				onChange({ paused: true });
			}
		}
	}

	function handleSpeedPointerUp() {
		if (!draggingRef.current) {
			return;
		}
		draggingRef.current = false;
		if (isLocal) {
			let newSpeed = speedWhileDragging;
			setSpeedWhileDragging(null);
			let changes = {};
			if (newSpeed !== null && newSpeed !== speed) {
				changes.speed = newSpeed;
			}
			if (wasPlayingRef.current) {
				changes.paused = false;
			}
			if (Object.keys(changes).length) {
				onChange(changes);
			}
			onSetVoice({ lang, region, voice, speed: newSpeed ?? speed, tier });
		}
		else {
			onSetVoice({ lang, region, voice, speed, tier });
		}
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

function TierSelect(props) {
	const { l10n } = useLocalization();

	let { loggedIn, value, tiers, onChange, onLogIn } = props;

	let options = [];
	if (loggedIn) {
		options.push(
			{ value: 'standard', label: l10n.getString('reader-read-aloud-voice-tier-standard'), disabled: !tiers.has('standard') },
			{ value: 'premium', label: l10n.getString('reader-read-aloud-voice-tier-premium'), disabled: !tiers.has('premium') },
		);
	}
	options.push(
		{ value: 'local', label: l10n.getString('reader-read-aloud-voice-tier-local'), disabled: !tiers.has('local') },
	);

	if (loggedIn || options.length > 1) {
		return (
			<CustomSelect
				aria-label={l10n.getString('reader-read-aloud-voice-tier')}
				value={value ?? 'premium'}
				tabIndex="-1"
				onChange={onChange}
				options={options}
			/>
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

	let { params, voices, playSample, onChange, onOpenVoicePreferences } = props;

	function handleVoiceChange(optionValue) {
		if (optionValue === 'more-voices') {
			onOpenVoicePreferences?.();
			return;
		}
		onChange(optionValue);
		if (params.paused) {
			let voice = voices.find(v => v.id === optionValue);
			if (voice) {
				playSample(voice);
			}
		}
	}

	if (!voices.length) {
		return null;
	}

	let { options, selectedValue } = buildVoiceOptions(voices, params.voice);
	if (onOpenVoicePreferences) {
		options.push({ value: 'more-voices', label: l10n.getString('reader-read-aloud-more-voices') });
	}

	return (
		<div className="row voices" data-tabstop={1}>
			<CustomSelect
				aria-label={l10n.getString('reader-read-aloud-voice')}
				value={selectedValue}
				tabIndex="-1"
				onChange={handleVoiceChange}
				showSecondaryLabelOnMenu
				options={options}
			/>
		</div>
	);
}

function RemainingTime(props) {
	const { l10n } = useLocalization();

	let { minutesRemaining, isQuotaExceeded, isQuotaLow, switchTo, onPurchaseCredits, devMode, onResetCredits } = props;

	let remainingFormatted = useMemo(
		() => formatTimeRemaining(minutesRemaining),
		[minutesRemaining]
	);

	if (remainingFormatted === null) {
		return null;
	}

	return (
		<div
			className="row remaining-time"
			aria-label={l10n.getString('reader-read-aloud-remaining-time')}
		>
			<div className={cx('time-indicator', { urgent: isQuotaLow })}>
				<IconClock/>
				{devMode
					? <button className="reset" onClick={onResetCredits}>{remainingFormatted}</button>
					: remainingFormatted}
				{!isQuotaExceeded && (
					<button className="purchase-credits" onClick={onPurchaseCredits}>
						{l10n.getString('reader-read-aloud-add-more-time')}
					</button>
				)}
			</div>
			{isQuotaExceeded && (
				<Localized id="reader-read-aloud-quota-exceeded-message" elems={{
					'add-more-time': <button onClick={onPurchaseCredits}/>,
				}} vars={{ tier: switchTo }}>
					<div className="message"/>
				</Localized>
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
