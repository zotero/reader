import { ReadAloudSegment } from '../../types';
import { debounce } from '../../lib/debounce';
import { ReadAloudController } from '../controller';
import { BrowserReadAloudVoice } from './voice';

// Track which controller instance last called speechSynthesis.speak(),
// so that other instances don't cancel its speech via the global
// speechSynthesis.cancel()
let lastSpeaker: BrowserReadAloudController | null = null;

export class BrowserReadAloudController extends ReadAloudController<BrowserReadAloudVoice> {
	private readonly _utterances: SpeechSynthesisUtterance[];

	private _charIndex = 0;

	constructor(voice: BrowserReadAloudVoice, lang: string, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(voice, lang, segments, backwardStopIndex, forwardStopIndex);
		this._utterances = segments.map((segment, index) => {
			let utterance = new SpeechSynthesisUtterance(segment.text);
			utterance.voice = this.voice.impl;
			utterance.onstart = () => this._handleSegmentStart(segment, index);
			utterance.onend = () => this._handleSegmentEnd(segment, index);
			utterance.onboundary = event => this._charIndex = event.charIndex;
			return utterance;
		});
	}

	override get segmentProgress(): number {
		let segment = this._currentSegment;
		if (!segment || !segment.text.length) {
			return 0;
		}
		return this._charIndex / segment.text.length;
	}

	protected _speak = debounce(() => {
		// Only cancel speechSynthesis if we're the last controller to have
		// called speak(). speechSynthesis is global, so canceling
		// unconditionally would kill speech from other controllers (e.g.
		// sample playback).
		if (lastSpeaker === this || lastSpeaker === null) {
			window.speechSynthesis.cancel();
		}

		// We don't use speechSynthesis.pause()/resume() because of poor browser support
		// (waking from sleep will unpause in Firefox, pausing before .speak()
		// has no effect in Chrome, ...)
		if (!this._paused) {
			let utterance = this._utterances[this._position];
			if (utterance) {
				utterance.rate = this._speed;
				this.buffering = true;
				// eslint-disable-next-line @typescript-eslint/no-this-alias,consistent-this
				lastSpeaker = this;
				window.speechSynthesis.speak(utterance);
			}
		}
	});

	protected _stop(): void {
		if (lastSpeaker === this || lastSpeaker === null) {
			window.speechSynthesis.cancel();
		}
	}

	protected override _handleSegmentStart(segment: ReadAloudSegment, index: number) {
		super._handleSegmentStart(segment, index);
		this._charIndex = 0;
		this.buffering = false;
	}

	override destroy() {
		super.destroy();
		this._speak.cancel();
		this._position = -1;
		if (lastSpeaker === this) {
			lastSpeaker = null;
			window.speechSynthesis.cancel();
		}
	}
}
