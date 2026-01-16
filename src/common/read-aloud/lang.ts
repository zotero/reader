import { ReadAloudVoice } from './voice';
import { pickLocale } from 'locale-matcher';

export function getSupportedLanguages(voices: ReadAloudVoice<never, never>[]): string[] {
	// Normalize to base language codes, removing the country component
	return [...new Set(
		voices.flatMap(voice => voice.languages.map(lang => lang.replace(/-.+$/, '')))
	)] as string[];
}

export function getVoicesForLanguage<T extends ReadAloudVoice<never, never>>(
	voices: T[],
	lang: string
): T[] {
	return voices.filter((voice) => {
		let matchedLang = resolveLanguage(lang, voice.languages);
		return matchedLang !== undefined;
	});
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
