import { ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ReadAloudController } from './controller';
import { RemoteReadAloudProvider } from './remote/provider';
import { BrowserReadAloudProvider } from './browser/provider';

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

export async function waitForProviders(): Promise<void> {
	await Promise.allSettled(
		[BrowserReadAloudProvider, RemoteReadAloudProvider]
			.map(providerClass => providerClass.waitForProviders())
	);
}

export function getAvailableProviders(): ReadAloudProvider[] {
	return [BrowserReadAloudProvider, RemoteReadAloudProvider]
		.flatMap(providerClass => providerClass.getAvailableProviders())
		.sort((v1, v2) => v2.score - v1.score);
}
