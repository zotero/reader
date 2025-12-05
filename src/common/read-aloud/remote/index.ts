import { ReadAloudSegment } from '../../types';
import { ErrorState } from '../controller';

export type RemoteVoiceConfig = {
	id: string;
	label: string;
	creditsPerSecond: number;
};

export type RemoteInterface = {
	getVoices(): Promise<{
		voices: RemoteVoiceConfig[];
		creditsRemaining: number;
	}>;

	getAudio(segment: ReadAloudSegment, voice: RemoteVoiceConfig): Promise<{
		audio: Blob | null;
		creditsRemaining: number | null;
		error?: ErrorState;
	}>;
};
