import { ReadAloudVoice } from './voice';

export interface ReadAloudProvider<TVoice extends ReadAloudVoice<any, any> = ReadAloudVoice<any, any>> {
	readonly creditsRemaining: number | null;
	getVoices(): Promise<TVoice[]>;
}
