import { ReadAloudVoice } from './voice';
import { pickLocale } from 'locale-matcher';

export function getSupportedLanguages(voices: ReadAloudVoice<never, never>[]): string[] {
	// Normalize to base language codes, removing the region component
	return [...new Set(
		voices.flatMap(voice => voice.languages.map(lang => lang.replace(/-.+$/, '')))
	)] as string[];
}

export function voiceSupportsLanguage(voiceLanguages: string[], lang: string): boolean {
	let baseLang = lang.replace(/-.+$/, '');
	let hasRegion = lang.includes('-');

	for (let voiceLang of voiceLanguages) {
		let voiceBaseLang = voiceLang.replace(/-.+$/, '');
		let voiceHasRegion = voiceLang.includes('-');

		// Base languages must match
		if (voiceBaseLang !== baseLang) {
			continue;
		}

		// If no region specified, accept any variant
		if (!hasRegion) {
			return true;
		}

		// If region specified, accept voices with matching region or no region
		if (!voiceHasRegion || voiceLang === lang) {
			return true;
		}
	}
	return false;
}

export function getVoicesForLanguage<T extends ReadAloudVoice<never, never>>(
	voices: T[],
	lang: string
): T[] {
	return voices.filter(voice => voiceSupportsLanguage(voice.languages, lang));
}

export function resolveLanguage(contentLang: string, supportedLangs: string[]) {
	if (!supportedLangs.length) {
		return contentLang;
	}
	let contentLangs = [contentLang];
	if (navigator.languages[0].startsWith(contentLang)) {
		contentLangs.unshift(navigator.languages[0]);
	}
	return pickLocale(contentLangs, supportedLangs);
}

export function getAllRegions(
	voices: ReadAloudVoice<never, never>[]
): Record<string, string[]> {
	let regionsByLang: Record<string, Set<string>> = {};
	for (let voice of voices) {
		for (let lang of voice.languages) {
			let match = lang.match(/^([a-z]{2,3})-(.+)$/);
			if (match) {
				let [, lang, region] = match;
				if (!regionsByLang[lang]) {
					regionsByLang[lang] = new Set();
				}
				regionsByLang[lang].add(region);
			}
		}
	}
	let result: Record<string, string[]> = {};
	for (let lang in regionsByLang) {
		result[lang] = Array.from(regionsByLang[lang]).sort();
	}
	return result;
}
