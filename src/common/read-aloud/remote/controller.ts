import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import LRUCacheMap from '../../lib/lru-cache-map';
import { RemoteReadAloudVoice } from './voice';

const BLOB_CACHE_CAPACITY = 32;
const EST_PLAYBACK_CHARS_PER_SECOND = 16;
const EXP_MOVING_AVERAGE_ALPHA = 0.25;

export class RemoteReadAloudController extends ReadAloudController<RemoteReadAloudVoice> {
	private readonly _audio: HTMLAudioElement;

	private _currentIndex: number | null = null;

	private _currentBlob: Blob | null = null;

	private _indexAtPause: number | null = null;

	private _blobs = new LRUCacheMap<string, Blob>(BLOB_CACHE_CAPACITY);

	private _fetching = new Map<string, Promise<Blob>>();

	private _destroyed = false;

	// Exponential moving average of time spent fetching per character (in milliseconds)
	private _averageFetchTimePerChar: number | null = null;

	private _creditsRemaining: number | null = null;

	private _creditsConsumed = new Map<string, number>();

	override get secondsRemaining() {
		let creditsRemaining = this._creditsRemaining ?? this.voice.provider.creditsRemaining;
		let creditsPerSecond = this.voice.creditsPerSecond;
		let remainingTimeInAudio = isNaN(this._audio.duration)
			? 0
			: this._audio.duration - this._audio.currentTime;
		return creditsRemaining / creditsPerSecond + remainingTimeInAudio;
	}

	constructor(voice: RemoteReadAloudVoice, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(voice, segments, backwardStopIndex, forwardStopIndex);

		this._audio = new Audio();
		this._audio.preload = 'auto';
	}

	protected _speak(): void {
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

		this.buffering = true;
		this._getBlob(segment)
			.then((blob) => {
				// If position changed or reading was paused while loading, don't start
				if (this._destroyed || this._paused || this._position !== index) {
					return;
				}
				this.buffering = false;

				this._currentIndex = index;
				this._handleSegmentStart(segment, index);
				this._audio.onended = () => {
					this._handleSegmentEnd(segment, index);
				};

				if (this._currentBlob !== blob) {
					if (this._audio.src) {
						URL.revokeObjectURL(this._audio.src);
					}
					this._audio.src = URL.createObjectURL(blob);
					this._currentBlob = blob;
					if (this._creditsRemaining !== null) {
						this._creditsRemaining -= this._creditsConsumed.get(this._getKey(segment))!;
					}
					else {
						console.warn('_creditsRemaining not set');
					}
				}

				if (indexAtPause !== index) {
					this._audio.currentTime = 0;
				}
				this._audio.playbackRate = this._speed;
				this._audio.play();

				this._prefetchFrom(index + 1);
			});
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
				await this._getBlob(this._segments[index]);
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

		// If playback position jumps, we don't try to cancel individual fetches here; _getBlob shares inflight via map
	}

	private async _getBlob(segment: ReadAloudSegment): Promise<Blob> {
		let key = this._getKey(segment);

		let cached = this._blobs.get(key);
		if (cached) return cached;

		let inflight = this._fetching.get(key);
		if (inflight) return inflight;

		let fetchBlob = async (retriesRemaining = 2) => {
			let startTime = performance.now();

			let { audio, error, creditsRemaining } = await this.voice.provider.remote.getAudio(segment, this.voice.impl);

			// Silently retry twice if we get a non-quota error
			if (error && error !== 'quota-exceeded' && retriesRemaining) {
				console.warn('Retrying fetch after error', error);
				return fetchBlob(retriesRemaining - 1);
			}

			let creditsBefore = this.voice.provider.creditsRemaining;

			// If we haven't initialized this._creditsRemaining yet, set it to pre-request value
			// so we can count down as this segment plays
			if (this._creditsRemaining === null) {
				this._creditsRemaining = creditsBefore;
			}
			// If the TTS service didn't return a creditsRemaining value (as in a fatal error),
			// assume it's whatever we had before
			if (creditsRemaining === null) {
				creditsRemaining = creditsBefore;
			}

			this.voice.provider.creditsRemaining = creditsRemaining;
			this._creditsConsumed.set(key, creditsBefore - creditsRemaining);

			if (!audio) {
				if (error) {
					this._error = error;
					this.dispatchEvent(new Event('error'));
					console.error(error);
				}
				throw new Error('Failed to fetch audio');
			}
			this._blobs.set(key, audio);

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

		inflight = fetchBlob().finally(() => this._fetching.delete(key));
		this._fetching.set(key, inflight);
		return inflight;
	}

	private _getKey(segment: ReadAloudSegment): string {
		return JSON.stringify({ voice: this.voice.id, text: segment.text });
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

	destroy(): void {
		if (this._audio.src) {
			URL.revokeObjectURL(this._audio.src);
		}
		this._blobs.clear();
		this._fetching.clear();
		this._audio.pause();
		this._audio.removeAttribute('src');
		this._destroyed = true;
	}
}
