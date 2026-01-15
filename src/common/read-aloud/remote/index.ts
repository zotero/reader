import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { ErrorState } from '../controller';

export type RemoteVoiceConfig = {
	id: string;
	label: string;
	creditsPerSecond: number;
	segmentGranularity: ReadAloudGranularity;
};

export type RemoteInterface = {
	getVoices(): Promise<{
		voices: RemoteVoiceConfig[];
		creditsRemaining: number;
	}>;

	getAudio(segment: ReadAloudSegment, voice: RemoteVoiceConfig, lang: string): Promise<{
		audio: Blob | null;
		creditsRemaining: number | null;
		error?: ErrorState;
	}>;
};
