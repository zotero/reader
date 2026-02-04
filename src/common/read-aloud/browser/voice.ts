import { ReadAloudVoice } from '../voice';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { BrowserReadAloudController } from './controller';
import { isSafari } from '../../lib/utilities';
import { BrowserReadAloudProvider } from './provider';

export class BrowserReadAloudVoice extends ReadAloudVoice<SpeechSynthesisVoice, BrowserReadAloudProvider> {
	get id(): string {
		return this.impl.voiceURI;
	}

	get label(): string {
		return this.impl.name;
	}

	get languages(): string[] {
		return [this.impl.lang];
	}

	get score(): number {
		// Safari claims *every* voice is the default, so just ignore that
		if (!isSafari && this.impl.default) {
			return 5;
		}

		// Use URIs to guess voice quality. This works well in Firefox and Safari
		// on macOS, but unfortunately Chrome (and Firefox on Windows) just use
		// the human-readable labels as "URIs." Nothing we can do there.

		// Best available voices
		if (this.impl.voiceURI.includes('com.apple.voice.premium')) {
			return 4;
		}
		// Pretty good voices
		if (this.impl.voiceURI.includes('com.apple.voice.enhanced')) {
			return 3;
		}
		// Decent voices
		if (this.impl.voiceURI.includes('com.apple.voice.compact')) {
			return 2;
		}
		// Antique voices (e.g. Zarvox)
		if (this.impl.voiceURI.includes('com.apple.speech')) {
			return 1;
		}
		// Everything else/other platforms
		return 1;
	}

	get segmentGranularity(): ReadAloudGranularity {
		return 'sentence';
	}

	get creditsPerSecond() {
		return null;
	}

	getController(lang: string, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		return new BrowserReadAloudController(this, lang, segments, backwardStopIndex, forwardStopIndex);
	}

	getSampleController(lang: string, segments: ReadAloudSegment[]) {
		return new BrowserReadAloudController(this, lang, segments, null, null);
	}
}
