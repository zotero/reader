import { ReadAloudSegment } from '../../types';
import { ReadAloudController, ReadAloudEvent } from '../controller';
import LRUCacheMap from '../../lib/lru-cache-map';
import { RemoteReadAloudVoice } from './voice';
import { resolveLanguage } from '../lang';
import { debounce } from '../../lib/debounce';

const BLOB_CACHE_CAPACITY = 32;
const EST_PLAYBACK_CHARS_PER_SECOND = 16;
const EXP_MOVING_AVERAGE_ALPHA = 0.25;
const SKIP_DEBOUNCE_DELAY = 600;

abstract class RemoteReadAloudControllerBase extends ReadAloudController<RemoteReadAloudVoice> {
	protected readonly _audio: HTMLAudioElement;

	constructor(voice: RemoteReadAloudVoice, lang: string, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		// Resolve base language code (e.g., "en") to a full locale the voice supports (e.g., "en-US")
		let resolvedLang = resolveLanguage(lang, voice.languages) ?? lang;
		super(voice, resolvedLang, segments, backwardStopIndex, forwardStopIndex);

		this._audio = new Audio();
		this._audio.preload = 'auto';
	}

	override get segmentProgress(): number {
		if (!this._audio.duration || !isFinite(this._audio.duration)) {
			return 0;
		}
		return this._audio.currentTime / this._audio.duration;
	}

	protected _stop(): void {
		this._audio.pause();
	}

	override destroy(): void {
		super.destroy();
		this._audio.pause();
		this._audio.removeAttribute('src');
	}
}

export class RemoteReadAloudController extends RemoteReadAloudControllerBase {
	private _currentIndex: number | null = null;

	private _currentAudioData: string | null = null;

	private _indexAtPause: number | null = null;

	private _audioData = new LRUCacheMap<number, string>(BLOB_CACHE_CAPACITY);

	private _fetching = new Map<number, Promise<string>>();

	// Exponential moving average of time spent fetching per character (in milliseconds)
	private _averageFetchTimePerChar: number | null = null;

	private _failedIndices = new Set<number>();

	protected _speak(cause?: 'skip'): void {
		if (cause === 'skip') {
			this._speakInternalWithSkipDebounce();
		}
		else {
			this._speakInternal();
		}
	}

	private _speakInternal() {
		let indexAtPause = this._indexAtPause;
		// If we're pausing, capture current offset within the segment before disconnecting
		if (this._paused && this._currentIndex !== null) {
			this._indexAtPause = this._currentIndex;
		}

		if (this._paused) {
			this._audio.pause();
			return;
		}

		let index = this._position;
		let segment = this._segments[index];

		if (!segment) {
			return;
		}

		let handleError = () => {
			if (this._position !== index) {
				return;
			}
			this.buffering = false;
			this._handleSegmentStart(segment, index);
			this.dispatchEvent(new ReadAloudEvent('Error', segment));
		};

		if (this._failedIndices.has(index)) {
			handleError();
			return;
		}

		this.buffering = true;
		this._getAudioData(index)
			.then((audioData) => {
				if (this._position !== index) {
					return;
				}
				this.buffering = false;
				if (this._destroyed || this._paused) {
					return;
				}

				this._currentIndex = index;
				this._handleSegmentStart(segment, index);
				this._audio.onended = () => {
					this._handleSegmentEnd(segment, index);
				};

				if (this._currentAudioData !== audioData) {
					this._audio.src = `data:audio/ogg;base64,${audioData}`;
					this._currentAudioData = audioData;
				}

				if (indexAtPause !== index) {
					this._audio.currentTime = 0;
				}
				this._audio.playbackRate = this._speed;
				this._audio.play();

				this._prefetchFrom(index + 1);
			})
			.catch(handleError);
	}

	private _speakInternalWithSkipDebounce = debounce(() => this._speakInternal(), SKIP_DEBOUNCE_DELAY);

	retry(): void {
		let index = this._position;
		if (!this._failedIndices.has(index)) {
			return;
		}
		this._failedIndices.delete(index);
		this._error = null;
		this.dispatchEvent(new ReadAloudEvent('ErrorCleared', this._currentSegment));
		this._paused = false;
		this._speak();
	}

	private async _prefetchFrom(startIndex: number) {
		const MAX_WINDOW = 3;
		const MAX_CONCURRENT_FETCHES = 2;

		let endIndex = Math.min(
			startIndex + MAX_WINDOW,
			this._forwardStopIndex ?? this._segments.length,
		);
		if (startIndex >= endIndex) {
			return;
		}

		// Compute current time until each candidate starts, based on the real currentTime and estimates for upcoming
		let currentlyPlayingIndex = this._currentIndex ?? this._position;
		let currentTimeRemaining = Math.max(0, this._audio.duration - this._audio.currentTime);

		let prefixSums = [0];
		for (let i = currentlyPlayingIndex + 1; i < endIndex; i++) {
			let prev = prefixSums[prefixSums.length - 1];
			prefixSums.push(prev + this._estimatePlaybackTime(this._segments[i]));
		}

		let getTimeUntilStartOfSegment = (i: number) => {
			if (i <= currentlyPlayingIndex) return 0;
			let offset = i - (currentlyPlayingIndex + 1);
			let sumNext = offset >= 0 && offset < prefixSums.length ? prefixSums[offset] : 0;
			return (currentTimeRemaining + sumNext) * 1000;
		};

		// Assign a priority score to each candidate
		// Higher = fetch sooner
		let candidates: { index: number; score: number }[] = [];
		for (let i = startIndex; i < endIndex; i++) {
			let fetchTime = this._estimateFetchMs(this._segments[i]);
			let timeUntilStart = getTimeUntilStartOfSegment(i);
			let segmentsUntilStart = i - currentlyPlayingIndex;

			let risk = fetchTime - timeUntilStart;
			let segmentDistancePenalty = segmentsUntilStart * 50;
			let score = risk - segmentDistancePenalty;

			// Fetch the next segment first
			if (i === currentlyPlayingIndex + 1) {
				score += 10_000;
			}
			candidates.push({ index: i, score });
		}

		candidates.sort((a, b) => b.score - a.score);

		let numFetchesInProgress = 0;
		let keepFetching = async () => {
			if (this._destroyed || !candidates.length) return;
			let { index } = candidates.shift()!;

			numFetchesInProgress++;
			if (numFetchesInProgress < MAX_CONCURRENT_FETCHES) {
				keepFetching();
			}

			try {
				await this._getAudioData(index);
			}
			catch {
				// Ignore
			}
			finally {
				numFetchesInProgress--;
			}

			if (numFetchesInProgress < MAX_CONCURRENT_FETCHES) {
				keepFetching();
			}
		};

		// eslint-disable-next-line no-unmodified-loop-condition
		while (numFetchesInProgress < MAX_CONCURRENT_FETCHES && candidates.length) {
			keepFetching();
		}
	}

	private async _getAudioData(index: number): Promise<string> {
		let cached = this._audioData.get(index);
		if (cached) return cached;

		let inflight = this._fetching.get(index);
		if (inflight) return inflight;

		let segment = this._segments[index];
		let fetchBlob = async () => {
			let startTime = performance.now();

			let { audio, error, creditsRemaining } = await this.voice.provider.remote.getAudio(segment, this.voice.impl, this.lang);

			if (creditsRemaining !== null) {
				this.voice.provider.creditsRemaining = creditsRemaining;
			}

			if (!audio) {
				if (error) {
					this._error = error;
					this._failedIndices.add(index);
					// Don't dispatch error immediately - wait until playback reaches this segment
					console.error(error);
				}
				throw new Error('Failed to fetch audio');
			}
			this._audioData.set(index, audio);

			// Update fetch time EMA
			let endTime = performance.now();
			if (segment.text.length) {
				let fetchTimePerChar = (endTime - startTime) / segment.text.length;
				if (this._averageFetchTimePerChar === null) {
					this._averageFetchTimePerChar = fetchTimePerChar;
				}
				else {
					this._averageFetchTimePerChar = EXP_MOVING_AVERAGE_ALPHA * fetchTimePerChar
						+ (1 - EXP_MOVING_AVERAGE_ALPHA) * this._averageFetchTimePerChar;
				}
			}
			return audio;
		};

		inflight = fetchBlob().finally(() => this._fetching.delete(index));
		this._fetching.set(index, inflight);
		return inflight;
	}

	private _estimatePlaybackTime(segment: ReadAloudSegment): number {
		let secsAt1x = segment.text.length / EST_PLAYBACK_CHARS_PER_SECOND;
		let secsAtCurrentSpeed = secsAt1x / this._speed;
		return Math.max(0.2, secsAtCurrentSpeed);
	}

	private _estimateFetchMs(segment: ReadAloudSegment): number {
		const LATENCY_PADDING_MS = 250;
		// Fallback when no data has been collected
		let perCharMs = this._averageFetchTimePerChar ?? 1.5;
		return LATENCY_PADDING_MS + perCharMs * segment.text.length;
	}

	override destroy(): void {
		super.destroy();
		this._audioData.clear();
		this._fetching.clear();
	}
}

export class RemoteSampleReadAloudController extends RemoteReadAloudControllerBase {
	constructor(voice: RemoteReadAloudVoice, lang: string, segments: ReadAloudSegment[]) {
		super(voice, lang, segments, null, null);
	}

	protected _speak() {
		if (this._paused) {
			this._audio.pause();
			return;
		}

		let segment = this._segments[0];
		if (!segment) {
			return;
		}

		this._audio.pause();
		this.buffering = true;

		this.voice.provider.remote.getSampleAudio(this.voice.impl, this.lang)
			.then(({ audio, error }) => {
				this.buffering = false;
				if (this._destroyed || this._paused) {
					return;
				}
				if (audio) {
					this._audio.src = `data:audio/ogg;base64,${encodeURIComponent(audio)}`;
					this._audio.onended = () => this._handleSegmentEnd(segment, 0);
					this._handleSegmentStart(segment, 0);
					this._audio.play();
				}
				else if (error) {
					console.error(error);
					this.dispatchEvent(new ReadAloudEvent('Error', segment));
				}
			})
			.catch((err) => {
				this.buffering = false;
				console.error(err);
				this.dispatchEvent(new ReadAloudEvent('Error', segment));
			});
	}
}
