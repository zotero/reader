import { ReadAloudProvider } from '../provider';
import { RemoteInterface, RemoteVoiceConfig } from './index';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { ReadAloudController } from '../controller';
import { RemoteReadAloudController } from './controller';

export class RemoteReadAloudProvider implements ReadAloudProvider {
	readonly remote: RemoteInterface;

	readonly voice: RemoteVoiceConfig;

	constructor(remote: RemoteInterface, voice: RemoteVoiceConfig) {
		this.remote = remote;
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

	static async getAvailableProviders(remote: RemoteInterface): Promise<ReadAloudProvider[]> {
		let configs = await remote.getVoices();
		return configs.map(config => new RemoteReadAloudProvider(remote, config));
	}
}
