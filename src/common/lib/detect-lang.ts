import { eld } from 'eld/medium';

export function detectLang(text: string): string | null {
	let detection = eld.detect(text);
	if (detection.isReliable()) {
		return detection.language;
	}
	return null;
}

/**
 * Extract a sample of up to `length` characters centered on the middle of
 * the text, for more accurate detection (skipping abstracts, names, etc.,
 * that could confuse the detector)
 */
export function sampleMiddle(text: string, length: number): string {
	if (text.length <= length) {
		return text;
	}
	let start = Math.floor((text.length - length) / 2);
	return text.slice(start, start + length);
}
