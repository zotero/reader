import { ReadAloudSegment } from '../../types';

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
		creditsRemaining: number;
	}>;
};
