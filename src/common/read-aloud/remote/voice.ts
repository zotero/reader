import { ReadAloudVoice, Tier } from '../voice';
import { RemoteVoiceConfig } from './index';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { RemoteReadAloudController, RemoteSampleReadAloudController } from './controller';
import { RemoteReadAloudProvider } from './provider';

export class RemoteReadAloudVoice extends ReadAloudVoice {
	declare readonly impl: RemoteVoiceConfig;

	declare readonly provider: RemoteReadAloudProvider;

	get id() {
		return this.impl.id;
	}

	get label() {
		return this.impl.label;
	}

	get language() {
		return this.impl.locale;
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

	get creditsPerMinute() {
		return this.impl.creditsPerMinute;
	}

	get tier(): Tier {
		return this.impl.tier;
	}

	get default() {
		return true;
	}

	get sentenceDelay() {
		return this.impl.sentenceDelay ?? 0;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		return new RemoteReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}

	getSampleController(segments: ReadAloudSegment[]) {
		return new RemoteSampleReadAloudController(this, segments);
	}
}
