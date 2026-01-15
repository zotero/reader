import { ReadAloudVoice } from './voice';
import { pickLocale } from 'locale-matcher';

export function getSupportedLanguages(voices: ReadAloudVoice<never, never>[]): string[] {
	return [...new Set(
		voices.map(voice => voice.lang).filter(Boolean)
	)] as string[];
}

export function resolveLanguage(contentLanguageCode: string, supportedLanguages: string[]) {
	if (!supportedLanguages.length) {
		return contentLanguageCode;
	}
	return pickLocale(contentLanguageCode, supportedLanguages);
}

export function normalizeLanguageForGoogle(language: string) {
	// TODO: TEMP: Adapt language codes for Google API
	switch (language) {
		case 'en':
			language = 'en-US';
			break;
		case 'ar':
			language = 'ar-XA';
			break;
	}
	return language;
}
