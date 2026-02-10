import { ReadAloudVoice } from '../voice';
import { RemoteVoiceConfig } from './index';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { RemoteReadAloudController, RemoteSampleReadAloudController } from './controller';
import { RemoteReadAloudProvider } from './provider';

export class RemoteReadAloudVoice extends ReadAloudVoice<RemoteVoiceConfig, RemoteReadAloudProvider> {
	get id() {
		return this.impl.id;
	}

	get label() {
		return this.impl.label;
	}

	get languages() {
		return this.impl.locales;
	}

	get score() {
		if (this.id === 'openai') {
			return 998;
		}
		return 999;
	}

	get segmentGranularity(): ReadAloudGranularity {
		return this.impl.segmentGranularity;
	}

	get creditsPerSecond() {
		return this.impl.creditsPerSecond;
	}

	get sentenceDelay() {
		return this.impl.sentenceDelay ?? 0;
	}

	getController(lang: string, segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		return new RemoteReadAloudController(this, lang, segments, backwardStopIndex, forwardStopIndex);
	}

	getSampleController(lang: string, segments: ReadAloudSegment[]) {
		return new RemoteSampleReadAloudController(this, lang, segments);
	}
}
