import { ReadAloudProvider } from '../provider';
import { BrowserReadAloudVoice } from './voice';

// On platforms with no speech synthesis backend available (e.g. Linux without
// speech-dispatcher installed), the voice list stays permanently empty and
// 'voiceschanged' never fires. Give up after this long so that callers awaiting
// us alongside the remote provider aren't blocked forever.
const VOICES_CHANGED_TIMEOUT = 3000;

export class BrowserReadAloudProvider implements ReadAloudProvider {
	readonly standardCreditsRemaining = null;

	readonly premiumCreditsRemaining = null;

	async getVoices(): Promise<BrowserReadAloudVoice[]> {
		if (!window.speechSynthesis.getVoices().length) {
			await new Promise<void>((resolve) => {
				let timeout: ReturnType<typeof setTimeout>;
				let done = () => {
					clearTimeout(timeout);
					window.speechSynthesis.removeEventListener('voiceschanged', done);
					resolve();
				};
				timeout = setTimeout(done, VOICES_CHANGED_TIMEOUT);
				window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
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
