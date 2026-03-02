import { ReadAloudSegment } from '../types';
import { ReadAloudVoice } from './voice';

const DELAY_PARAGRAPH = 200;

export abstract class ReadAloudController extends EventTarget {
	readonly voice: ReadAloudVoice;

	readonly lang: string;

	protected readonly _segments: ReadAloudSegment[];

	protected _position: number;

	private _buffering = false;

	protected readonly _backwardStopIndex: number | null;

	protected _forwardStopIndex: number | null;

	protected _paused = false;

	protected _speed = 1;

	protected _error: ErrorState | null = null;

	protected _destroyed = false;

	private _delayTimeout: ReturnType<typeof setTimeout> | null = null;

	get paused() {
		return this._paused;
	}

	set paused(paused) {
		this._paused = paused;
		this._clearDelayTimeout();
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

	get minutesRemaining(): number | null {
		return this.voice.minutesRemaining;
	}

	get hasStandardMinutesRemaining(): boolean {
		let { standardCreditsRemaining } = this.voice.provider;
		return standardCreditsRemaining !== null && standardCreditsRemaining > 0;
	}

	async refreshCreditsRemaining(): Promise<void> {
		// No-op for non-remote controllers
	}

	async resetCredits(): Promise<void> {
		// No-op for non-remote controllers
	}

	retry() {
		// No-op for non-remote controllers
	}

	get error() {
		return this._error;
	}

	protected abstract get _segmentProgressFraction(): number;

	protected abstract get _segmentProgressSeconds(): number;

	protected get _currentSegment() {
		return this._segments[this._position];
	}

	getSegmentToAnnotate(): ReadAloudSegment | null {
		// If less than 50% or 3 seconds into the current segment, use the previous one
		if (this._segmentProgressFraction < 0.5 || this._segmentProgressSeconds < 3) {
			let previousIndex = this._position - 1;
			if (previousIndex >= 0) {
				return this._segments[previousIndex];
			}
		}
		return this._currentSegment ?? null;
	}

	protected constructor(voice: ReadAloudVoice, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super();

		this.voice = voice;
		this.lang = voice.language;
		this._position = backwardStopIndex ?? 0;
		this._backwardStopIndex = backwardStopIndex;
		this._forwardStopIndex = forwardStopIndex;

		this._segments = segments;
	}

	override dispatchEvent(event: Event): boolean {
		if (this._destroyed) {
			return false;
		}
		return super.dispatchEvent(event);
	}

	skipBack(granularity: 'sentence' | 'paragraph' = 'paragraph', accelerate = false) {
		let delta = accelerate ? 5 : 1;
		let newPosition: number;
		if (granularity === 'sentence') {
			newPosition = this._position - delta;
		}
		else {
			newPosition = this._position;
			// Skip an extra paragraph back if we're mid-paragraph,
			// so paragraphs are treated as a single unit for skipping
			if (this._segments[newPosition]?.anchor !== 'paragraphStart') {
				delta++;
			}
			for (let i = 0; i < delta; i++) {
				let previousIndex = this._segments.slice(0, newPosition).findLastIndex(
					segment => segment.anchor === 'paragraphStart'
				);
				if (previousIndex === -1) {
					newPosition = 0;
					break;
				}
				newPosition = previousIndex;
			}
		}
		this._skipTo(Math.max(newPosition, 0));
	}

	skipAhead(granularity: 'sentence' | 'paragraph' = 'paragraph', accelerate = false) {
		let delta = accelerate ? 5 : 1;
		let newPosition: number;
		if (granularity === 'sentence') {
			newPosition = this._position + delta;
		}
		else {
			newPosition = this._position;
			for (let i = 0; i < delta; i++) {
				let nextIndex = this._segments.slice(newPosition + 1).findIndex(
					segment => segment.anchor === 'paragraphStart'
				);
				if (nextIndex === -1) {
					newPosition = this._segments.length - 1;
					break;
				}
				newPosition = nextIndex + newPosition + 1;
			}
		}
		this._skipTo(Math.min(newPosition, this._segments.length - 1));
	}

	private _skipTo(position: number) {
		this._clearDelayTimeout();
		this._position = position;
		this._stop();
		this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChanging', this._currentSegment));
		this._speak('skip');
		if (this._paused) {
			this.dispatchEvent(new ReadAloudEvent('ActiveSegmentChange', this._currentSegment));
		}
	}

	protected abstract _speak(cause?: 'skip'): void;

	protected abstract _stop(): void;

	destroy(): void {
		this._clearDelayTimeout();
		this._destroyed = true;
	}

	private _clearDelayTimeout() {
		if (this._delayTimeout !== null) {
			clearTimeout(this._delayTimeout);
			this._delayTimeout = null;
		}
	}

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
				let delay = this.voice.sentenceDelay;
				if (this._currentSegment?.anchor === 'paragraphStart') {
					delay += DELAY_PARAGRAPH;
				}
				this._delayTimeout = setTimeout(() => {
					this._delayTimeout = null;
					this._speak();
				}, delay);
			}
		}
	}
}

export type ErrorState =
	| 'quota-exceeded'
	| 'daily-limit-exceeded'
	| 'network'
	| 'unknown';

export class ReadAloudEvent extends Event {
	segment: ReadAloudSegment | null;

	constructor(type: string, segment: ReadAloudSegment | null) {
		super(type);
		this.segment = segment;
	}
}
