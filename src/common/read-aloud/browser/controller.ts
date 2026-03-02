import { ReadAloudSegment } from '../../types';
import { debounce } from '../../lib/debounce';
import { ReadAloudController } from '../controller';
import { BrowserReadAloudVoice } from './voice';
import { isMac } from '../../lib/utilities';

// Track which controller instance last called speechSynthesis.speak(),
// so that other instances don't cancel its speech via the global
// speechSynthesis.cancel()
let lastSpeaker: BrowserReadAloudController | null = null;

export class BrowserReadAloudController extends ReadAloudController {
	declare readonly voice: BrowserReadAloudVoice;

	private readonly _utterances: SpeechSynthesisUtterance[];

	private _charIndex = 0;

	private _segmentStartTime: number | null = null;

	constructor(voice: BrowserReadAloudVoice, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(voice, segments, backwardStopIndex, forwardStopIndex);
		this._utterances = segments.map((segment, index) => {
			let utterance = new SpeechSynthesisUtterance(segment.text);
			utterance.voice = this.voice.impl;
			utterance.onstart = () => this._handleSegmentStart(segment, index);
			utterance.onend = () => this._handleSegmentEnd(segment, index);
			utterance.onboundary = event => this._charIndex = event.charIndex;
			return utterance;
		});
	}

	protected override get _segmentProgressFraction(): number {
		let segment = this._currentSegment;
		if (!segment || !segment.text.length) {
			return 0;
		}
		return this._charIndex / segment.text.length;
	}

	protected override get _segmentProgressSeconds(): number {
		if (this._segmentStartTime === null) {
			return 0;
		}
		return (performance.now() - this._segmentStartTime) / 1000 * this._speed;
	}

	protected _speak = debounce(() => {
		// Only cancel speechSynthesis if we're the last controller to have
		// called speak(). window.speechSynthesis is global, so cancelling
		// unconditionally could kill speech by another controller
		// (like a sample controller) that was initialized while this
		// controller was still alive.
		if (lastSpeaker === this || lastSpeaker === null) {
			window.speechSynthesis.cancel();
		}

		// We don't use speechSynthesis.pause()/resume() because of poor browser support
		// (waking from sleep will unpause in Firefox, pausing before .speak()
		// has no effect in Chrome, ...)
		if (!this._paused) {
			let utterance = this._utterances[this._position];
			if (utterance) {
				if (isMac()) {
					// macOS speech synthesis uses speeds in WPM. Firefox uses
					// (rate * 200 wpm), but the system default speed is 180 wpm.
					// Scale to match.
					utterance.rate = this._speed * 0.9;
				}
				else {
					utterance.rate = this._speed;
				}
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
		this._segmentStartTime = performance.now();
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
