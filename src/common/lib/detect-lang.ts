import { eld } from 'eld/medium';

export function detectLang(text: string): string | null {
	let detection = eld.detect(text);
	if (detection.isReliable()) {
		return detection.language;
	}
	return null;
}
