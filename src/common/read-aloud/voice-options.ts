import { ReadAloudVoice } from './voice';
import { formatTimeRemaining } from '../lib/format-time-remaining';

export function buildVoiceOptions(
	voices: ReadAloudVoice[],
	selectedVoiceID: string | null | undefined,
) {
	// Sort by creditsPerMinute (ascending), preserving original order within same cost
	let sortedVoices = [...voices].sort((a, b) => {
		let aCost = a.creditsPerMinute ?? -1;
		let bCost = b.creditsPerMinute ?? -1;
		return aCost - bCost;
	});

	let options: { divider?: boolean; value?: string; label?: string; secondaryLabel?: string | null }[] = [];
	let selectedValue = '';

	let lastCreditsPerMinute: number | null | undefined;
	for (let voice of sortedVoices) {
		// Add divider between groups with different creditsPerMinute
		if (lastCreditsPerMinute !== undefined && voice.creditsPerMinute !== lastCreditsPerMinute) {
			options.push({ divider: true });
		}
		lastCreditsPerMinute = voice.creditsPerMinute;

		if (voice.id === selectedVoiceID) {
			selectedValue = voice.id;
		}
		options.push({
			value: voice.id,
			label: voice.label,
			secondaryLabel: formatTimeRemaining(voice.minutesRemaining),
		});
	}

	return { options, selectedValue };
}
