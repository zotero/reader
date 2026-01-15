import { ReadAloudProvider } from '../provider';
import { RemoteInterface } from './index';
import { RemoteReadAloudVoice } from './voice';
import { normalizeLanguageForGoogle } from '../lang';

export class RemoteReadAloudProvider implements ReadAloudProvider<RemoteReadAloudVoice> {
	readonly remote: RemoteInterface;

	creditsRemaining!: number;

	constructor(remote: RemoteInterface) {
		this.remote = remote;
	}

	async getLanguages() {
		return null;
	}

	async getVoices(lang: string): Promise<RemoteReadAloudVoice[]> {
		let { voices, creditsRemaining } = await this.remote.getVoices();
		this.creditsRemaining = creditsRemaining;

		lang = normalizeLanguageForGoogle(lang);
		return voices
			.map(voice => new RemoteReadAloudVoice(this, voice, lang))
			.sort((a, b) => b.score - a.score);
	}
}
