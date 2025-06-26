import { Position } from "./types";
import { isSafari } from "./lib/utilities";

class SpeechController extends EventTarget {
	private readonly _segments: Segment[];

	private readonly _lang?: string;

	private readonly _utterances: SpeechSynthesisUtterance[];

	private _speed = 1;

	private _voice: SpeechSynthesisVoice | null = null;

	private _index = 0;

	private _backwardStopIndex: number | null;

	private _forwardStopIndex: number | null;

	private _paused = true;

	constructor(options: {
		segments: Segment[],
		lang?: string,
		backwardStopIndex: number | null,
		forwardStopIndex: number | null,
	}) {
		super();

		this._segments = options.segments;
		this._lang = options.lang;
		this._backwardStopIndex = options.backwardStopIndex;
		this._forwardStopIndex = options.forwardStopIndex;

		if (this._backwardStopIndex !== null) {
			this._index = this._backwardStopIndex;
		}

		this._utterances = this._segments
			.map((segment, index) => {
				let utterance = new SpeechSynthesisUtterance(segment.text);
				if (this._lang !== undefined) {
					utterance.lang = this._lang;
				}
				utterance.onstart = () => this._handleSegmentStart(segment, index);
				utterance.onend = () => this._handleSegmentEnd(segment, index);
				return utterance;
			});
	}

	update() {
		if (this._voice === null) {
			this._voice = this._getDefaultVoice();
		}

		window.speechSynthesis.cancel();

		// We don't use speechSynthesis.pause()/resume() because of poor browser support
		// (waking from sleep will unpause in Firefox, pausing before .speak()
		// has no effect in Chrome, ...)
		if (!this._paused) {
			for (let utterance of this._buildUtteranceQueue()) {
				utterance.rate = this._speed;
				utterance.voice = this._voice;
				window.speechSynthesis.speak(utterance);
			}
		}
	}

	get speed() {
		return this._speed;
	}

	set speed(speed) {
		this._speed = speed;
	}

	get paused() {
		return this._paused;
	}

	set paused(paused) {
		this._paused = paused;
	}

	get languages(): string[] {
		let languages = new Set<string>();
		for (let voice of window.speechSynthesis.getVoices()) {
			languages.add(voice.lang);
		}
		return [...languages];
	}

	getVoices(lang: string): Map<string, string> {
		let voices = window.speechSynthesis.getVoices()
			.filter(voice => voice.lang === lang)
			.sort((v1, v2) => (this._getScore(v2) - this._getScore(v1)));
		let idsToNames = new Map<string, string>(); // Safari returns duplicates
		for (let voice of voices) {
			idsToNames.set(voice.voiceURI, voice.name);
		}
		return idsToNames;
	}

	get voice() {
		return this._voice?.voiceURI ?? null;
	}

	set voice(voiceURI: string | null) {
		this._voice = voiceURI && window.speechSynthesis.getVoices().find(
			voice => voice.voiceURI === voiceURI
		) || null;
	}

	skipBack() {
		this._index = Math.max(this._index - 1, 0);
		this.update();
		if (this._paused) {
			this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', this._segments[this._index]));
		}
	}

	skipAhead() {
		this._index = Math.min(this._index + 1, this._utterances.length - 1);
		this.update();
		if (this._paused) {
			this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', this._segments[this._index]));
		}
	}

	dispose() {
		window.speechSynthesis.cancel();
	}

	private _handleSegmentStart(segment: Segment, index: number) {
		this._index = index;
		this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', segment));
	}

	private _handleSegmentEnd(_segment: Segment, _index: number) {
		// Don't dispatch ActiveSegmentChange if segment ended due to pause
		if (this._paused) {
			return;
		}
		this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', null));

		if (!window.speechSynthesis.pending) {
			if (this._index === this._segments.length - 1) {
				this._index = 0;
			}
			else {
				this._index++;
			}
			this.dispatchEvent(new SpeechControllerEvent('Complete', null));
		}
	}

	private _buildUtteranceQueue() {
		// If we're within the stops, return the utterances up to the forward stop
		if (this._backwardStopIndex !== null
				&& this._forwardStopIndex !== null
				&& this._index >= this._backwardStopIndex
				&& this._index < this._forwardStopIndex) {
			return this._utterances.slice(this._index, this._forwardStopIndex);
		}
		else {
			// Otherwise, return everything after our current position, and clear the stops
			this._backwardStopIndex = null;
			this._forwardStopIndex = null;
			return this._utterances.slice(this._index);
		}
	}

	private _getDefaultVoice() {
		let lang = this._lang || '';
		if (lang === 'en') {
			// Special case to avoid en-AU being used for en because it comes
			// first alphabetically
			lang = 'en-US';
		}

		let bestCandidate: SpeechSynthesisVoice | null = null;
		let bestScore = 0;
		for (let voice of window.speechSynthesis.getVoices()) {
			if (!voice.lang.startsWith(lang)) {
				continue;
			}

			let score = this._getScore(voice);
			if (score > bestScore) {
				bestCandidate = voice;
				bestScore = score;
			}
		}
		return bestCandidate;
	}

	private _getScore(voice: SpeechSynthesisVoice): number {
		// Safari claims *every* voice is the default, so just ignore that
		if (!isSafari && voice.default) {
			return 5;
		}

		// Use URIs to guess voice quality. This works well in Firefox and Safari
		// on macOS, but unfortunately Chrome (and Firefox on Windows) just use
		// the human-readable labels as "URIs." Nothing we can do there.

		// Best available voices
		if (voice.voiceURI.includes('com.apple.voice.premium')) {
			return 4;
		}
		// Pretty good voices
		if (voice.voiceURI.includes('com.apple.voice.enhanced')) {
			return 3;
		}
		// Decent voices
		if (voice.voiceURI.includes('com.apple.voice.compact')) {
			return 2;
		}
		// Antique voices (e.g. Zarvox)
		if (voice.voiceURI.includes('com.apple.speech')) {
			return 1;
		}
		// Everything else/other platforms
		return 1;
	}
}

export class SpeechControllerEvent extends Event {
	readonly segment: Segment | null;

	constructor(type: string, segment: Segment | null) {
		super(type);
		this.segment = segment;
	}
}

export type Segment = {
	position: Position;
	text: string;
}

export default SpeechController;
