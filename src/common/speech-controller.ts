import { Position } from "./types";
import { isSafari } from "./lib/utilities";

class SpeechController extends EventTarget {
	private readonly _segments: Segment[];

	private readonly _lang?: string;

	private readonly _utterances: SpeechSynthesisUtterance[];

	private _speed = 1;

	private _voice: SpeechSynthesisVoice | null = null;

	private _position = 0;

	private _paused = true;

	constructor(options: { segments: Segment[], lang?: string }) {
		super();

		this._segments = options.segments.filter(segment => segment.text.trim());
		this._lang = options.lang;

		this._utterances = this._segments
			.map((segment, i) => {
				let utterance = new SpeechSynthesisUtterance(segment.text);
				if (this._lang !== undefined) {
					utterance.lang = this._lang;
				}
				utterance.onstart = () => {
					this._position = i;
					this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', segment));
				};
				utterance.onend = () => {
					// Don't dispatch ActiveSegmentChange if segment ended due to pause
					if (this._paused) return;
					this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', null));
				};
				return utterance;
			});
	}

	private _update() {
		if (this._voice === null) {
			this._voice = this._getDefaultVoice();
		}

		window.speechSynthesis.cancel();

		// We don't use speechSynthesis.pause()/resume() because of poor browser support
		// (waking from sleep will unpause in Firefox, pausing before .speak()
		// has no effect in Chrome, ...)
		if (!this._paused) {
			for (let utterance of this._utterances.slice(this._position)) {
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
		this._update();
	}

	get paused() {
		return this._paused;
	}

	set paused(paused) {
		this._paused = paused;
		this._update();
	}

	get voices(): Map<string, [string, string][]> {
		let voices = window.speechSynthesis.getVoices()
			.sort((v1, v2) => (this._getScore(v2) - this._getScore(v1)));
		let seenVoiceURIs = new Set<string>(); // Safari returns duplicates
		let groups = new Map<string, [string, string][]>();
		for (let voice of voices) {
			if (seenVoiceURIs.has(voice.voiceURI)) {
				continue;
			}
			seenVoiceURIs.add(voice.voiceURI);

			if (!groups.has(voice.lang)) {
				groups.set(voice.lang, []);
			}
			groups.get(voice.lang)!.push([voice.voiceURI, voice.name]);
		}
		return groups;
	}

	get voice() {
		return this._voice?.voiceURI ?? null;
	}

	set voice(voiceURI: string | null) {
		this._voice = voiceURI && window.speechSynthesis.getVoices().find(
			voice => voice.voiceURI === voiceURI
		) || null;
		this._update();
	}

	skipBack() {
		this._position = Math.max(this._position - 1, 0);
		this._update();
		if (this._paused) {
			this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', this._segments[this._position]));
		}
	}

	skipAhead() {
		this._position = Math.min(this._position + 1, this._utterances.length - 1);
		this._update();
		if (this._paused) {
			this.dispatchEvent(new SpeechControllerEvent('ActiveSegmentChange', this._segments[this._position]));
		}
	}

	dispose() {
		window.speechSynthesis.cancel();
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
