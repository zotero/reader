import { useEffect, useMemo, useState } from 'react';
import { BrowserReadAloudProvider } from '../browser/provider';
import { BrowserReadAloudVoice } from '../browser/voice';
import { ErrorState } from '../controller';
import { RemoteReadAloudProvider, RemoteVoicesError } from '../remote/provider';
import { RemoteInterface } from '../remote';
import { RemoteReadAloudVoice } from '../remote/voice';
import { ReadAloudVoice, getSupportedLanguages } from '../voice';
import { resolveLanguage } from '../lang';

/**
 * Hook that loads all voices and manages language state.
 */
export function useVoiceData({ lang, remoteInterface }: {
	lang: string;
	remoteInterface?: RemoteInterface;
}) {
	let [allBrowserVoices, setAllBrowserVoices] = useState<BrowserReadAloudVoice[] | null>(null);
	let [allRemoteVoices, setAllRemoteVoices] = useState<RemoteReadAloudVoice[] | null>(null);
	let [browserVoicesError, setBrowserVoicesError] = useState<ErrorState | null>(null);
	let [remoteVoicesError, setRemoteVoicesError] = useState<ErrorState | null>(null);
	let [selectedLang, setSelectedLang] = useState(lang);

	// Fetch browser voices
	useEffect(() => {
		let cancelled = false;
		async function fetchVoices() {
			let browserProvider = new BrowserReadAloudProvider();
			try {
				let voices = await browserProvider.getVoices();
				if (!cancelled) {
					setAllBrowserVoices(voices);
					setBrowserVoicesError(null);
				}
			}
			catch (e) {
				if (!cancelled) {
					console.error(e);
					setAllBrowserVoices([]);
					setBrowserVoicesError('unknown');
				}
			}
		}
		fetchVoices();
		return () => {
			cancelled = true;
		};
	}, []);

	// Fetch remote voices
	useEffect(() => {
		if (!remoteInterface) return undefined;
		let cancelled = false;
		async function fetchVoices() {
			let remoteProvider = new RemoteReadAloudProvider(remoteInterface!);
			try {
				let voices = await remoteProvider.getVoices();
				if (!cancelled) {
					setAllRemoteVoices(voices);
					setRemoteVoicesError(null);
				}
			}
			catch (e) {
				if (!cancelled) {
					console.error(e);
					setAllRemoteVoices([]);
					setRemoteVoicesError(e instanceof RemoteVoicesError ? e.errorState : 'unknown');
				}
			}
		}
		fetchVoices();
		return () => {
			cancelled = true;
		};
	}, [remoteInterface]);

	let loaded = allBrowserVoices !== null && (allRemoteVoices !== null || !remoteInterface);

	let allVoices: ReadAloudVoice[] = useMemo(
		() => [...(allRemoteVoices || []), ...(allBrowserVoices || [])],
		[allRemoteVoices, allBrowserVoices]
	);

	let availableLanguages = useMemo(
		() => getSupportedLanguages(allVoices),
		[allVoices]
	);

	// Resolve selectedLang if it's not in the available list
	// (e.g. document declares lang="en" but available languages are ['en-US', 'en-GB'])
	useEffect(() => {
		if (availableLanguages.length && !availableLanguages.includes(selectedLang)) {
			let resolved = resolveLanguage(selectedLang, availableLanguages);
			if (resolved) {
				setSelectedLang(resolved);
			}
		}
	}, [availableLanguages, selectedLang]);

	return {
		allBrowserVoices,
		allRemoteVoices,
		allVoices,
		browserVoicesError,
		remoteVoicesError,
		loaded,
		selectedLang,
		availableLanguages,
		effectiveLang: selectedLang,
		handleLangChange: setSelectedLang,
	};
}
