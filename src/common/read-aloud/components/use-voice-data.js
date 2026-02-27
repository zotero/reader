import { useEffect, useMemo, useState } from 'react';
import { BrowserReadAloudProvider } from '../browser/provider';
import { RemoteReadAloudProvider, RemoteVoicesError } from '../remote/provider';
import { resolveLanguage } from '../lang';
import { getSupportedLanguages } from '../voice';

/**
 * Hook that loads all voices and manages language state.
 */
export function useVoiceData({ lang, remoteInterface, persistedEnabledVoices }) {
	let [allBrowserVoices, setAllBrowserVoices] = useState(null);
	let [allRemoteVoices, setAllRemoteVoices] = useState(null);
	let [browserVoicesError, setBrowserVoicesError] = useState(null);
	let [remoteVoicesError, setRemoteVoicesError] = useState(null);
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
		return () => cancelled = true;
	}, []);

	// Fetch remote voices
	useEffect(() => {
		if (!remoteInterface) return undefined;
		let cancelled = false;
		async function fetchVoices() {
			let remoteProvider = new RemoteReadAloudProvider(remoteInterface);
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
		return () => cancelled = true;
	}, [remoteInterface]);

	let loaded = allBrowserVoices !== null && (allRemoteVoices !== null || !remoteInterface);

	let allVoices = useMemo(
		() => [...(allRemoteVoices || []), ...(allBrowserVoices || [])],
		[allRemoteVoices, allBrowserVoices]
	);

	let availableLanguages = useMemo(
		() => getSupportedLanguages(allVoices),
		[allVoices]
	);

	let enabledVoices = useMemo(() => {
		if (!persistedEnabledVoices) return null;
		let resolvedLang = resolveLanguage(selectedLang, [...persistedEnabledVoices.keys()]);
		if (!resolvedLang) return null;
		return persistedEnabledVoices.get(resolvedLang) ?? null;
	}, [persistedEnabledVoices, selectedLang]);

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
		enabledVoices,
		handleLangChange: setSelectedLang,
	};
}
