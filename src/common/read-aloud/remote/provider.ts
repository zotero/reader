import { ReadAloudProvider } from '../provider';
import { REMOTE_ENDPOINT, RemoteVoiceConfig } from './index';
import { ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { RemoteReadAloudController } from './controller';

export class RemoteReadAloudProvider implements ReadAloudProvider {
	private readonly _voice: RemoteVoiceConfig;

	constructor(voice: RemoteVoiceConfig) {
		this._voice = voice;
	}

	get id() {
		return this._voice.id;
	}

	get label() {
		return this._voice.label;
	}

	get lang() {
		return 'en-US';
	}

	get score() {
		return 999;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null): ReadAloudController {
		return new RemoteReadAloudController(this._voice, segments, backwardStopIndex, forwardStopIndex);
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
