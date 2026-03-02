import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import DialogPopup from './common/dialog-popup';
import { BulletList } from '../../read-aloud/components/bullet-list';
import CustomSelect from '../common/custom-select';
import LanguageRegionSelect from '../../read-aloud/components/language-region-select';
import { useVoiceData } from '../../read-aloud/components/use-voice-data';
import { useSamplePlayback } from '../../read-aloud/components/use-sample-playback';
import { resolveEnabledVoiceIDs, TIERS, getVoicesForLanguage } from '../../read-aloud/voice';
import cx from 'classnames';
import IconLoading from '../../../../res/icons/16/loading.svg';
import IconPlayFill from '../../../../res/icons/16/play-fill.svg';

function VoiceRow({ voice, checked, onToggle, isActive, playing, buffering, onPlay }) {
	return (
		<label className="voice-row">
			<input
				type="checkbox"
				checked={checked}
				onChange={() => onToggle(voice.id)}
			/>
			<button
				className={cx('play-preview', {
					playing: isActive && (playing || buffering),
					buffering: isActive && buffering,
				})}
				type="button"
				onClick={(e) => {
					e.preventDefault();
					onPlay(voice);
				}}
			>
				{isActive && buffering ? <IconLoading/> : <IconPlayFill/>}
			</button>
			<span className="voice-label">{voice.label}</span>
		</label>
	);
}

const ReadAloudVoicesPopup = forwardRef(function ReadAloudVoicesPopup({ lang, tier: initialTier, remoteInterface, persistedEnabledVoices, onSetEnabledVoices, onCancel, onPurchaseCredits, onOpenVoicePreferences, standalone }, ref) {
	const { l10n } = useLocalization();

	let [selectedTier, setSelectedTier] = useState(initialTier || null);
	let [playingVoice, setPlayingVoice] = useState(null);
	let { playSample, stopSample, playing, buffering } = useSamplePlayback();

	let {
		allVoices,
		loaded: voicesLoaded,
		selectedLang,
		availableLanguages,
		effectiveLang,
		enabledVoices,
		handleLangChange,
	} = useVoiceData({ lang, remoteInterface, persistedEnabledVoices });

	// Per-language checked voice state. Initialized lazily from defaults when
	// a language is first viewed. Only languages the user modifies are dirty.
	let [checkedByLang, setCheckedByLang] = useState({});
	let [dirtyLangs, setDirtyLangs] = useState(new Set());

	let defaultCheckedByTier = useMemo(() => {
		if (!voicesLoaded) return null;
		let result = {};
		for (let tier of TIERS) {
			let tierVoices = getVoicesForLanguage(
				allVoices.filter(v => v.tier === tier),
				effectiveLang
			);
			result[tier] = new Set(resolveEnabledVoiceIDs(tierVoices, enabledVoices?.[tier]));
		}
		return result;
	}, [voicesLoaded, allVoices, effectiveLang, enabledVoices]);

	let checkedByTier = checkedByLang[selectedLang] || defaultCheckedByTier;

	function toggleVoice(tier, voiceID) {
		setCheckedByLang((prev) => {
			let current = prev[selectedLang] || defaultCheckedByTier;
			let tierSet = new Set(current[tier]);
			if (tierSet.has(voiceID)) {
				tierSet.delete(voiceID);
			}
			else {
				tierSet.add(voiceID);
			}
			return { ...prev, [selectedLang]: { ...current, [tier]: tierSet } };
		});
		setDirtyLangs(prev => new Set(prev).add(selectedLang));
	}

	function getChanges() {
		let changes = {};
		for (let lang of dirtyLangs) {
			let langState = checkedByLang[lang];
			if (!langState) continue;
			changes[lang] = {};
			for (let tier of TIERS) {
				if (langState[tier]) {
					changes[lang][tier] = [...langState[tier]];
				}
			}
		}
		return changes;
	}

	let availableTiers = useMemo(() => {
		let tiers = new Set(allVoices.map(v => v.tier));
		return TIERS.filter(t => tiers.has(t));
	}, [allVoices]);

	let voicesByTier = useMemo(() => {
		let result = {};
		for (let tier of TIERS) {
			let tierVoices = allVoices.filter(v => v.tier === tier);
			result[tier] = getVoicesForLanguage(tierVoices, effectiveLang);
		}
		return result;
	}, [allVoices, effectiveLang]);

	// Auto-select first available tier
	useEffect(() => {
		if (!selectedTier && availableTiers.length) {
			setSelectedTier(availableTiers[0]);
		}
	}, [availableTiers, selectedTier]);

	let voicesForTier = useMemo(() => {
		let voices = voicesByTier[selectedTier] || [];
		// Sort by creditsPerMinute (ascending), preserving original order within same cost
		return [...voices].sort((a, b) => {
			let aCost = a.creditsPerMinute ?? -1;
			let bCost = b.creditsPerMinute ?? -1;
			return aCost - bCost;
		});
	}, [voicesByTier, selectedTier]);
	let checkedSet = checkedByTier?.[selectedTier] || new Set();

	function handlePlaySample(voice) {
		if ((playing || buffering) && playingVoice === voice) {
			stopSample();
			setPlayingVoice(null);
		}
		else {
			playSample(voice);
			setPlayingVoice(voice);
		}
	}

	// Use a ref so useImperativeHandle doesn't need dependencies
	let submitRef = useRef();
	submitRef.current = () => {
		let changes = getChanges();
		if (Object.keys(changes).length > 0) {
			onSetEnabledVoices(changes);
		}
	};

	useImperativeHandle(ref, () => ({
		submit: () => submitRef.current(),
	}));

	function handleDone() {
		submitRef.current();
		onCancel();
	}

	let tierOptions = availableTiers.map(tier => ({
		value: tier,
		label: l10n.getString(`reader-read-aloud-voice-tier-${tier}`),
		disabled: !voicesByTier[tier]?.length,
	}));

	if (!voicesLoaded) {
		return null;
	}

	let popupContent = (
		<>
			<div className="content">
				<div className="main">
					<div className="header">
						{tierOptions.length > 0 && (
							<CustomSelect
								aria-label={l10n.getString('reader-read-aloud-voice-tier')}
								value={selectedTier || ''}
								onChange={setSelectedTier}
								options={tierOptions}
							/>
						)}
						<LanguageRegionSelect
							languages={availableLanguages}
							lang={selectedLang}
							onLangChange={handleLangChange}
						/>
					</div>
					<div className="voice-list">
						{voicesForTier.map((voice, index) => {
							let prev = index > 0 ? voicesForTier[index - 1] : null;
							let showDivider = prev && voice.creditsPerMinute !== prev.creditsPerMinute;
							return (
								<React.Fragment key={voice.id}>
									{showDivider && <div className="divider"/>}
									<VoiceRow
										voice={voice}
										checked={checkedSet.has(voice.id)}
										onToggle={id => toggleVoice(selectedTier, id)}
										isActive={playingVoice === voice}
										playing={playing}
										buffering={buffering}
										onPlay={handlePlaySample}
									/>
								</React.Fragment>
							);
						})}
						{voicesForTier.length === 0 && (
							<div className="no-voices">
								{l10n.getString('reader-read-aloud-voices-none-available')}
							</div>
						)}
					</div>
					{selectedTier === 'local' && (
						<button
							className="get-more-voices"
							type="button"
							onClick={onOpenVoicePreferences}
						>
							{l10n.getString('reader-read-aloud-more-voices')}
						</button>
					)}
				</div>
				<div className="description">
					{selectedTier && (
						<>
							<div className="tier-name">
								{l10n.getString(`reader-read-aloud-voice-tier-${selectedTier}`)}
							</div>
							<BulletList
								tier={selectedTier}
								onPurchaseCredits={onPurchaseCredits}
							/>
						</>
					)}
				</div>
			</div>
			{!standalone && (
				<div className="row buttons">
					<button
						className="form-button"
						type="button"
						onClick={onCancel}
					>{l10n.getString('general-cancel')}</button>
					<button
						className="form-button primary"
						type="button"
						onClick={handleDone}
						disabled={checkedSet.size === 0}
					>{l10n.getString('general-done')}</button>
				</div>
			)}
		</>
	);

	if (standalone) {
		return (
			<div className="read-aloud-voices-popup standalone">
				{popupContent}
			</div>
		);
	}

	return (
		<DialogPopup className="read-aloud-voices-popup" onClose={onCancel}>
			{popupContent}
		</DialogPopup>
	);
});

export default ReadAloudVoicesPopup;
