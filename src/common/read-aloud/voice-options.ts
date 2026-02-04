import { ReadAloudVoice, groupVoicesByRegion } from './voice';
import { getPreferredRegion } from './lang';
import { formatTimeRemaining } from '../lib/format-time-remaining';

let regionDisplayNames = new Intl.DisplayNames(undefined, { type: 'region' });

function getRegionName(region: string): string {
	try {
		return regionDisplayNames.of(region) ?? region;
	}
	catch {
		return region;
	}
}

export function buildVoiceOptions(
	voices: ReadAloudVoice[],
	baseLang: string,
	selectedVoiceID: string | null | undefined,
) {
	let groups = groupVoicesByRegion(voices);
	let preferredRegion = getPreferredRegion(baseLang);
	let groupsSorted = [...groups.entries()].sort((a, b) => {
		// No-region group first
		if (a[0] === null) return -1;
		if (b[0] === null) return 1;
		// Preferred region next
		if (a[0] === preferredRegion) return -1;
		if (b[0] === preferredRegion) return 1;
		return getRegionName(a[0]).localeCompare(getRegionName(b[0]));
	});

	let options: { header?: boolean; divider?: boolean; value?: string; label?: string; secondaryLabel?: string | null }[] = [];
	let selectedValue = '';

	for (let [region, regionVoices] of groupsSorted) {
		if (region) {
			options.push({ header: true, label: getRegionName(region) });
		}

		// Sort by creditsPerMinute (ascending), preserving original order within same cost
		let sortedVoices = [...regionVoices].sort((a, b) => {
			let aCost = a.creditsPerMinute ?? -1;
			let bCost = b.creditsPerMinute ?? -1;
			return aCost - bCost;
		});

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
	}

	return { options, selectedValue };
}
