// Equivalents for nonstandard language codes
const LANGUAGE_EQUIVALENTS: Record<string, string> = {
	cmn: 'zh', // Chinese
};

// And region codes
const REGION_EQUIVALENTS: Record<string, string> = {
	// Arabic
	XA: '001',
	SA: '001',
	// Chinese (local voices)
	CN: '',
	HK: '',
	TW: '',
};

// Default regions for languages with multiple regional variants,
// used when there's no better match (e.g., based on system locale)
const DEFAULT_REGIONS: Record<string, string> = {
	zh: 'CN',
	nl: 'NL',
	en: 'US',
	fr: 'FR',
	pt: 'BR',
	es: 'ES',
};

export function normalizeLanguage(lang: string): string {
	let base = lang.replace(/-.+$/, '');
	let region = lang.includes('-') ? lang.substring(base.length + 1) : '';
	let normalizedBase = LANGUAGE_EQUIVALENTS[base] ?? base;
	let normalizedRegion = REGION_EQUIVALENTS[region] ?? region;
	return normalizedRegion ? `${normalizedBase}-${normalizedRegion}` : normalizedBase;
}

export function isLanguageSupported(voiceLang: string, lang: string): boolean {
	let normalizedLang = normalizeLanguage(lang);
	let baseLang = normalizedLang.replace(/-.+$/, '');
	let hasRegion = normalizedLang.includes('-');

	let normalizedVoiceLang = normalizeLanguage(voiceLang);
	let voiceBaseLang = normalizedVoiceLang.replace(/-.+$/, '');
	let voiceHasRegion = normalizedVoiceLang.includes('-');

	// Base languages must match
	if (voiceBaseLang !== baseLang) {
		return false;
	}

	// If no region specified, accept any variant
	if (!hasRegion) {
		return true;
	}

	// If region specified, accept voices with matching region or no region
	if (!voiceHasRegion || normalizedVoiceLang === normalizedLang) {
		return true;
	}

	return false;
}

export function getPreferredRegion(baseLang: string): string | null {
	let normalizedBase = LANGUAGE_EQUIVALENTS[baseLang] ?? baseLang;
	for (let userLang of navigator.languages) {
		let normalized = normalizeLanguage(userLang);
		if (normalized.startsWith(normalizedBase + '-')) {
			return normalized.substring(normalizedBase.length + 1);
		}
	}
	return DEFAULT_REGIONS[normalizedBase] ?? null;
}

/**
 * Find the best match for a language code in a list of language codes.
 * Tries exact match, then exact regional match, then preferred region,
 * then falls back to first candidate with the same base language.
 */
export function resolveLanguage(lang: string, langs: string[]): string | null {
	if (!langs.length) {
		return null;
	}

	// Already in the list
	if (langs.includes(lang)) {
		return lang;
	}

	let normalizedLang = normalizeLanguage(lang);
	let baseLang = normalizedLang.replace(/-.+$/, '');

	// Find candidates with the same base language
	let candidates = langs.filter((candidate) => {
		candidate = normalizeLanguage(candidate);
		let candidateBase = candidate.replace(/-.+$/, '');
		return candidateBase === baseLang;
	});

	if (!candidates.length) {
		return null;
	}

	// If normalizedLang has a region, prefer exact regional match
	if (normalizedLang.includes('-')) {
		let exactMatch = candidates.find(c => normalizeLanguage(c) === normalizedLang);
		if (exactMatch) {
			return exactMatch;
		}
	}

	// Use preferred region to pick the best match
	let preferredRegion = getPreferredRegion(baseLang);
	if (preferredRegion) {
		let regionMatch = candidates.find(c => {
			let normalized = normalizeLanguage(c);
			return normalized === `${baseLang}-${preferredRegion}`;
		});
		if (regionMatch) {
			return regionMatch;
		}
	}

	return candidates[0];
}
