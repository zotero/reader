import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { REMOTE_ENDPOINT, RemoteVoiceConfig } from './';

export class RemoteReadAloudController extends ReadAloudController {
	private readonly _voice: RemoteVoiceConfig;

	private readonly _audios: HTMLAudioElement[];

	constructor(voice: RemoteVoiceConfig, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		super(segments, backwardStopIndex, forwardStopIndex);

		this._voice = voice;

		// Create elements now, but only set src later, when we want to load a segment
		this._audios = segments.map((segment, index) => {
			let audio = document.createElement('audio');
			audio.oncanplaythrough = () => this._handleSegmentCanPlayThrough(segment, index);
			audio.onplaying = () => this._handleSegmentStart(segment, index);
			audio.onended = () => this._handleSegmentEnd(segment, index);
			return audio;
		});
	}

	protected _handleSegmentCanPlayThrough(_segment: ReadAloudSegment, index: number) {
		let nextIndex = index + 1;
		if (nextIndex >= this._segments.length || index >= this._position + 3) {
			return;
		}
		this._audios[nextIndex].preload = 'auto';
	}

	protected _speak(): void {
		for (let audio of this._audios) {
			audio.pause();
		}

		for (let index = 0; index < this._audios.length; index++) {
			let segment = this._segments[index];
			let audio = this._audios[index];

			audio.preload = 'none';
			let src = this._getAudioURL(segment);
			if (audio.src !== src) {
				audio.src = src;
			}
		}

		if (!this._paused) {
			let audio = this._audios[this._position];
			audio.preload = 'auto';
			audio.currentTime = 0;
			audio.play();
		}
	}

	protected _getAudioURL(segment: ReadAloudSegment) {
		let params = new URLSearchParams();
		params.set('provider', this._voice.provider);
		params.set('voice', this._voice.id);
		params.set('text', segment.text);
		params.set('speed', this._speed.toString());
		return `${REMOTE_ENDPOINT}/speak?${params}`;
	}

	destroy(): void {
		for (let audio of this._audios) {
			audio.pause();
		}
	}
}
