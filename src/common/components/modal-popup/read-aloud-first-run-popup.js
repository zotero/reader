import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';
import Select from '../common/select';
import LanguageRegionSelect from '../../read-aloud/components/language-region-select';
import { BrowserReadAloudProvider } from '../../read-aloud/browser/provider';
import { RemoteReadAloudProvider } from '../../read-aloud/remote/provider';
import { getAllRegions, getSupportedLanguages, getVoicesForLanguage } from '../../read-aloud/lang';
import { useSamplePlayback } from '../../read-aloud/components/use-sample-playback';
import cx from 'classnames';
import IconLoading from '../../../../res/icons/16/loading.svg';
import IconPlayFill from '../../../../res/icons/16/play-fill.svg';
import IconChevronLeft from '../../../../res/icons/20/chevron-left.svg';
import IconChevronRight from '../../../../res/icons/20/chevron-right.svg';

function VoicePreview({ mode, voices, active, selectedVoice, lang, onSetVoice, onOpenVoicePreferences }) {
	const { l10n } = useLocalization();

	let { playSample, stopSample, playing, buffering } = useSamplePlayback();
	let [autoplay, setAutoplay] = useState(false);

	useEffect(() => {
		if (voices.length > 0 && !selectedVoice) {
			onSetVoice(voices[0]);
		}
	}, [voices, onSetVoice, selectedVoice]);

	useEffect(() => {
		if (!active) {
			stopSample();
		}
	}, [active, stopSample]);

	let playSampleWithVoice = useCallback(() => {
		playSample(selectedVoice, lang);
	}, [lang, playSample, selectedVoice]);

	function playOrStopSample() {
		if (playing) {
			stopSample();
		}
		else {
			playSampleWithVoice();
		}
	}

	function handleVoiceSelected(voice) {
		onSetVoice(voice);
		setAutoplay(true);
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

	return (
		<div className="voice-preview">
			<div className="controls">
				<button
					className="voice-switcher"
					disabled={!voices.length || selectedVoice === voices[0]}
					type="button"
					onClick={() => handleVoiceSelected(voices[voices.indexOf(selectedVoice) - 1])}
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
					>{buffering ? <IconLoading /> : <IconPlayFill/>}</button>
					<Select
						aria-label={l10n.getString('reader-read-aloud-voice')}
						value={selectedVoice?.id || ''}
						tabIndex="-1"
						onChange={e => handleVoiceSelected(voices.find(v => v.id === e.target.value))}
					>
						{voices.map((voice) => (
							<option key={voice.id} value={voice.id}>{voice.label}</option>
						))}
					</Select>
				</div>
				<button
					className="voice-switcher"
					disabled={!voices.length || selectedVoice === voices[voices.length - 1]}
					type="button"
					onClick={() => handleVoiceSelected(voices[voices.indexOf(selectedVoice) + 1])}
				>
					<IconChevronRight/>
				</button>
			</div>
			<button
				className={cx('manage-voices', { hidden: mode !== 'browser' })}
				type="button"
				onClick={onOpenVoicePreferences}
			>
				{l10n.getString('reader-read-aloud-manage-voices')}
			</button>
		</div>
	);
}

function BulletList({ text, onPurchaseCredits }) {
	let lines = text.trim().split('\n');

	function renderLine(line) {
		let parts = [];

		let match = line.match(/^(.*?)<purchase-credits>(.+)<\/purchase-credits>(.*)$/);
		if (match && onPurchaseCredits) {
			let [, before, button, after] = match;
			if (before) {
				parts.push(<span key="before">{before}</span>);
			}
			parts.push(
				<button
					key="button"
					className="purchase-credits"
					type="button"
					onClick={onPurchaseCredits}
				>
					{button}
				</button>
			);
			if (after) {
				parts.push(<span key="after">{after}</span>);
			}
		}
		else {
			parts.push(<span key="line">{line}</span>);
		}

		return parts;
	}

	return (
		<ul>
			{lines.map((line, i) => <li key={i}>{renderLine(line.trim())}</li>)}
		</ul>
	);
}

function ModePreview({ mode, selected, onSelect, onPurchaseCredits, onOpenVoicePreferences, voices, selectedVoice, lang, onSetVoice, disabled }) {
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
		onSelect(mode);
	}

	let checked = selected === mode;

	return (
		<div className={cx('mode', { checked, disabled })} onClick={handleClick}>
			<div className="text">
				<label>
					<input
						type="radio"
						name="mode"
						ref={radio}
						checked={checked}
						disabled={disabled}
						onChange={handleChange}
					/>
					{l10n.getString(`reader-read-aloud-voice-mode-${mode}`)}
				</label>
				<BulletList
					text={l10n.getString(`reader-read-aloud-first-run-voice-mode-${mode}-bullets`)}
					onPurchaseCredits={onPurchaseCredits}
				/>
			</div>
			<VoicePreview
				mode={mode}
				lang={lang}
				voices={voices}
				active={checked}
				selectedVoice={selectedVoice}
				onSetVoice={onSetVoice}
				onOpenVoicePreferences={onOpenVoicePreferences}
			/>
		</div>
	);
}

function ReadAloudFirstRunPopup({ params, remoteInterface, loggedIn, onOpenVoicePreferences, onPurchaseCredits, onLogIn, onCancel, onDone }) {
	const { l10n } = useLocalization();

	let [selectedMode, setSelectedMode] = useState(null);
	let [allBrowserVoices, setAllBrowserVoices] = useState([]);
	let [allRemoteVoices, setAllRemoteVoices] = useState([]);
	let [selectedBrowserVoice, setSelectedBrowserVoice] = useState(null);
	let [selectedRemoteVoice, setSelectedRemoteVoice] = useState(null);
	let [selectedLang, setSelectedLang] = useState(params.lang);
	let [selectedRegion, setSelectedRegion] = useState(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchVoices() {
			let browserProvider = new BrowserReadAloudProvider();
			try {
				let voices = await browserProvider.getVoices();
				if (cancelled) return;
				setAllBrowserVoices(voices);
			}
			catch (e) {
				if (cancelled) return;
				console.error(e);
				setAllBrowserVoices([]);
			}
		}
		fetchVoices();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!remoteInterface) {
			return undefined;
		}

		let cancelled = false;

		async function fetchVoices() {
			let remoteProvider = new RemoteReadAloudProvider(remoteInterface);
			try {
				let voices = await remoteProvider.getVoices();
				if (cancelled) return;
				setAllRemoteVoices(voices);
			}
			catch (e) {
				if (cancelled) return;
				console.error(e);
				setAllRemoteVoices([]);
			}
		}
		fetchVoices();

		return () => {
			cancelled = true;
		};
	}, [remoteInterface]);

	let availableLanguages = useMemo(
		() => getSupportedLanguages([...allBrowserVoices, ...allRemoteVoices]),
		[allBrowserVoices, allRemoteVoices]
	);

	let availableRegions = useMemo(
		() => getAllRegions([...allBrowserVoices, ...allRemoteVoices]),
		[allBrowserVoices, allRemoteVoices]
	);

	let effectiveLang = useMemo(
		() => (selectedRegion ? `${selectedLang}-${selectedRegion}` : selectedLang),
		[selectedLang, selectedRegion]
	);

	let browserVoices = useMemo(
		() => getVoicesForLanguage(allBrowserVoices, effectiveLang),
		[allBrowserVoices, effectiveLang]
	);

	let remoteVoices = useMemo(
		() => getVoicesForLanguage(allRemoteVoices, effectiveLang),
		[allRemoteVoices, effectiveLang]
	);

	let browserDisabled = !browserVoices.length;
	let remoteDisabled = !remoteVoices.length;

	useEffect(() => {
		// Clear selected voice when language changes and voice is no longer available
		if (selectedBrowserVoice && !browserVoices.some(v => v.id === selectedBrowserVoice.id)) {
			setSelectedBrowserVoice(null);
		}
	}, [browserVoices, selectedBrowserVoice]);

	// Deselect mode when it becomes disabled
	useEffect(() => {
		if (selectedMode === 'browser' && browserDisabled) {
			setSelectedMode(null);
		}
		else if (selectedMode === 'remote' && remoteDisabled) {
			setSelectedMode(null);
		}
	}, [browserDisabled, remoteDisabled, selectedMode]);

	useEffect(() => {
		if (selectedRemoteVoice && !remoteVoices.some(v => v.id === selectedRemoteVoice.id)) {
			setSelectedRemoteVoice(null);
		}
	}, [remoteVoices, selectedRemoteVoice]);

	// Reset region when it becomes unavailable
	useEffect(() => {
		let regionsForLang = availableRegions[selectedLang] || [];
		if (selectedRegion && !regionsForLang.includes(selectedRegion)) {
			setSelectedRegion(null);
		}
	}, [availableRegions, selectedLang, selectedRegion]);

	function handleLangChange(lang) {
		setSelectedLang(lang);
		setSelectedRegion(null);
	}

	function handleRegionChange(region) {
		setSelectedRegion(region);
	}

	function handleSubmit(event) {
		event.preventDefault();
		if (!selectedMode) return;
		let selectedVoice = selectedMode === 'browser'
			? selectedBrowserVoice
			: selectedRemoteVoice;
		if (!selectedVoice) return;
		onDone(selectedLang, selectedRegion, selectedVoice.id, 1);
	}

	return (
		<DialogPopup className="read-aloud-first-run-popup" onSubmit={handleSubmit} onClose={onCancel}>
			<form onSubmit={handleSubmit}>
				<div className="row">
					<h1>{l10n.getString('reader-read-aloud-first-run-title')}</h1>
					<div className="language">
						<LanguageRegionSelect
							languages={availableLanguages}
							regions={availableRegions}
							lang={selectedLang}
							region={selectedRegion}
							onLangChange={handleLangChange}
							onRegionChange={handleRegionChange}
						/>
					</div>
				</div>
				<div className="row modes">
					<ModePreview
						mode="browser"
						selected={selectedMode}
						onSelect={setSelectedMode}
						onOpenVoicePreferences={onOpenVoicePreferences}
						voices={browserVoices}
						selectedVoice={selectedBrowserVoice}
						lang={effectiveLang}
						onSetVoice={setSelectedBrowserVoice}
						disabled={browserDisabled}
					/>
					<ModePreview
						mode="remote"
						selected={selectedMode}
						onSelect={setSelectedMode}
						onPurchaseCredits={onPurchaseCredits}
						onOpenVoicePreferences={onOpenVoicePreferences}
						voices={remoteVoices}
						selectedVoice={selectedRemoteVoice}
						lang={effectiveLang}
						onSetVoice={setSelectedRemoteVoice}
						disabled={remoteDisabled}
					/>
				</div>
				<div className="row buttons">
					<button
						tabIndex={-1}
						data-tabstop={1}
						className="form-button"
						type="button"
						onClick={onCancel}
					>{l10n.getString('general-cancel')}</button>
					{loggedIn || selectedMode !== 'remote'
						? <button
							tabIndex={-1}
							data-tabstop={1}
							type="submit"
							className="form-button primary"
							disabled={!selectedMode}
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
}

export default ReadAloudFirstRunPopup;
