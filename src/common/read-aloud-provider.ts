import { isSafari } from "./lib/utilities";
import { ReadAloudSegment } from "./types";
import { debounce } from "./lib/debounce";

export interface ReadAloudProvider {
	readonly id: string;

	readonly label: string;

	readonly lang: string;

	readonly score: number;

	getController(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController;
}

export abstract class ReadAloudController extends EventTarget {
	readonly provider: ReadAloudProvider;

	protected readonly _segments: ReadAloudSegment[];

	protected _position: number;

	protected readonly _backwardStopIndex: number | null;

	protected readonly _forwardStopIndex: number | null;

	protected _paused = false;

	protected _speed = 1;

	get paused() {
		return this._paused;
	}

	set paused(paused) {
		this._paused = paused;
		this._speak();
	}

	get speed() {
		return this._speed;
	}

	set speed(speed) {
		this._speed = speed;
		this._speak();
	}

	get position() {
		return this._position;
	}

	constructor(provider: ReadAloudProvider, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super();
		this.provider = provider;
		this._position = backwardStopIndex ?? 0;
		this._backwardStopIndex = backwardStopIndex;
		this._forwardStopIndex = forwardStopIndex;

		this._segments = segments;
	}

	skipBack() {
		this._position = Math.max(this._position - 1, 0);
		this._speak();
		if (this._paused) {
			this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._segments[this._position]));
		}
	}

	skipAhead() {
		this._position = Math.min(this._position + 1, this._segments.length - 1);
		this._speak();
		if (this._paused) {
			this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._segments[this._position]));
		}
	}

	protected abstract _speak(): void;

	abstract destroy(): void;

	protected _handleSegmentStart(segment: ReadAloudSegment, index: number) {
		this._position = index;
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', segment));
	}

	protected _handleSegmentEnd(segment: ReadAloudSegment, index: number) {
		// Don't dispatch ActiveSegmentChange if segment ended due to pause
		if (this._paused) {
			return;
		}
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', null));

		if (this._position === index) {
			if (this._position === (this._forwardStopIndex ?? this._segments.length) - 1) {
				this._position = this._backwardStopIndex ?? 0;
				this.dispatchEvent(new ReadAloudEvent('Complete', null));
			}
			else {
				this._position++;
				this._speak();
			}
		}
	}
}

class BrowserReadAloudProvider implements ReadAloudProvider {
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
		return new BrowserReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}

	static getAvailableProviders(): BrowserReadAloudProvider[] {
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

class BrowserReadAloudController extends ReadAloudController {
	private readonly _voice: SpeechSynthesisVoice;

	private readonly _utterances: SpeechSynthesisUtterance[];

	constructor(provider: BrowserReadAloudProvider, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(provider, segments, backwardStopIndex, forwardStopIndex);
		this._voice = provider.voice;
		this._utterances = segments.map((segment, index) => {
			let utterance = new SpeechSynthesisUtterance(segment.text);
			utterance.voice = this._voice;
			utterance.onstart = () => this._handleSegmentStart(segment, index);
			utterance.onend = () => this._handleSegmentEnd(segment, index);
			return utterance;
		});
	}

	protected _speak = debounce(() => {
		window.speechSynthesis.cancel();

		// We don't use speechSynthesis.pause()/resume() because of poor browser support
		// (waking from sleep will unpause in Firefox, pausing before .speak()
		// has no effect in Chrome, ...)
		if (!this._paused) {
			let utterance = this._utterances[this._position];
			utterance.rate = this._speed;
			if (utterance) window.speechSynthesis.speak(utterance);
		}
	});

	destroy() {
		this._position = -1;
		window.speechSynthesis.cancel();
	}
}

class RemoteReadAloudProvider implements ReadAloudProvider {
	get id() {
		return 'example';
	}

	get label() {
		return 'Remote Example';
	}

	get lang() {
		return 'en-US';
	}

	get score() {
		return 1;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null): ReadAloudController {
		return new RemoteReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}

	static getAvailableProviders(): RemoteReadAloudProvider[] {
		return [new RemoteReadAloudProvider()];
	}
}

class RemoteReadAloudController extends ReadAloudController {
	private _audio = document.createElement('audio');

	protected _speak(): void {
		this._audio.pause();

		if (!this._paused) {
			let songs = [
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sergio%27s Magic Dustbin.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Mesmerizing Galaxy Loop.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Lord of the Rangs.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Galactic Rap.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Equatorial Complex.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cloud Dancer.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Brain Dance.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Vibing Over Venus.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Southern Gothic.mp3",
				"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Morning.mp3",
			];

			let index = this._position;
			let segment = this._segments[index];

			this._audio.src = songs[index % songs.length];
			this._audio.currentTime = 0;
			this._audio.onplaying = () => this._handleSegmentStart(segment, index);
			this._audio.onended = () => this._handleSegmentEnd(segment, index);
			this._audio.play();
		}
	}

	destroy(): void {
		this._audio.pause();
	}
}

export function getAvailableProviders(): ReadAloudProvider[] {
	return [BrowserReadAloudProvider, RemoteReadAloudProvider]
		.flatMap(providerClass => providerClass.getAvailableProviders())
		.sort((v1, v2) => v2.score - v1.score);
}

export class ReadAloudEvent extends Event {
	segment: ReadAloudSegment | null;

	constructor(type: string, segment: ReadAloudSegment | null) {
		super(type);
		this.segment = segment;
	}
}
