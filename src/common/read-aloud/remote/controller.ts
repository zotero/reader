import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { RemoteInterface, RemoteVoiceConfig } from './';
import LRUCacheMap from '../../lib/lru-cache-map';
import { RemoteReadAloudProvider } from './provider';

const BLOB_CACHE_CAPACITY = 4;

export class RemoteReadAloudController extends ReadAloudController {
	private readonly _remote: RemoteInterface;

	private readonly _voice: RemoteVoiceConfig;

	private _audio: HTMLAudioElement;

	private _currentIndex: number | null = null;

	private _currentBlob: Blob | null = null;

	private _indexAtPause: number | null = null;

	private _blobs = new LRUCacheMap<string, Blob>(BLOB_CACHE_CAPACITY);

	private _fetching = new Map<string, Promise<Blob>>();

	private _destroyed = false;

	constructor(provider: RemoteReadAloudProvider, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(provider, segments, backwardStopIndex, forwardStopIndex);

		this._remote = provider.remote;
		this._voice = provider.voice;
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

		this._getBlob(segment)
			.then((blob) => {
				// If position changed or reading was paused while loading, don't start
				if (this._destroyed || this._paused || this._position !== index) {
					return;
				}

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
				}

				if (indexAtPause !== index) {
					this._audio.currentTime = 0;
				}
				this._audio.playbackRate = this._speed;
				this._audio.play();

				this._prefetchFrom(index + 1);
			});
	}

	private async _prefetchFrom(index: number) {
		for (; index < this._segments.length && index < this._position + 3; index++) {
			// Start fetch if not already in progress
			try {
				await this._getBlob(this._segments[index]);
			}
			catch {}
		}
	}

	private async _getBlob(segment: ReadAloudSegment): Promise<Blob> {
		let key = this._getKey(segment);

		let cached = this._blobs.get(key);
		if (cached) return cached;

		let inflight = this._fetching.get(key);
		if (inflight) return inflight;

		let fetchBlob = async () => {
			let { data: blob } = await this._remote.getAudio(segment, this._voice);
			if (!blob) {
				throw new Error('Failed to fetch audio');
			}
			this._blobs.set(key, blob);
			return blob;
		};

		inflight = fetchBlob().finally(() => this._fetching.delete(key));
		this._fetching.set(key, inflight);
		return inflight;
	}

	private _getKey(segment: ReadAloudSegment): string {
		return JSON.stringify({ voice: this._voice.id, text: segment.text });
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
