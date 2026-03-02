import { ReadAloudGranularity, ReadAloudSegment } from '../../types';
import { ErrorState } from '../controller';
import { Tier } from '../voice';

export type RemoteVoiceConfig = {
	id: string;
	label: string;
	tier: Tier;
	locale: string;
	creditsPerMinute: number;
	segmentGranularity: ReadAloudGranularity;
	sentenceDelay?: number;
};

export type TierCredits = {
	standardCreditsRemaining: number | null;
	premiumCreditsRemaining: number | null;
};

export type VoicesResponse = Record<string, VoicesResponseTier[]>;

type VoicesResponseLocaleConfig = {
	default: string[];
	other?: string[];
};

type VoicesResponseTier = {
	creditsPerMinute: number;
	segmentGranularity: ReadAloudGranularity;
	sentenceDelay?: number;
	voices: Record<string, { label: string }>;
	locales: Record<string, VoicesResponseLocaleConfig | string[]>;
};

export type RemoteInterface = {
	getVoices(): Promise<{
		error?: ErrorState;
		voices?: VoicesResponse;
		devMode: boolean;
	} & TierCredits>;

	getCreditsRemaining(): Promise<TierCredits>;

	getAudio(segment: ReadAloudSegment | 'sample', voice: RemoteVoiceConfig): Promise<{
		audio: Blob | null;
		error?: ErrorState;
	}>;

	resetCredits(): Promise<TierCredits>;
};
