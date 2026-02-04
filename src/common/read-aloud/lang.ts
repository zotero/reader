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
 * Find the best match for contentLang among a list of language codes (e.g. persisted voice keys).
 */
export function resolveLanguage(contentLang: string, langs: string[]) {
	if (!langs.length) {
		return contentLang;
	}

	let normalizedContentLang = normalizeLanguage(contentLang);
	let contentBaseLang = normalizedContentLang.replace(/-.+$/, '');

	// Find matching languages
	let candidates: { original: string; normalized: string }[] = [];
	for (let lang of langs) {
		let normalizedLang = normalizeLanguage(lang);
		let baseLang = normalizedLang.replace(/-.+$/, '');
		if (baseLang === contentBaseLang) {
			candidates.push({ original: lang, normalized: normalizedLang });
		}
	}

	if (!candidates.length) {
		return null;
	}

	// Prefer exact match
	let exactMatch = candidates.find(c => c.normalized === normalizedContentLang);
	if (exactMatch) {
		return exactMatch.original;
	}

	// Fall back to first matching language
	return candidates[0].original;
}
