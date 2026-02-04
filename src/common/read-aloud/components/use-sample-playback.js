import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';

/**
 * @returns {{
 *   playSample: (voice: ReadAloudVoice, lang: string) => void;
 *   stopSample: () => void;
 *   playing: boolean;
 *   buffering: boolean;
 * }}
 */
export function useSamplePlayback() {
	const { l10n } = useLocalization();

	let sampleText = l10n.getString('reader-read-aloud-first-run-sample-text');
	let sampleSegments = useMemo(() => [
		{ text: sampleText }
	], [sampleText]);

	let [controller, setController] = useState(null);
	let controllerRef = useRef(null);
	controllerRef.current = controller;
	let [playing, setPlaying] = useState(false);
	let [buffering, setBuffering] = useState(false);

	useEffect(() => {
		return () => {
			controllerRef.current?.destroy();
		};
	}, []);

	let playSample = useCallback((voice, lang) => {
		if (!voice) {
			return;
		}

		controllerRef.current?.destroy();

		let newController = voice.getSampleController(lang, sampleSegments);
		setController(newController);
		setPlaying(false);

		newController.addEventListener('BufferingChange', () => setBuffering(newController.buffering));
		newController.addEventListener('ActiveSegmentChange', ({ segment }) => setPlaying(!!segment));
		newController.addEventListener('Complete', () => setPlaying(false));

		newController.paused = false;
	}, [sampleSegments]);

	let stopSample = useCallback(() => {
		if (!controllerRef.current) {
			return;
		}
		controllerRef.current.destroy();
		setController(null);
		setPlaying(false);
		setBuffering(false);
	}, []);

	return {
		playSample,
		stopSample,
		playing,
		buffering,
	};
}
