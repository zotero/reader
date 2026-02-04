import { useCallback, useEffect, useRef, useState } from 'react';
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

	let playSample = useCallback((voice) => {
		if (!voice) {
			return;
		}

		controllerRef.current?.destroy();

		// Remove descriptors like "(Enhanced)" and "(English (UK))" from the label
		let name = voice.label.replace(/\(.+\)$/, '').trim();
		let text = l10n.getString('reader-read-aloud-sample-text', { name });
		let segments = [{ text: text }];

		let newController = voice.getSampleController(segments);
		setController(newController);
		setPlaying(false);

		newController.addEventListener('BufferingChange', () => setBuffering(newController.buffering));
		newController.addEventListener('ActiveSegmentChange', ({ segment }) => setPlaying(!!segment));
		newController.addEventListener('Complete', () => setPlaying(false));

		newController.paused = false;
	}, [l10n]);

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
