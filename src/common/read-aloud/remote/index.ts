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

	getAudio(segment: ReadAloudSegment, voice: RemoteVoiceConfig, lang: string): Promise<{
		// base64
		audio: string | null;
		creditsRemaining: number | null;
		error?: ErrorState;
	}>;

	getSampleAudio(voice: RemoteVoiceConfig, lang: string): Promise<{
		// base64
		audio: string | null;
		error?: ErrorState;
	}>;
};
