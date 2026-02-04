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

	abstract readonly languages: string[];

	abstract readonly score: number;

	abstract readonly segmentGranularity: ReadAloudGranularity;

	abstract readonly creditsPerSecond: number | null;

	abstract getController(
		lang: string,
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController<ReadAloudVoice<TImpl, TProvider>>;

	abstract getSampleController(lang: string, segments: ReadAloudSegment[]): ReadAloudController<ReadAloudVoice<TImpl, TProvider>>;
}
