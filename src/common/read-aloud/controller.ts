import { ReadAloudSegment } from '../types';
import { ReadAloudVoice } from './voice';
import { ReadAloudProvider } from './provider';

export abstract class ReadAloudController<TVoice extends ReadAloudVoice<unknown, ReadAloudProvider>> extends EventTarget {
	readonly voice: TVoice;

	protected readonly _segments: ReadAloudSegment[];

	protected _position: number;

	private _buffering = false;

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

	get buffering() {
		return this._buffering;
	}

	protected set buffering(buffering) {
		if (this._buffering === buffering) {
			return;
		}
		this._buffering = buffering;
		this.dispatchEvent(new ReadAloudEvent('BufferingChange', this._currentSegment));
	}

	get secondsRemaining(): number | null {
		let creditsRemaining = this.voice.provider.creditsRemaining;
		let creditsPerSecond = this.voice.creditsPerSecond;
		if (creditsRemaining === null || creditsPerSecond === null) {
			return null;
		}
		return creditsRemaining / creditsPerSecond;
	}

	private get _currentSegment() {
		return this._segments[this._position];
	}

	protected constructor(voice: TVoice, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super();
		this.voice = voice;
		this._position = backwardStopIndex ?? 0;
		this._backwardStopIndex = backwardStopIndex;
		this._forwardStopIndex = forwardStopIndex;

		this._segments = segments;
	}

	skipBack() {
		let previousIndex = this._segments.slice(0, this._position).findLastIndex(
			segment => segment.anchor === 'paragraphStart'
		);
		if (previousIndex === -1) {
			previousIndex = this._position - 1;
		}
		this._position = Math.max(previousIndex, 0);
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChanging', this._currentSegment));
		this._speak();
		if (this._paused) {
			this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._currentSegment));
		}
	}

	skipAhead() {
		let nextIndex = this._segments.slice(this._position + 1).findIndex(
			segment => segment.anchor === 'paragraphStart'
		);
		if (nextIndex === -1) {
			nextIndex = 0;
		}
		this._position = Math.min(nextIndex + this._position + 1, this._segments.length - 1);
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChanging', this._currentSegment));
		this._speak();
		if (this._paused) {
			this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._currentSegment));
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
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChanging', null));
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', null));

		if (this._position === index) {
			if (this._forwardStopIndex !== null && this._position === this._forwardStopIndex - 1) {
				this._position = Math.min(this._position + 1, this._segments.length - 1);
				this._forwardStopIndex = null;
				this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChanging', this._currentSegment));
				this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._currentSegment));
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

export class ReadAloudEvent extends Event {
	segment: ReadAloudSegment | null;

	constructor(type: string, segment: ReadAloudSegment | null) {
		super(type);
		this.segment = segment;
	}
}
