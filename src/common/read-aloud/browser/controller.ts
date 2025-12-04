import { ReadAloudSegment } from '../../types';
import { debounce } from '../../lib/debounce';
import { ReadAloudController } from '../controller';
import { BrowserReadAloudProvider } from './provider';

export class BrowserReadAloudController extends ReadAloudController {
	readonly voice: SpeechSynthesisVoice;

	private readonly _utterances: SpeechSynthesisUtterance[];

	constructor(provider: BrowserReadAloudProvider, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(provider, segments, backwardStopIndex, forwardStopIndex);
		this.voice = provider.voice;
		this._utterances = segments.map((segment, index) => {
			let utterance = new SpeechSynthesisUtterance(segment.text);
			utterance.voice = this.voice;
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
				this.buffering = true;
				window.speechSynthesis.speak(utterance);
			}
		}
	});

	protected override _handleSegmentStart(segment: ReadAloudSegment, index: number) {
		super._handleSegmentStart(segment, index);
		this.buffering = false;
	}

	destroy() {
		this._position = -1;
		window.speechSynthesis.cancel();
	}
}
