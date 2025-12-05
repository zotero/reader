import { ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ReadAloudController } from './controller';

export abstract class ReadAloudVoice<TImpl> {
	readonly impl: TImpl;

	constructor(impl: TImpl) {
		this.impl = impl;
	}

	abstract readonly id: string;

	abstract readonly label: string;

	abstract readonly lang: string | null;

	abstract readonly score: number;

	abstract readonly segmentGranularity: ReadAloudGranularity;

	abstract getController(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController<ReadAloudVoice<TImpl>>;
}
