import { ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ReadAloudController } from './controller';
import { RemoteReadAloudProvider } from './remote/provider';
import { BrowserReadAloudProvider } from './browser/provider';
import { RemoteInterface } from './remote';

export interface ReadAloudProvider {
	readonly id: string;

	readonly label: string;

	readonly lang: string;

	readonly score: number;

	readonly segmentGranularity: ReadAloudGranularity;

	getController(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null
	): ReadAloudController;
}

export async function getAvailableProviders(remote: RemoteInterface | null): Promise<ReadAloudProvider[]> {
	return [
		...remote ? await RemoteReadAloudProvider.getAvailableProviders(remote) : [],
		...await BrowserReadAloudProvider.getAvailableProviders(),
	];
}
