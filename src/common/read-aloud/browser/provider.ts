import { ReadAloudProvider } from '../provider';
import { BrowserReadAloudVoice } from './voice';

export class BrowserReadAloudProvider implements ReadAloudProvider<BrowserReadAloudVoice> {
	readonly creditsRemaining = null;

	async getVoices(): Promise<BrowserReadAloudVoice[]> {
		if (!window.speechSynthesis.getVoices().length) {
			await new Promise((resolve) => {
				window.speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
			});
		}
		let voices = window.speechSynthesis.getVoices();
		// Safari returns duplicates
		let uniqueById = new Map<string, SpeechSynthesisVoice>();
		for (let voice of voices) {
			uniqueById.set(voice.voiceURI, voice);
		}
		return Array.from(uniqueById.values())
			.map(v => new BrowserReadAloudVoice(this, v))
			.sort((a, b) => b.score - a.score);
	}
}
