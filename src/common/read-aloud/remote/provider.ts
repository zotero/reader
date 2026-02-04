import { ReadAloudProvider } from '../provider';
import { RemoteInterface, RemoteVoiceConfig, VoicesResponse } from './index';
import { RemoteReadAloudVoice } from './voice';
import { Tier, TIERS } from '../voice';

export class RemoteReadAloudProvider implements ReadAloudProvider {
	readonly remote: RemoteInterface;

	standardCreditsRemaining: number | null = null;

	premiumCreditsRemaining: number | null = null;

	devMode = false;

	constructor(remote: RemoteInterface) {
		this.remote = remote;
	}

	async getVoices(): Promise<RemoteReadAloudVoice[]> {
		let { voices: response, standardCreditsRemaining, premiumCreditsRemaining, devMode } = await this.remote.getVoices();
		if (standardCreditsRemaining !== null) {
			this.standardCreditsRemaining = standardCreditsRemaining;
		}
		if (premiumCreditsRemaining !== null) {
			this.premiumCreditsRemaining = premiumCreditsRemaining;
		}
		this.devMode = devMode;
		return parseVoicesResponse(response)
			.map(voice => new RemoteReadAloudVoice(this, voice));
	}
}

/**
 * Transform a format=2 voices response into a flat RemoteVoiceConfig array.
 * Each voice+locale combination produces a separate entry.
 */
function parseVoicesResponse(response: VoicesResponse): RemoteVoiceConfig[] {
	let voices: RemoteVoiceConfig[] = [];
	for (let [tier, configs] of Object.entries(response)) {
		if (!Array.isArray(configs) || !TIERS.includes(tier as Tier)) continue;
		for (let config of configs) {
			for (let [locale, localeConfig] of Object.entries(config.locales || {})) {
				// Tolerate localeConfig being a plain array of IDs
				let ids = Array.isArray(localeConfig)
					? localeConfig
					: [...localeConfig.default, ...(localeConfig.other ?? [])];
				for (let id of ids) {
					let voiceInfo = config.voices?.[id];
					if (!voiceInfo) continue;
					voices.push({
						id,
						label: voiceInfo.label,
						tier: tier as Tier,
						locale,
						creditsPerMinute: config.creditsPerMinute,
						segmentGranularity: config.segmentGranularity,
						sentenceDelay: config.sentenceDelay,
					});
				}
			}
		}
	}
	return voices;
}
