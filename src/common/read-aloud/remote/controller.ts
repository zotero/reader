import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { REMOTE_ENDPOINT, RemoteVoiceConfig } from './';
import LRUCacheMap from '../../lib/lru-cache-map';

const BLOB_CACHE_CAPACITY = 4;

export class RemoteReadAloudController extends ReadAloudController {
	private readonly _voice: RemoteVoiceConfig;

	private _audio: HTMLAudioElement;

	private _currentIndex: number | null = null;

	private _currentBlob: Blob | null = null;

	private _indexAtPause: number | null = null;

	private _blobs = new LRUCacheMap<string, Blob>(BLOB_CACHE_CAPACITY);

	private _fetching = new Map<string, Promise<Blob>>();

	constructor(voice: RemoteVoiceConfig, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(segments, backwardStopIndex, forwardStopIndex);

		this._voice = voice;
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
		let url = this._getAudioURL(segment);

		this._getBlob(url)
			.then((blob) => {
				// If position changed or reading was paused while loading, don't start
				if (this._paused || this._position !== index) {
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
			let url = this._getAudioURL(this._segments[index]);
			// Start fetch if not already in progress
			try {
				await this._getBlob(url);
			}
			catch {}
		}
	}

	private async _getBlob(url: string): Promise<Blob> {
		let cached = this._blobs.get(url);
		if (cached) return cached;

		let inflight = this._fetching.get(url);
		if (inflight) return inflight;

		let fetchBlob = async () => {
			let response = await fetch(url, {
				// Params
			});
			if (!response.ok) {
				throw new Error(`Failed to fetch audio: ${response.status}`);
			}
			let blob = await response.blob();
			this._blobs.set(url, blob);
			return blob;
		};

		inflight = fetchBlob().finally(() => this._fetching.delete(url));
		this._fetching.set(url, inflight);
		return inflight;
	}

	protected _getAudioURL(segment: ReadAloudSegment) {
		let params = new URLSearchParams();
		params.set('voice', this._voice.id);
		params.set('text', segment.text);
		return `${REMOTE_ENDPOINT}/speak?${params}`;
	}

	destroy(): void {
		if (this._audio.src) {
			URL.revokeObjectURL(this._audio.src);
		}
		this._blobs.clear();
		this._fetching.clear();
	}
}
