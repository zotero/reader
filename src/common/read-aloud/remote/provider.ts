import { ReadAloudProvider } from '../provider';
import { RemoteVoiceConfig } from './index';
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
		return 1;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null): ReadAloudController {
		return new RemoteReadAloudController(this._voice, segments, backwardStopIndex, forwardStopIndex);
	}

	static async waitForProviders(): Promise<void> {
		// Nothing to do for now
	}

	static getAvailableProviders(): ReadAloudProvider[] {
		return [
			new RemoteReadAloudProvider({ id: 'archenar', label: 'Archenar (Gemini)', provider: 'google' }),
			new RemoteReadAloudProvider({ id: 'nova', label: 'Nova (OpenAI)', provider: 'openai' }),
		];
	}
}
