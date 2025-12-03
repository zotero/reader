import { ReadAloudSegment } from '../../types';

export type RemoteVoiceConfig = {
	id: string;
	label: string;
	secondsRemaining: number;
};

export type RemoteInterface = {
	getVoices(): Promise<RemoteVoiceConfig[]>;
	getAudio(segment: ReadAloudSegment, voice: RemoteVoiceConfig): Promise<{
		audio: Blob | null;
		secondsRemaining: number;
	}>;
};
