import { ReadAloudProvider } from '../provider';
import { BrowserReadAloudVoice } from './voice';
import { pickLocale } from 'locale-matcher';

export class BrowserReadAloudProvider implements ReadAloudProvider<BrowserReadAloudVoice> {
	readonly creditsRemaining = null;

	async getLanguages(): Promise<string[] | null> {
		if (!window.speechSynthesis.getVoices().length) {
			await new Promise((resolve) => {
				window.speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
			});
		}
		let voices = window.speechSynthesis.getVoices();
		return [...new Set(voices.map(v => v.lang))];
	}

	async getVoices(lang: string): Promise<BrowserReadAloudVoice[]> {
		if (!window.speechSynthesis.getVoices().length) {
			await new Promise((resolve) => {
				window.speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
			});
		}
		let voices = window.speechSynthesis.getVoices();
		let uniqueById = new Map<string, SpeechSynthesisVoice>();
		for (let voice of voices) {
			uniqueById.set(voice.voiceURI, voice); // Safari returns duplicates
		}
		voices = Array.from(uniqueById.values());
		lang = pickLocale(lang, voices.map(v => v.lang)) || lang;
		return voices
			.filter(v => v.lang.startsWith(lang))
			.map(v => new BrowserReadAloudVoice(this, v))
			.sort((a, b) => b.score - a.score);
	}
}
