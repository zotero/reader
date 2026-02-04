import { ReadAloudSegment } from '../../types';
import { debounce } from '../../lib/debounce';
import { ReadAloudController } from '../controller';
import { BrowserReadAloudVoice } from './voice';

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
		window.speechSynthesis.cancel();

		// We don't use speechSynthesis.pause()/resume() because of poor browser support
		// (waking from sleep will unpause in Firefox, pausing before .speak()
		// has no effect in Chrome, ...)
		if (!this._paused) {
			let utterance = this._utterances[this._position];
			if (utterance) {
				utterance.rate = this._speed;
				this.buffering = true;
				window.speechSynthesis.speak(utterance);
			}
		}
	});

	protected _stop(): void {
		window.speechSynthesis.cancel();
	}

	protected override _handleSegmentStart(segment: ReadAloudSegment, index: number) {
		super._handleSegmentStart(segment, index);
		this._charIndex = 0;
		this.buffering = false;
	}

	override destroy() {
		super.destroy();
		this._position = -1;
		window.speechSynthesis.cancel();
	}
}
