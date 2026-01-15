import { ReadAloudVoice } from './voice';

export interface ReadAloudProvider<TVoice extends ReadAloudVoice<any, any> = ReadAloudVoice<any, any>> {
	readonly creditsRemaining: number | null;
	getLanguages(): Promise<string[] | null>;
	getVoices(lang: string): Promise<TVoice[]>;
}
