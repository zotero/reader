import { ReadAloudVoice } from './voice';

// Equivalents for nonstandard language codes
const LANGUAGE_EQUIVALENTS: Record<string, string> = {
	cmn: 'zh', // Chinese
};

// And region codes
const REGION_EQUIVALENTS: Record<string, string> = {
	XA: '001', // Arabic
	SA: '001', // Arabic
};

function normalizeLanguage(lang: string): string {
	let base = lang.replace(/-.+$/, '');
	let region = lang.includes('-') ? lang.substring(base.length + 1) : '';
	let normalizedBase = LANGUAGE_EQUIVALENTS[base] ?? base;
	let normalizedRegion = REGION_EQUIVALENTS[region] ?? region;
	return normalizedRegion ? `${normalizedBase}-${normalizedRegion}` : normalizedBase;
}

export function getSupportedLanguages(voices: ReadAloudVoice<never, never>[]): string[] {
	// Normalize to base language codes, removing the region component
	return [...new Set(
		voices.flatMap(
			voice => voice.languages.map(
				lang => normalizeLanguage(lang).replace(/-.+$/, '')
			)
		)
	)] as string[];
}

export function voiceSupportsLanguage(voiceLanguages: string[], lang: string): boolean {
	let normalizedLang = normalizeLanguage(lang);
	let baseLang = normalizedLang.replace(/-.+$/, '');
	let hasRegion = normalizedLang.includes('-');

	for (let voiceLang of voiceLanguages) {
		let normalizedVoiceLang = normalizeLanguage(voiceLang);
		let voiceBaseLang = normalizedVoiceLang.replace(/-.+$/, '');
		let voiceHasRegion = normalizedVoiceLang.includes('-');

		// Base languages must match
		if (voiceBaseLang !== baseLang) {
			continue;
		}

		// If no region specified, accept any variant
		if (!hasRegion) {
			return true;
		}

		// If region specified, accept voices with matching region or no region
		if (!voiceHasRegion || normalizedVoiceLang === normalizedLang) {
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

export function resolveLanguage(contentLang: string, voiceLangs: string[]) {
	if (!voiceLangs.length) {
		return contentLang;
	}

	let normalizedContentLang = normalizeLanguage(contentLang);
	let contentBaseLang = normalizedContentLang.replace(/-.+$/, '');
	let contentRegion = normalizedContentLang.includes('-')
		? normalizedContentLang.substring(contentBaseLang.length + 1)
		: '';

	// If content has no region preference, use the user's locale if it matches
	let preferredRegion = contentRegion;
	if (!contentRegion) {
		let userLang = navigator.languages[0];
		let normalizedUserLang = normalizeLanguage(userLang);
		if (normalizedUserLang.startsWith(contentBaseLang + '-')) {
			preferredRegion = normalizedUserLang.substring(contentBaseLang.length + 1);
		}
	}

	// Find matching voice languages
	let candidates: { original: string; normalized: string }[] = [];
	for (let voiceLang of voiceLangs) {
		let normalizedVoiceLang = normalizeLanguage(voiceLang);
		let voiceBaseLang = normalizedVoiceLang.replace(/-.+$/, '');
		if (voiceBaseLang === contentBaseLang) {
			candidates.push({ original: voiceLang, normalized: normalizedVoiceLang });
		}
	}

	if (!candidates.length) {
		return null;
	}

	// Prefer exact match with preferred region
	let preferredMatch = candidates.find(
		c => c.normalized === `${contentBaseLang}-${preferredRegion}`
	);
	if (preferredMatch) {
		return preferredMatch.original;
	}

	// Then exact region match with content region
	if (contentRegion && contentRegion !== preferredRegion) {
		let contentMatch = candidates.find(
			c => c.normalized === `${contentBaseLang}-${contentRegion}`
		);
		if (contentMatch) {
			return contentMatch.original;
		}
	}

	// Then voice with no region
	let noRegionMatch = candidates.find(
		c => !c.normalized.includes('-')
	);
	if (noRegionMatch) {
		return noRegionMatch.original;
	}

	// Fall back to first matching voice language
	return candidates[0].original;
}

export function getAllRegions(
	voices: ReadAloudVoice<never, never>[]
): Record<string, string[]> {
	let regionsByLang: Record<string, Set<string>> = {};
	for (let voice of voices) {
		for (let lang of voice.languages) {
			let normalizedLang = normalizeLanguage(lang);
			let match = normalizedLang.match(/^([a-z]{2,3})-(.+)$/);
			if (match) {
				let [, baseLang, region] = match;
				if (!regionsByLang[baseLang]) {
					regionsByLang[baseLang] = new Set();
				}
				regionsByLang[baseLang].add(region);
			}
		}
	}
	let result: Record<string, string[]> = {};
	for (let lang in regionsByLang) {
		result[lang] = Array.from(regionsByLang[lang]).sort();
	}
	return result;
}
