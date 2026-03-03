import { ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ReadAloudController } from './controller';
import type { ReadAloudProvider } from './provider';
import { getBaseLanguage, normalizeLanguage, isLanguageSupported } from './lang';

export abstract class ReadAloudVoice {
	readonly impl: unknown;

	readonly provider: ReadAloudProvider;

	constructor(provider: ReadAloudProvider, impl: unknown) {
		this.provider = provider;
		this.impl = impl;
	}

	abstract readonly id: string;

	abstract readonly label: string;

	abstract readonly language: string;

	abstract readonly score: number;

	abstract readonly segmentGranularity: ReadAloudGranularity;

	abstract readonly creditsPerMinute: number | null;

	abstract readonly tier: Tier;

	abstract readonly default: boolean;

	abstract readonly sentenceDelay: number;

	get minutesRemaining(): number | null {
		let creditsRemaining = this.tier === 'standard'
			? this.provider.standardCreditsRemaining
			: this.tier === 'premium'
				? this.provider.premiumCreditsRemaining
				: null;
		let creditsPerMinute = this.creditsPerMinute;
		if (creditsRemaining === null || !creditsPerMinute) {
			return null;
		}
		return creditsRemaining / creditsPerMinute;
	}

	abstract getController(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController;

	abstract getSampleController(segments: ReadAloudSegment[]): ReadAloudController;
}

export type Tier = 'local' | 'standard' | 'premium';

export const TIERS: Tier[] = ['standard', 'premium', 'local'];

export function resolveEnabledVoiceIDs(
	tierVoices: ReadAloudVoice[],
	persistedVoiceIDs: string[] | undefined,
): string[] {
	if (Array.isArray(persistedVoiceIDs)) {
		return persistedVoiceIDs;
	}
	return tierVoices.filter(v => v.default).map(v => v.id);
}

export function getSupportedLanguages(voices: ReadAloudVoice[]): string[] {
	let bases = new Set<string>();
	for (let voice of voices) {
		let normalized = normalizeLanguage(voice.language);
		bases.add(getBaseLanguage(normalized));
	}
	return [...bases];
}

export function getVoicesForLanguage<T extends ReadAloudVoice>(voices: T[], lang: string): T[] {
	return voices.filter(voice => isLanguageSupported(voice.language, lang));
}

export function getVoiceRegion(voice: ReadAloudVoice): string | null {
	let normalized = normalizeLanguage(voice.language);
	let base = getBaseLanguage(normalized);
	return normalized.includes('-') ? normalized.substring(base.length + 1) : null;
}

