import { ReadAloudSegment } from '../../types';
import { ReadAloudController, ReadAloudEvent } from '../controller';
import LRUCacheMap from '../../lib/lru-cache-map';
import { RemoteReadAloudVoice } from './voice';
import { debounce } from '../../lib/debounce';
import { stretchAudioBuffer } from './lib/time-stretch';
import { findWordOnset } from './lib/word-onset';

const AUDIO_BUFFER_CACHE_CAPACITY = 32;
const EST_PLAYBACK_CHARS_PER_SECOND = 16;
const EXP_MOVING_AVERAGE_ALPHA = 0.25;
const SKIP_DEBOUNCE_DELAY = 600;
const STALL_PROBE_DELAY_MS = 400;

abstract class RemoteReadAloudControllerBase extends ReadAloudController {
	declare readonly voice: RemoteReadAloudVoice;

	private _audioContext!: AudioContext;

	private _filterChainInput!: AudioNode;

	private _sourceNode: AudioBufferSourceNode | null = null;

	private _currentBuffer: AudioBuffer | null = null;

	private _isPlaying = false;

	// AudioContext.currentTime when playback last started
	private _playbackStartContextTime = 0;

	// Offset into the buffer (in seconds) when playback last started
	private _playbackOffset = 0;

	// The rate passed to _playAudioBuffer, used to map progress back to
	// original-buffer time. The actual AudioBufferSourceNode always plays at 1x
	// because stretchAudioBuffer handles the speed change.
	private _playbackRate = 1;

	constructor(voice: RemoteReadAloudVoice, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(voice, segments, backwardStopIndex, forwardStopIndex);

		this._initAudioContext();

		// Gecko on Windows doesn't transparently re-route an AudioContext's
		// output when the system default device changes (e.g., headphones
		// unplugged); the context stays bound to the removed sink and
		// playback goes silent. devicechange fires for all input/output
		// devices, so we only act if the context actually stops advancing
		navigator.mediaDevices?.addEventListener('devicechange', this._handleDeviceChange);
	}

	private _initAudioContext(): void {
		// Build audio processing chain for speech clarity
		this._audioContext = new AudioContext();

		// Cut rumble and low-frequency noise below 80Hz
		let highpass = this._audioContext.createBiquadFilter();
		highpass.type = 'highpass';
		highpass.frequency.value = 80;
		highpass.Q.value = 0.7;

		// Gently peak around 3kHz to make speech clearer
		let presence = this._audioContext.createBiquadFilter();
		presence.type = 'peaking';
		presence.frequency.value = 3000;
		presence.gain.value = 3;
		presence.Q.value = 1;

		// Normalize volume across voices
		let compressor = this._audioContext.createDynamicsCompressor();

		highpass
			.connect(presence)
			.connect(compressor)
			.connect(this._audioContext.destination);
		this._filterChainInput = highpass;
	}

	private _handleDeviceChange = (): void => {
		if (this._destroyed || !this._isPlaying || !this._currentBuffer) {
			return;
		}

		// Probe whether the sink actually died: sample currentTime now, and
		// after a short delay check whether it advanced. A healthy context
		// ticks currentTime continuously, but a context bound to a removed
		// sink stalls. This avoids spurious rebuilds on unrelated events.
		let sampledContext = this._audioContext;
		let sampledTime = sampledContext.currentTime;

		setTimeout(() => {
			// Destroyed, already rebuilt by a prior probe, or state changed out from under us
			if (this._destroyed
					|| this._audioContext !== sampledContext
					|| !this._isPlaying
					|| !this._currentBuffer) {
				return;
			}
			// currentTime advanced, so the sink is still alive
			if (sampledContext.currentTime > sampledTime) {
				return;
			}

			let buffer = this._currentBuffer;
			let offset = this._currentPlaybackTime;
			let rate = this._playbackRate;

			this._stopSource();
			sampledContext.close();
			this._initAudioContext();

			this._playAudioBuffer(buffer, offset, rate);
		}, STALL_PROBE_DELAY_MS);
	};

	// Progress is tracked in terms of the *original* (unstretched) buffer.
	// The stretched buffer plays at 1x, so elapsed real time = elapsed
	// stretched time. Multiply by the rate to map back to original time.
	private get _currentPlaybackTime(): number {
		if (!this._isPlaying || !this._currentBuffer) {
			return this._playbackOffset;
		}
		let elapsed = (this._audioContext.currentTime - this._playbackStartContextTime) * this._playbackRate;
		return Math.min(this._playbackOffset + elapsed, this._currentBuffer.duration);
	}

	protected override get _segmentProgressFraction(): number {
		if (!this._currentBuffer) return 0;
		return this._currentPlaybackTime / this._currentBuffer.duration;
	}

	protected override get _segmentProgressSeconds(): number {
		return this._currentPlaybackTime;
	}

	protected get _currentBufferDuration(): number {
		return this._currentBuffer?.duration ?? 0;
	}

	protected async _decodeAudioData(blob: Blob): Promise<AudioBuffer> {
		let arrayBuffer = await blob.arrayBuffer();
		return this._audioContext.decodeAudioData(arrayBuffer);
	}

	protected _playAudioBuffer(buffer: AudioBuffer, offset: number, rate: number): void {
		this._stopSource();

		this._currentBuffer = buffer;
		this._playbackOffset = offset;
		this._playbackRate = rate;

		// Time-stretch the buffer to change speed without affecting pitch.
		// AudioBufferSourceNode.playbackRate shifts pitch like a turntable,
		// so we stretch the buffer ourselves and always play at 1x.
		let stretched = stretchAudioBuffer(buffer, rate, this._audioContext);
		let stretchedOffset = offset / rate;

		let source = this._audioContext.createBufferSource();
		source.buffer = stretched;
		source.connect(this._filterChainInput);

		this._sourceNode = source;
		this._playbackStartContextTime = this._audioContext.currentTime;
		this._isPlaying = true;
		source.start(0, stretchedOffset);

		source.onended = () => {
			if (this._sourceNode !== source) return;
			this._isPlaying = false;
			let segment = this._currentSegment;
			if (segment) {
				this._handleSegmentEnd(segment, this._position);
			}
		};
	}

	protected override _onSpeedChange(): void {
		if (this._isPlaying && this._currentBuffer) {
			let offset = this._currentPlaybackTime;
			this._stopSource();
			this._playAudioBuffer(this._currentBuffer, offset, this._speed);
		}
	}

	protected _stop(): void {
		if (this._isPlaying) {
			this._playbackOffset = this._currentPlaybackTime;
		}
		this._stopSource();
	}

	private _stopSource(): void {
		if (this._sourceNode) {
			this._sourceNode.onended = null;
			try {
				this._sourceNode.stop();
			}
			catch {
				// Already stopped
			}
			this._sourceNode.disconnect();
			this._sourceNode = null;
		}
		this._isPlaying = false;
	}

	override destroy(): void {
		super.destroy();
		navigator.mediaDevices?.removeEventListener('devicechange', this._handleDeviceChange);
		this._stopSource();
		this._audioContext.close();
	}
}

export class RemoteReadAloudController extends RemoteReadAloudControllerBase {
	private _currentIndex: number | null = null;

	private _indexAtPause: number | null = null;

	private _audioBuffers = new LRUCacheMap<number, AudioBuffer>(AUDIO_BUFFER_CACHE_CAPACITY);

	private _fetching = new Map<number, Promise<AudioBuffer>>();

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
			this._stop();
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
			.then((audioBuffer) => {
				if (this._position !== index) {
					return;
				}
				this.buffering = false;
				if (this._destroyed || this._paused) {
					return;
				}

				this._currentIndex = index;
				this._handleSegmentStart(segment, index);

				let offset: number;
				if (indexAtPause === index) {
					let pauseDuration = this._pauseDurationSeconds;
					if (pauseDuration < 5) {
						// Short pause (under 5 seconds): resume from exact position
						offset = this._segmentProgressSeconds;
					}
					else if (this.lang.startsWith('en')) {
						// Medium pause (5-20 seconds): jump back one word boundary
						// Long pause (20+ seconds): jump back two word boundaries
						let wordBoundaries = pauseDuration >= 20 ? 2 : 1;
						offset = findWordOnset(audioBuffer, this._segmentProgressSeconds, wordBoundaries);
					}
					else {
						offset = this._segmentProgressSeconds;
					}
				}
				else {
					offset = 0;
				}
				this._playAudioBuffer(audioBuffer, offset, this._speed);

				this._prefetchFrom(index + 1);
			})
			.catch(handleError);
	}

	private _speakInternalWithSkipDebounce = debounce(() => this._speakInternal(), SKIP_DEBOUNCE_DELAY);

	override async refreshCreditsRemaining() {
		let { standardCreditsRemaining, premiumCreditsRemaining } = await this.voice.provider.remote.getCreditsRemaining();
		if (standardCreditsRemaining !== null) {
			this.voice.provider.standardCreditsRemaining = standardCreditsRemaining;
		}
		if (premiumCreditsRemaining !== null) {
			this.voice.provider.premiumCreditsRemaining = premiumCreditsRemaining;
		}
	}

	override async resetCredits() {
		let { standardCreditsRemaining, premiumCreditsRemaining } = await this.voice.provider.remote.resetCredits();
		if (standardCreditsRemaining !== null) {
			this.voice.provider.standardCreditsRemaining = standardCreditsRemaining;
		}
		if (premiumCreditsRemaining !== null) {
			this.voice.provider.premiumCreditsRemaining = premiumCreditsRemaining;
		}
	}

	override retry(): void {
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
		let currentTimeRemaining = Math.max(0, this._currentBufferDuration - this._segmentProgressSeconds);

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

	private async _getAudioData(index: number): Promise<AudioBuffer> {
		let cached = this._audioBuffers.get(index);
		if (cached) return cached;

		let inflight = this._fetching.get(index);
		if (inflight) return inflight;

		let segment = this._segments[index];
		let fetchAndDecode = async () => {
			let blob = await this._fetchAudioBlob(segment);

			let audioBuffer = await this._decodeAudioData(blob);
			this._audioBuffers.set(index, audioBuffer);
			return audioBuffer;
		};

		inflight = fetchAndDecode().finally(() => this._fetching.delete(index));
		this._fetching.set(index, inflight);
		return inflight;
	}

	private async _fetchAudioBlob(segment: ReadAloudSegment): Promise<Blob> {
		let startTime = performance.now();

		let { audio, error } = await this.voice.provider.remote.getAudio(segment, this.voice.impl);

		if (!audio) {
			if (error) {
				this._error = error;
				this._failedIndices.add(this._segments.indexOf(segment));
				console.error(error);
			}
			throw new Error('Failed to fetch audio');
		}

		// Update fetch time EMA, excluding outliers (e.g. cache hits that return near-instantly)
		if (segment.text.length) {
			let fetchTimePerChar = (performance.now() - startTime) / segment.text.length;
			if (this._averageFetchTimePerChar === null) {
				this._averageFetchTimePerChar = fetchTimePerChar;
			}
			else if (fetchTimePerChar > this._averageFetchTimePerChar * 0.1) {
				this._averageFetchTimePerChar = EXP_MOVING_AVERAGE_ALPHA * fetchTimePerChar
					+ (1 - EXP_MOVING_AVERAGE_ALPHA) * this._averageFetchTimePerChar;
			}
		}

		return audio;
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
		this._audioBuffers.clear();
		this._fetching.clear();
	}
}

export class RemoteSampleReadAloudController extends RemoteReadAloudControllerBase {
	constructor(voice: RemoteReadAloudVoice, segments: ReadAloudSegment[]) {
		super(voice, segments, null, null);
	}

	protected _speak() {
		if (this._paused) {
			this._stop();
			return;
		}

		let segment = this._segments[0];
		if (!segment) {
			return;
		}

		this._stop();
		this.buffering = true;

		this.voice.provider.remote.getAudio('sample', this.voice.impl)
			.then(async ({ audio, error }) => {
				this.buffering = false;
				if (this._destroyed || this._paused) {
					return;
				}
				if (audio) {
					let audioBuffer = await this._decodeAudioData(audio);
					this._handleSegmentStart(segment, 0);
					this._playAudioBuffer(audioBuffer, 0, this._speed);
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
