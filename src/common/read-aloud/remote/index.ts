import { ReadAloudSegment } from '../../types';

export type RemoteResponse<T> = {
	// Quota properties
	data?: T;
}

export type RemoteVoiceConfig = {
	id: string;
	label: string;
};

export type RemoteInterface = {
	getVoices(): Promise<RemoteResponse<RemoteVoiceConfig[]>>;
	getAudio(segment: ReadAloudSegment, voice: RemoteVoiceConfig): Promise<RemoteResponse<Blob>>;
};
