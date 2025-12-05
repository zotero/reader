import { ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ReadAloudController } from './controller';
import type { ReadAloudProvider } from './provider';

export abstract class ReadAloudVoice<TImpl, TProvider extends ReadAloudProvider> {
	readonly impl: TImpl;

	readonly provider: TProvider;

	constructor(provider: TProvider, impl: TImpl) {
		this.provider = provider;
		this.impl = impl;
	}

	abstract readonly id: string;

	abstract readonly label: string;

	abstract readonly lang: string | null;

	abstract readonly score: number;

	abstract readonly segmentGranularity: ReadAloudGranularity;

	abstract readonly creditsPerSecond: number | null;

	abstract getController(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController<ReadAloudVoice<TImpl, TProvider>>;
}
