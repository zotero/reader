import { ReadAloudVoice } from '../voice';
import { RemoteInterface, RemoteVoiceConfig } from './index';
import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { RemoteReadAloudController } from './controller';

export class RemoteReadAloudVoice extends ReadAloudVoice<Impl> {
	get id() {
		return this.impl.voice.id;
	}

	get label() {
		return this.impl.voice.label;
	}

	get lang() {
		return null;
	}

	get score() {
		return 999;
	}

	get segmentGranularity(): ReadAloudGranularity {
		return 'paragraph';
	}

	getController(segments: ReadAloudSegment[], backwardStopIndex: number | null, forwardStopIndex: number | null) {
		return new RemoteReadAloudController(this, segments, backwardStopIndex, forwardStopIndex);
	}
}

type Impl = { remote: RemoteInterface, voice: RemoteVoiceConfig };
