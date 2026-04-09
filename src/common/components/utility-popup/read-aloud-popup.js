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
import CustomSelect from '../common/custom-select';
import LanguageRegionSelect from '../../read-aloud/components/language-region-select';
import { getBaseLanguage } from '../../read-aloud/lang';
import { useSamplePlayback } from '../../read-aloud/components/use-sample-playback';
import { useMediaControls } from '../../read-aloud/components/use-media-controls';
import { buildVoiceOptions } from '../../read-aloud/voice-options';
import { formatTimeRemaining } from '../../lib/format-time-remaining';

function ReadAloudPopup(props) {
	let { manager, title, loggedIn, onOpenVoicePreferences, onPurchaseCredits, onLogIn, onAddAnnotation, onLockPosition } = props;

	let [showOptions, setShowOptions] = useState(false);
	let [showSpinner, setShowSpinner] = useState(false);

	let { playSample, stopSample } = useSamplePlayback();

	let allVoices = manager.allVoices;
	let active = manager.active;
	let selectedTier = manager.selectedTier;
	let selectedVoiceID = manager.selectedVoiceID;
	let tiers = manager.tiers;
	let languages = manager.languages;
	let voicesForLanguage = manager.voicesForLanguage;
	let currentVoiceRegion = manager.currentVoiceRegion;
	let lang = manager.lang;
	let paused = manager.paused;
	let speed = manager.speed;
	let buffering = manager.buffering;
	let segments = manager.segments;
	let error = manager.error;
	let minutesRemaining = manager.minutesRemaining;
	let isQuotaExceeded = manager.isQuotaExceeded;
	let isQuotaLow = manager.isQuotaLow;
	let hasStandardMinutesRemaining = manager.hasStandardMinutesRemaining;
	let devMode = manager.devMode;

	useEffect(() => {
		let showBufferingSpinner = !segments || buffering;
		if (!showBufferingSpinner) {
			setShowSpinner(false);
			return undefined;
		}
		let timeout = setTimeout(() => setShowSpinner(showBufferingSpinner), 250);
		return () => clearTimeout(timeout);
	}, [buffering, segments]);

	useEffect(() => {
		if (error === 'quota-exceeded' || error === 'daily-limit-exceeded' || isQuotaLow) {
			setShowOptions(true);
		}
	}, [error, isQuotaLow]);

	useEffect(() => {
		if (!paused) {
			stopSample();
		}
	}, [paused, stopSample]);

	useMediaControls({
		active,
		title,
		paused,
		speed,
		useSilentAudio: true,
		onSetPaused: (paused) => {
			if (!paused) {
				onLockPosition();
			}
			if (paused) {
				manager.pause();
			}
			else {
				manager.play();
			}
		},
		onSkipBack: () => {
			manager.skipBack();
			onLockPosition();
		},
		onSkipAhead: () => {
			manager.skipAhead();
			onLockPosition();
		},
	});

	function handleTierChange(value) {
		manager.selectTier(value);
	}

	function handleUserVoiceSelect(voiceID) {
		manager.selectVoice(voiceID);
		if (paused) {
			let voice = allVoices.find(v => v.id === voiceID);
			if (voice) {
				playSample(voice);
			}
		}
	}

	function handleLangChange(fullLang) {
		let base = getBaseLanguage(fullLang);
		let region = fullLang.includes('-') ? fullLang.substring(base.length + 1) : null;
		manager.setLanguage(base, { region, persist: true });
	}

	async function handleResetCredits() {
		await manager.resetCredits();
	}

	return (
		<UtilityPopup className={cx('read-aloud-popup', { expanded: showOptions })}>
			<PlaybackControls
				showOptions={showOptions}
				onToggleOptions={() => setShowOptions(!showOptions)}
				showSpinner={showSpinner}
				paused={paused}
				onPlayPause={() => manager.togglePaused()}
				onSkipBack={(granularity, accelerate) => {
					manager.skipBack(granularity, accelerate);
					onLockPosition();
				}}
				onSkipAhead={(granularity, accelerate) => {
					manager.skipAhead(granularity, accelerate);
					onLockPosition();
				}}
				onAddAnnotation={() => {
					let segment = manager.getSegmentToAnnotate();
					if (segment) {
						onAddAnnotation(segment);
					}
				}}
				onLockPosition={onLockPosition}
			/>
			{showOptions && <>
				<SpeedSlider
					speed={speed}
					paused={paused}
					isLocal={selectedTier === 'local'}
					onSetSpeed={(s) => manager.setSpeed(s)}
					onPersistSpeed={() => manager.setSpeed(manager.speed, true)}
					onPause={() => manager.pause()}
					onPlay={() => manager.play()}
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
					lang={currentVoiceRegion ? `${lang}-${currentVoiceRegion}` : lang}
					onLangChange={handleLangChange}
					tabIndex="-1"
				/>
				<VoiceSelect
					voiceID={selectedVoiceID}
					voices={voicesForLanguage}
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
				<ErrorMessage error={error} onRetry={() => manager.retry()}/>
			)}
		</UtilityPopup>
	);
}

function PlaybackControls(props) {
	const { l10n } = useLocalization();

	let { showOptions, onToggleOptions, showSpinner, paused, onPlayPause, onSkipBack, onSkipAhead, onAddAnnotation, onLockPosition } = props;

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
						onSkipBack(event.altKey ? 'sentence' : 'paragraph', event.shiftKey);
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
						onSkipAhead(event.altKey ? 'sentence' : 'paragraph', event.shiftKey);
					}}
				><IconSkipAhead/></button>
			</div>
			<div className="group">
				<button
					className="toolbar-button"
					title={l10n.getString('reader-read-aloud-add-annotation', { key1: 'H', key2: 'U' })}
					tabIndex="-1"
					onClick={onAddAnnotation}
				><IconAnnotate/></button>
			</div>
		</div>
	);
}

function SpeedSlider(props) {
	const { l10n } = useLocalization();

	let { speed, paused, isLocal, onSetSpeed, onPersistSpeed, onPause, onPlay } = props;
	let [speedWhileDragging, setSpeedWhileDragging] = useState(null);
	let draggingRef = useRef(false);
	let wasPlayingRef = useRef(false);

	function handleSpeedChange(event) {
		let newSpeed = parseFloat(event.target.value);
		if (!draggingRef.current) {
			onSetSpeed(newSpeed);
			onPersistSpeed();
		}
		else if (isLocal) {
			// Local voices pause during drag, so just update the display value
			setSpeedWhileDragging(newSpeed);
		}
		else {
			// Remote voices apply speed changes live during drag
			onSetSpeed(newSpeed);
		}
	}

	function handleSpeedPointerDown() {
		draggingRef.current = true;
		if (isLocal) {
			setSpeedWhileDragging(speed);
			wasPlayingRef.current = !paused;
			if (!paused) {
				onPause();
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
			if (newSpeed !== null && newSpeed !== speed) {
				onSetSpeed(newSpeed);
			}
			if (wasPlayingRef.current) {
				onPlay();
			}
		}
		// Persist whatever speed the manager currently has.
		// Don't re-set it, because that could restart the current segment.
		onPersistSpeed();
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

	let { voiceID, voices, onChange, onOpenVoicePreferences } = props;

	function handleVoiceChange(optionValue) {
		if (optionValue === 'more-voices') {
			onOpenVoicePreferences?.();
			return;
		}
		onChange(optionValue);
	}

	if (!voices.length) {
		return null;
	}

	let { options, selectedValue } = buildVoiceOptions(voices, voiceID);
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
