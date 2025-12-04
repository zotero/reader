import { ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ReadAloudController } from './controller';

export interface ReadAloudProvider {
	readonly id: string;

	readonly label: string;

	readonly lang: string | null;

	readonly score: number;

	readonly segmentGranularity: ReadAloudGranularity;

	getController(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController;
}
