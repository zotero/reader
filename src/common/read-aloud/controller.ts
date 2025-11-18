import { ReadAloudSegment } from '../types';

export abstract class ReadAloudController extends EventTarget {
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

	protected constructor(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super();
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

export class ReadAloudEvent extends Event {
	segment: ReadAloudSegment | null;

	constructor(type: string, segment: ReadAloudSegment | null) {
		super(type);
		this.segment = segment;
	}
}
