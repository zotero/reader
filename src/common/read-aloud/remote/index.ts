import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { ErrorState } from '../controller';

export type RemoteVoiceConfig = {
	id: string;
	label: string;
	locales: string[];
	creditsPerSecond: number;
	segmentGranularity: ReadAloudGranularity;
	sentenceDelay?: number;
};

export type RemoteInterface = {
	getVoices(): Promise<{
		voices: RemoteVoiceConfig[];
		creditsRemaining: number | null;
	}>;

	getCreditsRemaining(): Promise<number | null>;

	getAudio(segment: ReadAloudSegment | 'sample', voice: RemoteVoiceConfig, lang: string): Promise<{
		audio: Blob | null;
		error?: ErrorState;
	}>;
};
