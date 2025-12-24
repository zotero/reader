import { ReadAloudVoice } from '../voice';
import { RemoteVoiceConfig } from './index';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { RemoteReadAloudController } from './controller';
import { RemoteReadAloudProvider } from './provider';

export class RemoteReadAloudVoice extends ReadAloudVoice<RemoteVoiceConfig, RemoteReadAloudProvider> {
	get id() {
		return this.impl.id;
	}

	get label() {
		return this.impl.label;
	}

	get lang() {
		return null;
	}

	get score() {
		if (this.id === 'openai') {
			return 998;
		}
		return 999;
	}

	get segmentGranularity(): ReadAloudGranularity {
		if (this.impl.segmentGranularity === 'paragraph') {
			return 'paragraphWithInitialSentence';
		}
		return this.impl.segmentGranularity;
	}

	get creditsPerSecond() {
		return this.impl.creditsPerSecond;
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		return new RemoteReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}
}

