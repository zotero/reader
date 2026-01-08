import { ReadAloudVoice } from './voice';

export function getSupportedLanguages(voices: ReadAloudVoice<never, never>[]): string[] {
	return [...new Set(
		voices.map(voice => voice.lang).filter(Boolean)
	)] as string[];
}

export function resolveLanguage(contentLanguageCode: string, supportedLanguages: string[]) {
	let contentLanguageCodeResolved;
	try {
		contentLanguageCodeResolved = new Intl.Locale(contentLanguageCode).language;
	}
	catch (e) {
		console.warn(`Invalid locale: ${contentLanguageCode}`);
		contentLanguageCodeResolved = 'en';
	}

	let userLocale = navigator.languages[0];

	let isLangSupported = (lang: string) => (
		!supportedLanguages.length || supportedLanguages.includes(lang)
	);

	// If the user's locale has the same language as the content locale
	// (but possibly a different region), use the user's locale
	if (userLocale.startsWith(contentLanguageCodeResolved) && isLangSupported(userLocale)) {
		return userLocale;
	}
	// Otherwise, if we know how to read the content locale, use that
	if (isLangSupported(contentLanguageCode)) {
		return contentLanguageCode;
	}
	// Fall back to US English
	if (isLangSupported('en-US')) {
		return 'en-US';
	}
	// Or, in the rare situation where the system can't read US English,
	// whatever the first locale it can read is
	return supportedLanguages[0] ?? null;
}
