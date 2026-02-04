import { useEffect, useRef } from 'react';

// Generate a short loopable WAV with an inaudibly quiet tone.
// Browsers on macOS only report to Now Playing when an HTMLMediaElement
// produces actual, non-silent, audio output, with a duration of at least
// a few seconds.
let _quietToneWAV;
function createQuietToneWAV() {
	if (_quietToneWAV) return _quietToneWAV;
	let sampleRate = 8000;
	let numSamples = sampleRate * 60; // 60 seconds
	let buffer = new ArrayBuffer(44 + numSamples * 2);
	let view = new DataView(buffer);

	let writeString = (offset, str) => {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(offset + i, str.charCodeAt(i));
		}
	};

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + numSamples * 2, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeString(36, 'data');
	view.setUint32(40, numSamples * 2, true);

	// Inaudible 100Hz sine wave at minimum amplitude
	let freq = 100;
	let amplitude = 20;
	for (let i = 0; i < numSamples; i++) {
		let sample = Math.round(amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate));
		view.setInt16(44 + i * 2, sample, true);
	}

	_quietToneWAV = new Blob([buffer], { type: 'audio/wav' });
	return _quietToneWAV;
}

/**
 * @param {object} params
 * @param {boolean} params.active
 * @param {string} params.title
 * @param {boolean} params.paused
 * @param {number} params.speed
 * @param {boolean} params.useSilentAudio
 * @param {(paused: boolean) => void} params.onSetPaused
 * @param {() => void} params.onSkipBack
 * @param {() => void} params.onSkipAhead
 */
export function useMediaControls({ active, title, paused, speed, useSilentAudio, onSetPaused, onSkipBack, onSkipAhead }) {
	let pausedRef = useRef(paused);
	useEffect(() => {
		pausedRef.current = paused;
	}, [paused]);

	let onSetPausedRef = useRef(onSetPaused);
	let onSkipBackRef = useRef(onSkipBack);
	let onSkipAheadRef = useRef(onSkipAhead);
	useEffect(() => {
		onSetPausedRef.current = onSetPaused;
		onSkipBackRef.current = onSkipBack;
		onSkipAheadRef.current = onSkipAhead;
	}, [onSetPaused, onSkipBack, onSkipAhead]);

	let mediaAudioRef = useRef(null);

	useEffect(() => {
		if (!('mediaSession' in navigator) || !active) {
			return undefined;
		}

		let audio;
		let destroying = false;
		// Silent audio is only necessary if we don't have an actual <audio>
		// playing somewhere else (in other words, browser voices)
		if (useSilentAudio) {
			audio = document.createElement('audio');
			audio.src = URL.createObjectURL(createQuietToneWAV());
			audio.loop = true;
			audio.style.display = 'none';
			document.body.appendChild(audio);
			audio.play();
			mediaAudioRef.current = audio;

			// The system play/pause key acts directly on the audio element,
			// bypassing MediaSession action handlers, so listen for audio
			// events
			audio.addEventListener('pause', () => {
				if (!destroying) {
					onSetPausedRef.current(true);
				}
			});
			audio.addEventListener('playing', () => {
				if (pausedRef.current && !destroying) {
					onSetPausedRef.current(false);
				}
			});
		}

		let handlers = {
			previoustrack: () => onSkipBackRef.current(),
			nexttrack: () => onSkipAheadRef.current(),
		};
		if (!useSilentAudio) {
			handlers.play = () => onSetPausedRef.current(false);
			handlers.pause = () => onSetPausedRef.current(true);
		}
		for (let [action, handler] of Object.entries(handlers)) {
			try {
				navigator.mediaSession.setActionHandler(action, handler);
			}
			catch {
				// Not supported
			}
		}

		return () => {
			destroying = true;
			if (audio) {
				mediaAudioRef.current = null;
				audio.pause();
				URL.revokeObjectURL(audio.src);
				audio.removeAttribute('src');
				audio.remove();
			}
			for (let action of Object.keys(handlers)) {
				try {
					navigator.mediaSession.setActionHandler(action, null);
				}
				catch {
					// Not supported
				}
			}
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.playbackState = 'none';
		};
	}, [active, useSilentAudio]);

	useEffect(() => {
		if (!('mediaSession' in navigator) || !active) {
			return;
		}
		navigator.mediaSession.metadata = new MediaMetadata({ title });
	}, [active, title]);

	let playbackSecondsRef = useRef(0);

	useEffect(() => {
		if (!('mediaSession' in navigator) || !active) {
			return undefined;
		}
		navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';

		// Sync the silent audio element with our pause state
		let audio = mediaAudioRef.current;
		if (audio) {
			if (paused) {
				audio.pause();
			}
			else if (audio.paused) {
				audio.play();
			}
		}

		let seconds = playbackSecondsRef.current;
		navigator.mediaSession.setPositionState({
			duration: seconds,
			playbackRate: speed,
			position: seconds,
		});

		if (!paused) {
			let interval = setInterval(() => {
				seconds++;
				playbackSecondsRef.current = seconds;
				navigator.mediaSession.setPositionState({
					duration: seconds,
					playbackRate: speed,
					position: seconds,
				});
			}, 1000);
			return () => clearInterval(interval);
		}
		return undefined;
	}, [active, paused, speed]);
}
