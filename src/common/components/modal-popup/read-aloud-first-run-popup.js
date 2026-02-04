import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';
import { BulletList } from '../../read-aloud/components/bullet-list';
import CustomSelect from '../common/custom-select';
import LanguageRegionSelect from '../../read-aloud/components/language-region-select';
import { useVoiceData } from '../../read-aloud/components/use-voice-data';
import { getPreferredRegion } from '../../read-aloud/lang';
import { getVoicesForLanguage, getVoiceRegion, TIERS } from '../../read-aloud/voice';
import { useSamplePlayback } from '../../read-aloud/components/use-sample-playback';
import { buildVoiceOptions } from '../../read-aloud/voice-options';
import cx from 'classnames';
import IconLoading from '../../../../res/icons/16/loading.svg';
import IconPlayFill from '../../../../res/icons/16/play-fill.svg';
import IconChevronLeft from '../../../../res/icons/20/chevron-left.svg';
import IconChevronRight from '../../../../res/icons/20/chevron-right.svg';

function VoicePreview({ voices, active, selectedVoice, lang, onSetVoice }) {
	const { l10n } = useLocalization();

	let { playSample, stopSample, playing, buffering } = useSamplePlayback();
	let [autoplay, setAutoplay] = useState(false);

	useEffect(() => {
		if (voices.length > 0 && !selectedVoice) {
			let preferredRegion = getPreferredRegion(lang);
			let voice = preferredRegion
				? voices.find(v => getVoiceRegion(v) === preferredRegion)
				: null;
			onSetVoice(voice || voices[0]);
		}
	}, [voices, onSetVoice, selectedVoice, lang]);

	useEffect(() => {
		if (!active) {
			stopSample();
		}
	}, [active, stopSample]);

	let playSampleWithVoice = useCallback(() => {
		playSample(selectedVoice);
	}, [playSample, selectedVoice]);

	function playOrStopSample() {
		if (playing) {
			stopSample();
		}
		else {
			playSampleWithVoice();
		}
	}

	function handleVoiceChange(optionValue) {
		let voice = voices.find(v => v.id === optionValue);
		if (voice) {
			onSetVoice(voice);
			setAutoplay(true);
		}
	}

	useEffect(() => {
		if (autoplay) {
			playSampleWithVoice();
			setAutoplay(false);
		}
	}, [autoplay, playSampleWithVoice]);

	// Restart playback when language changes
	let prevLangRef = useRef(lang);
	useEffect(() => {
		if (prevLangRef.current !== lang) {
			prevLangRef.current = lang;
			if (active && selectedVoice) {
				setAutoplay(true);
			}
		}
	}, [active, lang, selectedVoice]);

	let { options, selectedValue } = buildVoiceOptions(voices, lang, selectedVoice?.id);

	return (
		<div className="voice-preview">
			<div className="controls">
				<button
					className="voice-switcher"
					disabled={!voices.length || selectedVoice === voices[0]}
					type="button"
					onClick={() => handleVoiceChange(voices[voices.indexOf(selectedVoice) - 1]?.id)}
				>
					<IconChevronLeft/>
				</button>
				<div className="select-wrapper">
					<button
						className={cx('play', { playing, buffering })}
						title={l10n.getString('reader-read-aloud-play')}
						tabIndex="-1"
						type="button"
						onClick={playOrStopSample}
					>{buffering ? <IconLoading/> : <IconPlayFill/>}</button>
					<CustomSelect
						aria-label={l10n.getString('reader-read-aloud-voice')}
						value={selectedValue}
						tabIndex="-1"
						onChange={handleVoiceChange}
						showSecondaryLabelOnMenu
						options={options}
					/>
				</div>
				<button
					className="voice-switcher"
					disabled={!voices.length || selectedVoice === voices[voices.length - 1]}
					type="button"
					onClick={() => handleVoiceChange(voices[voices.indexOf(selectedVoice) + 1]?.id)}
				>
					<IconChevronRight/>
				</button>
			</div>
		</div>
	);
}

function TierPreview({ tier, selected, onSelect, onPurchaseCredits, voices, selectedVoice, lang, onSetVoice, disabled }) {
	const { l10n } = useLocalization();

	let radio = useRef();

	function handleClick(event) {
		if (disabled) return;
		if (radio.current.contains(event.target)) {
			return;
		}
		radio.current.click();
	}

	function handleChange() {
		if (disabled) return;
		onSelect(tier);
	}

	let checked = selected === tier;

	return (
		<div className={cx('tier', { checked, disabled })} onClick={handleClick}>
			<div className="text">
				<label>
					<input
						type="radio"
						name="tier"
						ref={radio}
						checked={checked}
						disabled={disabled}
						onChange={handleChange}
					/>
					{l10n.getString(`reader-read-aloud-voice-tier-${tier}`)}
				</label>
				<BulletList
					tier={tier}
					onPurchaseCredits={onPurchaseCredits}
				/>
			</div>
			<VoicePreview
				lang={lang}
				voices={voices}
				active={checked}
				selectedVoice={selectedVoice}
				onSetVoice={onSetVoice}
			/>
		</div>
	);
}

const TIER_OPTIONS = [
	{ tier: 'standard', showPurchaseCredits: false },
	{ tier: 'premium', showPurchaseCredits: true },
	{ tier: 'local', showPurchaseCredits: false },
];

const ReadAloudFirstRunPopup = forwardRef(function ReadAloudFirstRunPopup({ lang, remoteInterface, loggedIn, onPurchaseCredits, onLogIn, onCancel, onDone, standalone, onSetDoneMode }, ref) {
	const { l10n } = useLocalization();

	let [selectedTier, setSelectedTier] = useState(null);
	let [selectedVoices, setSelectedVoices] = useState({});

	function setSelectedVoice(tier, voice) {
		setSelectedVoices(prev => ({ ...prev, [tier]: { voice } }));
	}

	let {
		allBrowserVoices,
		allRemoteVoices,
		selectedLang,
		availableLanguages,
		effectiveLang,
		handleLangChange,
	} = useVoiceData({ lang, remoteInterface });

	let voicesByTier = useMemo(() => {
		let localVoices = getVoicesForLanguage(allBrowserVoices || [], effectiveLang);
		let remoteVoices = getVoicesForLanguage(allRemoteVoices || [], effectiveLang);
		return {
			local: localVoices,
			standard: remoteVoices.filter(v => v.tier === 'standard'),
			premium: remoteVoices.filter(v => v.tier === 'premium'),
		};
	}, [allBrowserVoices, allRemoteVoices, effectiveLang]);

	// Clear selected voice when it's no longer available
	useEffect(() => {
		for (let tier of TIERS) {
			let selected = selectedVoices[tier];
			if (selected?.voice && !voicesByTier[tier].some(v => v.id === selected.voice.id)) {
				setSelectedVoice(tier, null);
			}
		}
	}, [voicesByTier, selectedVoices]);

	// Deselect tier when it becomes disabled
	useEffect(() => {
		if (selectedTier && !voicesByTier[selectedTier]?.length) {
			setSelectedTier(null);
		}
	}, [voicesByTier, selectedTier]);

	let isRemoteTier = selectedTier && selectedTier !== 'local';
	let needsLogIn = isRemoteTier && !loggedIn;
	let canSubmit = !!selectedTier && !!selectedVoices[selectedTier]?.voice;

	useEffect(() => {
		onSetDoneMode?.({ enabled: canSubmit, needsLogIn });
	}, [canSubmit, needsLogIn, onSetDoneMode]);

	let submitRef = useRef();
	submitRef.current = () => {
		if (!selectedTier) return;
		let selected = selectedVoices[selectedTier];
		if (!selected?.voice) return;
		onDone({ lang: selectedLang, region: getVoiceRegion(selected.voice), voice: selected.voice.id, speed: 1, tier: selectedTier });
	};

	function handleSubmit(event) {
		event.preventDefault();
		submitRef.current();
	}

	useImperativeHandle(ref, () => ({
		submit: () => submitRef.current(),
	}));

	let formContent = (
		<>
			<div className="row">
				<h1>{l10n.getString('reader-read-aloud-first-run-title')}</h1>
				<div className="language">
					<LanguageRegionSelect
						languages={availableLanguages}
						lang={selectedLang}
						onLangChange={handleLangChange}
					/>
				</div>
			</div>
			<div className="row tiers">
				{TIER_OPTIONS.map(({ tier, showPurchaseCredits }) => (
					<TierPreview
						key={tier}
						tier={tier}
						selected={selectedTier}
						onSelect={setSelectedTier}
						onPurchaseCredits={showPurchaseCredits ? onPurchaseCredits : undefined}
						voices={voicesByTier[tier]}
						selectedVoice={selectedVoices[tier]?.voice || null}
						lang={effectiveLang}
						onSetVoice={(voice) => setSelectedVoice(tier, voice)}
						disabled={!voicesByTier[tier].length}
					/>
				))}
			</div>
		</>
	);

	if (standalone) {
		return (
			<div className="read-aloud-first-run-popup standalone">
				<form onSubmit={handleSubmit}>
					{formContent}
				</form>
			</div>
		);
	}

	return (
		<DialogPopup className="read-aloud-first-run-popup" onSubmit={handleSubmit} onClose={onCancel}>
			<form onSubmit={handleSubmit}>
				{formContent}
				<div className="row buttons">
					<button
						tabIndex={-1}
						data-tabstop={1}
						className="form-button"
						type="button"
						onClick={onCancel}
					>{l10n.getString('general-cancel')}</button>
					{loggedIn || !isRemoteTier
						? <button
							tabIndex={-1}
							data-tabstop={1}
							type="submit"
							className="form-button primary"
							disabled={!selectedTier}
						>{l10n.getString('general-done')}</button>
						: <button
							tabIndex={-1}
							data-tabstop={1}
							type="button"
							className="form-button primary"
							onClick={onLogIn}
						>{l10n.getString('reader-read-aloud-log-in-button')}</button>}
				</div>
			</form>
		</DialogPopup>
	);
});

export default ReadAloudFirstRunPopup;
