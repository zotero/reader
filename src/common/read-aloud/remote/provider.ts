import { ReadAloudProvider } from '../provider';
import { RemoteInterface } from './index';
import { RemoteReadAloudVoice } from './voice';

export class RemoteReadAloudProvider implements ReadAloudProvider {
	readonly remote: RemoteInterface;

	constructor(remote: RemoteInterface) {
		this.remote = remote;
	}

	async getVoices(): Promise<RemoteReadAloudVoice[]> {
		let configs = await this.remote.getVoices();
		return configs.map(config => new RemoteReadAloudVoice({
			remote: this.remote,
			voice: config,
		}));
	}
}
