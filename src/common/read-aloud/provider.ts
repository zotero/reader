import { ReadAloudVoice } from './voice';

export interface ReadAloudProvider {
	readonly standardCreditsRemaining: number | null;
	readonly premiumCreditsRemaining: number | null;
	getVoices(): Promise<ReadAloudVoice[]>;
}
