import { ReadAloudVoice, Tier } from '../voice';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { BrowserReadAloudController } from './controller';
import { isMac, isSafari } from '../../lib/utilities';
import { BrowserReadAloudProvider } from './provider';

export class BrowserReadAloudVoice extends ReadAloudVoice {
	declare readonly impl: SpeechSynthesisVoice;

	declare readonly provider: BrowserReadAloudProvider;

	get id(): string {
		return 'local-' + this.impl.voiceURI;
	}

	get label(): string {
		if (isMac()) {
			// Disambiguate macOS "Premium" voices from remote premium voices
			return this.impl.name.replace('(Premium)', '(macOS Premium)');
		}
		return this.impl.name;
	}

	get language(): string {
		return this.impl.lang;
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

	get creditsPerMinute() {
		return null;
	}

	get tier(): Tier {
		return 'local';
	}

	get default() {
		// TODO
		return true;
	}

	get sentenceDelay() {
		return 0;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		return new BrowserReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}

	getSampleController(segments: ReadAloudSegment[]) {
		return new BrowserReadAloudController(this, segments, null, null);
	}
}
