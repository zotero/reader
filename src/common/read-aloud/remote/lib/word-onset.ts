/**
 * Search backward from {@link position} for inter-word silences in the
 * audio, skipping back {@link wordBoundaries} word boundaries, and return
 * the onset of the next word (where energy rises again).
 * Falls back to the original position when no clear boundary is found.
 */
export function findWordOnset(buffer: AudioBuffer, position: number, wordBoundaries = 1): number {
	let sampleRate = buffer.sampleRate;
	let data = buffer.getChannelData(0);
	let posSample = Math.round(position * sampleRate);

	let windowLen = Math.round(sampleRate * 0.005); // 5ms energy windows
	let lookbackSamples = Math.round(sampleRate * 1.5 * wordBoundaries);
	let searchStart = Math.max(0, posSample - lookbackSamples);

	let numWindows = Math.floor((posSample - searchStart) / windowLen);
	if (numWindows < 3) return position;

	// Compute RMS energy per window
	let energies = new Float32Array(numWindows);
	for (let w = 0; w < numWindows; w++) {
		let start = searchStart + w * windowLen;
		let sum = 0;
		for (let i = 0; i < windowLen; i++) {
			let s = data[start + i] ?? 0;
			sum += s * s;
		}
		energies[w] = Math.sqrt(sum / windowLen);
	}

	// Use the 75th percentile of RMS as the reference — represents the
	// energy level of voiced speech, robust to silent stretches
	let sorted = Array.from(energies).sort((a, b) => a - b);
	let refRms = sorted[Math.floor(sorted.length * 0.75)];
	if (refRms === 0) return position;

	let threshold = refRms * 0.1;
	// Require at least 80ms of silence — long enough to rule out
	// intra-word consonant closures (typically 10-40ms)
	let minSilenceWindows = Math.round(0.08 / 0.005); // 16 windows

	// Search backward for runs of consecutive silent windows
	let boundariesFound = 0;
	let lastOnsetWindow = -1;
	let silenceEnd = -1;
	let silenceStart = -1;
	for (let w = numWindows - 1; w >= 0; w--) {
		if (energies[w] < threshold) {
			if (silenceEnd < 0) silenceEnd = w;
			silenceStart = w;
			if (silenceEnd - silenceStart + 1 >= minSilenceWindows) {
				boundariesFound++;
				// Find the word onset after this silence gap
				for (let ow = silenceEnd + 1; ow < numWindows; ow++) {
					if (energies[ow] >= threshold) {
						lastOnsetWindow = ow;
						break;
					}
				}
				if (boundariesFound >= wordBoundaries) {
					break;
				}
				// Continue searching backward from before this silence
				silenceEnd = -1;
				silenceStart = -1;
			}
		}
		else {
			silenceEnd = -1;
			silenceStart = -1;
		}
	}

	if (lastOnsetWindow >= 0) {
		return (searchStart + lastOnsetWindow * windowLen) / sampleRate;
	}

	return position;
}
