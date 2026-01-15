import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';
import Select from '../common/select';
import { BrowserReadAloudProvider } from '../../read-aloud/browser/provider';
import { RemoteReadAloudProvider } from '../../read-aloud/remote/provider';
import cx from 'classnames';
import IconLoading from '../../../../res/icons/16/loading.svg';
import IconPlayFill from '../../../../res/icons/16/play-fill.svg';
import IconChevronLeft from '../../../../res/icons/20/chevron-left.svg';
import IconChevronRight from '../../../../res/icons/20/chevron-right.svg';

function VoicePreview({ mode, voices, active, selectedVoice, onSetVoice, onOpenVoicePreferences }) {
	const { l10n } = useLocalization();

	let sampleText = l10n.getString('reader-read-aloud-first-run-sample-text');
	let sampleSegments = useMemo(() => [
		{ text: sampleText }
	], [sampleText]);

	let [controller, setController] = useState(null);
	let controllerRef = useRef(null);
	controllerRef.current = controller;
	let [playing, setPlaying] = useState(false);
	let [buffering, setBuffering] = useState(false);
	let [autoplay, setAutoplay] = useState(false);

	useEffect(() => {
		if (voices.length > 0 && !selectedVoice) {
			onSetVoice(voices[0]);
		}
	}, [voices, onSetVoice, selectedVoice]);

	useEffect(() => {
		if (!active && controller) {
			controller.paused = true;
			setPlaying(false);
			setBuffering(false);
		}
	}, [active, controller]);

	useEffect(() => {
		return () => {
			if (controllerRef.current) {
				controllerRef.current.destroy();
			}
		};
	}, []);

	let playSample = useCallback(() => {
		if (!selectedVoice) {
			return;
		}

		if (controller) {
			controller.destroy();
		}

		let newController = selectedVoice.getController(sampleSegments, null, null);
		setController(newController);
		setPlaying(false);

		newController.addEventListener('BufferingChange', () => setBuffering(newController.buffering));
		newController.addEventListener('ActiveSegmentChange', ({ segment }) => setPlaying(!!segment));
		newController.addEventListener('Complete', () => setPlaying(false));

		newController.paused = false;
	}, [controller, sampleSegments, selectedVoice]);

	function playOrStopSample() {
		if (controller && playing) {
			controller.destroy();
			setController(null);
			setPlaying(false);
		}
		else {
			playSample();
		}
	}

	function handleVoiceSelected(voice) {
		onSetVoice(voice);
		setAutoplay(true);
	}

	useEffect(() => {
		if (autoplay) {
			playSample();
			setAutoplay(false);
		}
	}, [autoplay, playSample]);

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

function ModePreview({ mode, selected, onSelect, onPurchaseCredits, onOpenVoicePreferences, voices, selectedVoice, onSetVoice }) {
	const { l10n } = useLocalization();

	let radio = useRef();

	function handleClick(event) {
		if (radio.current.contains(event.target)) {
			return;
		}
		radio.current.click();
	}

	function handleChange() {
		onSelect(mode);
	}

	let checked = selected === mode;

	return (
		<div className={cx('mode', { checked })} onClick={handleClick}>
			<div className="text">
				<label>
					<input
						type="radio"
						name="mode"
						ref={radio}
						checked={checked}
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
				voices={voices}
				active={checked}
				selectedVoice={selectedVoice}
				onSetVoice={onSetVoice}
				onOpenVoicePreferences={onOpenVoicePreferences}
			/>
		</div>
	);
}

function ReadAloudFirstRunPopup({ params, remoteInterface, loggedIn, onOpenVoicePreferences, onPurchaseCredits, onCancel, onDone }) {
	const { l10n } = useLocalization();

	let [selectedMode, setSelectedMode] = useState(null);
	let [browserVoices, setBrowserVoices] = useState([]);
	let [remoteVoices, setRemoteVoices] = useState([]);
	let [selectedBrowserVoice, setSelectedBrowserVoice] = useState(null);
	let [selectedRemoteVoice, setSelectedRemoteVoice] = useState(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchVoices() {
			let browserProvider = new BrowserReadAloudProvider();
			try {
				let voices = await browserProvider.getVoices(params.lang);
				if (cancelled) return;
				setBrowserVoices(voices);
			}
			catch (e) {
				if (cancelled) return;
				console.error(e);
				setBrowserVoices([]);
			}
		}
		fetchVoices();

		return () => {
			cancelled = true;
		};
	}, [params.lang]);

	useEffect(() => {
		if (!remoteInterface || !loggedIn) {
			return undefined;
		}

		let cancelled = false;

		async function fetchVoices() {
			let remoteProvider = new RemoteReadAloudProvider(remoteInterface);
			try {
				let voices = await remoteProvider.getVoices(params.lang);
				if (cancelled) return;
				setRemoteVoices(voices);
			}
			catch (e) {
				if (cancelled) return;
				console.error(e);
				setRemoteVoices([]);
			}
		}
		fetchVoices();

		return () => {
			cancelled = true;
		};
	}, [remoteInterface, loggedIn, params.lang]);

	function handleSubmit(event) {
		event.preventDefault();
		if (!selectedMode) return;
		let selectedVoice = selectedMode === 'browser'
			? selectedBrowserVoice
			: selectedRemoteVoice;
		if (!selectedVoice) return;
		onDone(selectedVoice.lang, selectedVoice.id, 1);
	}

	return (
		<DialogPopup className="read-aloud-first-run-popup" onClose={onCancel}>
			<form onSubmit={handleSubmit}>
				<div className="row">
					<h1>{l10n.getString('reader-read-aloud-first-run-title')}</h1>
				</div>
				<div className="row modes">
					<ModePreview
						mode="browser"
						selected={selectedMode}
						onSelect={setSelectedMode}
						onOpenVoicePreferences={onOpenVoicePreferences}
						voices={browserVoices}
						selectedVoice={selectedBrowserVoice}
						onSetVoice={setSelectedBrowserVoice}
					/>
					<ModePreview
						mode="remote"
						selected={selectedMode}
						onSelect={setSelectedMode}
						onPurchaseCredits={onPurchaseCredits}
						onOpenVoicePreferences={onOpenVoicePreferences}
						voices={remoteVoices}
						selectedVoice={selectedRemoteVoice}
						onSetVoice={setSelectedRemoteVoice}
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
					<button
						tabIndex={-1}
						data-tabstop={1}
						type="submit"
						className="form-button primary"
						disabled={!selectedMode}
					>{l10n.getString('general-done')}</button>
				</div>
			</form>
		</DialogPopup>
	);
}

export default ReadAloudFirstRunPopup;
