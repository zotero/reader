import { ReadAloudProvider } from '../provider';
import { REMOTE_ENDPOINT, RemoteVoiceConfig } from './index';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { RemoteReadAloudController } from './controller';

export class RemoteReadAloudProvider implements ReadAloudProvider {
	readonly voice: RemoteVoiceConfig;

	constructor(voice: RemoteVoiceConfig) {
		this.voice = voice;
	}

	get id() {
		return this.voice.id;
	}

	get label() {
		return this.voice.label;
	}

	get lang() {
		return 'en-US';
	}

	get score() {
		return 999;
	}

	get segmentGranularity(): ReadAloudGranularity {
		return 'paragraph';
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null): ReadAloudController {
		return new RemoteReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}

	static waitForProviders(): Promise<void> {
		if (!_providersPromise) {
			_providersPromise = fetch(`${REMOTE_ENDPOINT}/voices`, {
				// Params
			}).then(res => res.json()).then((json) => {
				let voices = json as RemoteVoiceConfig[];
				for (let voice of voices) {
					_providers.push(new RemoteReadAloudProvider(voice));
				}
			});
		}
		return _providersPromise;
	}

	static getAvailableProviders(): ReadAloudProvider[] {
		return _providers;
	}
}

let _providers: ReadAloudProvider[] = [];

let _providersPromise: Promise<void> | null = null;
