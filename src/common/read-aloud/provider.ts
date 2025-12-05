import { ReadAloudVoice } from './voice';

export interface ReadAloudProvider {
	getVoices(): Promise<ReadAloudVoice<unknown>[]>;
}
