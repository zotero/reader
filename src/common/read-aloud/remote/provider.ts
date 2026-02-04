import { ReadAloudProvider } from '../provider';
import { RemoteInterface } from './index';
import { RemoteReadAloudVoice } from './voice';

export class RemoteReadAloudProvider implements ReadAloudProvider<RemoteReadAloudVoice> {
	readonly remote: RemoteInterface;

	creditsRemaining!: number;

	constructor(remote: RemoteInterface) {
		this.remote = remote;
	}

	async getVoices(): Promise<RemoteReadAloudVoice[]> {
		let { voices, creditsRemaining } = await this.remote.getVoices();
		if (creditsRemaining !== null) {
			this.creditsRemaining = creditsRemaining;
		}
		return voices
			.map(voice => new RemoteReadAloudVoice(this, voice))
			.sort((a, b) => b.score - a.score);
	}
}
