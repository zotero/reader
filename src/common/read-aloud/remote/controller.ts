import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { REMOTE_ENDPOINT, RemoteVoiceConfig } from './';
import LRUCacheMap from '../../lib/lru-cache-map';

const BUFFER_CACHE_CAPACITY = 4;

export class RemoteReadAloudController extends ReadAloudController {
	private readonly _voice: RemoteVoiceConfig;

	private _audioContext: AudioContext;

	private _currentSource: AudioBufferSourceNode | null = null;

	private _currentIndex: number | null = null;

	private _buffers = new LRUCacheMap<string, AudioBuffer>(BUFFER_CACHE_CAPACITY);

	private _decoding = new Map<string, Promise<AudioBuffer>>();

	private _resumeIndex: number | null = null;

	private _resumeOffsetSec = 0;

	private _segmentStartContextTime: number | null = null;

	private _startedAtOffsetSec = 0;

	constructor(voice: RemoteVoiceConfig, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(segments, backwardStopIndex, forwardStopIndex);

		this._voice = voice;
		this._audioContext = new AudioContext();
	}

	protected _speak(): void {
		// If we're pausing, capture current offset within the segment before disconnecting
		if (this._paused && this._currentSource && this._segmentStartContextTime !== null) {
			let now = this._audioContext.currentTime;
			let elapsed = Math.max(0, now - this._segmentStartContextTime);
			let buffer = this._currentSource.buffer;
			let offset = this._startedAtOffsetSec + elapsed;
			if (buffer) {
				offset = Math.min(offset, buffer.duration);
			}
			this._resumeOffsetSec = offset;
			this._resumeIndex = this._currentIndex;
		}

		this._disconnectCurrentSource();

		if (this._paused) {
			return;
		}

		if (this._audioContext.state === 'suspended') {
			this._audioContext.resume();
		}

		let index = this._position;
		let segment = this._segments[index];
		let url = this._getAudioURL(segment);

		this._getDecodedBuffer(url)
			.then((buffer) => {
				// If position changed or reading was paused while loading, don't start
				if (this._paused || this._position !== index) {
					return;
				}

				let source = this._audioContext.createBufferSource();
				source.buffer = buffer;
				source.connect(this._audioContext.destination);

				this._currentSource = source;
				this._currentIndex = index;

				source.onended = () => {
					this._handleSegmentEnd(segment, index);
				};

				let offsetSec = 0;
				if (this._resumeIndex === index && this._resumeOffsetSec > 0) {
					offsetSec = Math.min(this._resumeOffsetSec, buffer.duration);
				}
				this._resumeIndex = null;
				this._resumeOffsetSec = 0;

				this._handleSegmentStart(segment, index);
				this._startedAtOffsetSec = offsetSec;
				this._segmentStartContextTime = this._audioContext.currentTime;
				source.start(0, offsetSec);

				this._prefetchFrom(index + 1);
			});
	}

	private _disconnectCurrentSource() {
		if (this._currentSource) {
			try {
				this._currentSource.onended = null;
				this._currentSource.stop();
			}
			catch {}
			this._currentSource.disconnect();
			this._currentSource = null;
		}
		this._segmentStartContextTime = null;
		this._startedAtOffsetSec = 0;
		this._currentIndex = null;
	}

	private async _prefetchFrom(index: number) {
		for (; index < this._segments.length && index < this._position + 3; index++) {
			let url = this._getAudioURL(this._segments[index]);
			// Start fetch/decode if not already in progress
			try {
				await this._getDecodedBuffer(url);
			}
			catch {}
		}
	}

	private async _getDecodedBuffer(url: string): Promise<AudioBuffer> {
		let cached = this._buffers.get(url);
		if (cached) return cached;

		let audioBufferPromise = this._decoding.get(url);
		if (audioBufferPromise) return audioBufferPromise;

		let fetchAndDecode = async () => {
			let response = await fetch(url, {
				// Params
			});
			if (!response.ok) {
				throw new Error(`Failed to fetch audio: ${response.status}`);
			}
			let data = await response.arrayBuffer();
			let buffer = await this._audioContext.decodeAudioData(data);
			this._buffers.set(url, buffer);
			return buffer;
		};

		audioBufferPromise = fetchAndDecode()
			.finally(() => this._decoding.delete(url));
		this._decoding.set(url, audioBufferPromise);
		return audioBufferPromise;
	}

	protected _getAudioURL(segment: ReadAloudSegment) {
		let params = new URLSearchParams();
		params.set('voice', this._voice.id);
		params.set('text', segment.text);
		params.set('speed', this._speed.toString());
		return `${REMOTE_ENDPOINT}/speak?${params}`;
	}

	destroy(): void {
		this._disconnectCurrentSource();
		this._buffers.clear();
		this._decoding.clear();
		try {
			this._audioContext.close();
		}
		catch {}
	}
}
