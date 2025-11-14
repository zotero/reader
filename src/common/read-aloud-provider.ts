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

	protected _forwardStopIndex: number | null;

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
			if (this._forwardStopIndex !== null && this._position === this._forwardStopIndex - 1) {
				this._position = Math.min(this._position + 1, this._segments.length - 1);
				this._forwardStopIndex = null;
				this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._segments[this._position]));
				this.dispatchEvent(new ReadAloudEvent('Complete', null));
			}
			else if (this._position === this._segments.length - 1) {
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
			if (utterance) {
				utterance.rate = this._speed;
				window.speechSynthesis.speak(utterance);
			}
		}
	});

	destroy() {
		this._position = -1;
		window.speechSynthesis.cancel();
	}
}

const REMOTE_ENDPOINT = 'http://localhost:4080';

class RemoteReadAloudProvider implements ReadAloudProvider {
	private readonly _voice: { id: string, label: string };

	private static _PROVIDERS: RemoteReadAloudProvider[] | null = null;

	private static _providersPromise: Promise<void> | null = null;

	constructor(voice: { id: string, label: string }) {
		this._voice = voice;
	}

	get id() {
		return this._voice.id;
	}

	get label() {
		return this._voice.label;
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

	static waitForProviders(): Promise<void> {
		if (!this._providersPromise) {
			this._providersPromise = (async () => {
				let providers: RemoteReadAloudProvider[] = [];
				let voices = await fetch(`${REMOTE_ENDPOINT}/voices`).then(r => r.json());
				for (let { id, label } of voices) {
					providers.push(new RemoteReadAloudProvider({ id, label }));
				}
				this._PROVIDERS = providers;
			})();
		}
		return this._providersPromise;
	}

	static getAvailableProviders(): ReadAloudProvider[] {
		return this._PROVIDERS ?? [];
	}
}

class RemoteReadAloudController extends ReadAloudController {
	private readonly _audios: HTMLAudioElement[];

	constructor(provider: ReadAloudProvider, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(provider, segments, backwardStopIndex, forwardStopIndex);

		// Create elements now, but only set src later, when we want to load a segment
		this._audios = segments.map((segment, index) => {
			let audio = document.createElement('audio');
			audio.oncanplaythrough = () => this._handleSegmentCanPlayThrough(segment, index);
			audio.onplaying = () => this._handleSegmentStart(segment, index);
			audio.onended = () => this._handleSegmentEnd(segment, index);
			return audio;
		});
	}

	protected _handleSegmentCanPlayThrough(_segment: ReadAloudSegment, index: number) {
		let nextIndex = index + 1;
		if (nextIndex >= this._segments.length || index >= this._position + 3) {
			return;
		}
		this._audios[nextIndex].preload = 'auto';
	}

	protected _speak(): void {
		for (let audio of this._audios) {
			audio.pause();
		}

		for (let index = 0; index < this._audios.length; index++) {
			let segment = this._segments[index];
			let audio = this._audios[index];

			audio.preload = 'none';
			let src = this._getAudioURL(segment);
			if (audio.src !== src) {
				audio.src = src;
			}
		}

		if (!this._paused) {
			let audio = this._audios[this._position];
			audio.preload = 'auto';
			audio.currentTime = 0;
			audio.play();
		}
	}

	protected _getAudioURL(segment: ReadAloudSegment) {
		let params = new URLSearchParams();
		params.set('voice', this.provider.id);
		params.set('text', segment.text);
		params.set('speed', this._speed.toString());
		return `${REMOTE_ENDPOINT}/?${params}`;
	}

	destroy(): void {
		for (let audio of this._audios) {
			audio.pause();
		}
	}
}

export async function waitForProviders(): Promise<void> {
	await Promise.allSettled(
		[BrowserReadAloudProvider, RemoteReadAloudProvider]
			.map(providerClass => providerClass.waitForProviders())
	);
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
