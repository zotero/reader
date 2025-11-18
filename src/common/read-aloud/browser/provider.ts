import { isSafari } from '../../lib/utilities';
import { ReadAloudProvider } from '../provider';
import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { BrowserReadAloudController } from './controller';

export class BrowserReadAloudProvider implements ReadAloudProvider {
	readonly voice: SpeechSynthesisVoice;

	constructor(voice: SpeechSynthesisVoice) {
		this.voice = voice;
	}

	get id(): string {
		return this.voice.voiceURI;
	}

	get label(): string {
		return this.voice.name;
	}

	get lang(): string {
		return this.voice.lang;
	}

	get score(): number {
		// Safari claims *every* voice is the default, so just ignore that
		if (!isSafari && this.voice.default) {
			return 5;
		}

		// Use URIs to guess voice quality. This works well in Firefox and Safari
		// on macOS, but unfortunately Chrome (and Firefox on Windows) just use
		// the human-readable labels as "URIs." Nothing we can do there.

		// Best available voices
		if (this.voice.voiceURI.includes('com.apple.voice.premium')) {
			return 4;
		}
		// Pretty good voices
		if (this.voice.voiceURI.includes('com.apple.voice.enhanced')) {
			return 3;
		}
		// Decent voices
		if (this.voice.voiceURI.includes('com.apple.voice.compact')) {
			return 2;
		}
		// Antique voices (e.g. Zarvox)
		if (this.voice.voiceURI.includes('com.apple.speech')) {
			return 1;
		}
		// Everything else/other platforms
		return 1;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null): ReadAloudController {
		return new BrowserReadAloudController(this.voice, segments, backwardStopIndex, forwardStopIndex);
	}

	static async waitForProviders(): Promise<void> {
		if (!this.getAvailableProviders().length) {
			await new Promise(
				resolve => window.speechSynthesis.addEventListener('voiceschanged', resolve)
			);
		}
	}

	static getAvailableProviders(): ReadAloudProvider[] {
		let voices = window.speechSynthesis.getVoices();
		let idsToNames = new Map<string, string>(); // Safari returns duplicates
		for (let voice of voices) {
			idsToNames.set(voice.voiceURI, voice.name);
		}
		return voices
			.map(v => new BrowserReadAloudProvider(v))
			.sort((a, b) => b.score - a.score);
	}
}
