/**
 * WSOLA (Waveform Similarity Overlap-Add) time-stretching.
 *
 * Changes playback speed while preserving pitch by overlapping
 * windowed segments of the input, searching for the best alignment
 * within a tolerance window to minimize discontinuities.
 */
export function stretchAudioBuffer(
	buffer: AudioBuffer,
	rate: number,
	context: BaseAudioContext,
): AudioBuffer {
	if (Math.abs(rate - 1) < 0.001) return buffer;

	let sampleRate = buffer.sampleRate;
	let numChannels = buffer.numberOfChannels;
	let inputLength = buffer.length;
	let outputLength = Math.round(inputLength / rate);

	// ~23ms window at 44.1kHz, power-of-2 for efficiency
	let windowSize = 1 << Math.round(Math.log2(sampleRate * 0.025));
	let synthesisHop = windowSize >> 1;
	let analysisHop = Math.round(synthesisHop * rate);
	let seekWindow = windowSize >> 2;

	let output = context.createBuffer(numChannels, outputLength, sampleRate);

	// Pre-compute Hann window
	let win = new Float32Array(windowSize);
	for (let i = 0; i < windowSize; i++) {
		win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
	}

	// Decimation factor for cross-correlation (4x faster, negligible quality loss)
	let corrDecimation = 4;
	let corrLength = Math.min(synthesisHop, windowSize);

	for (let ch = 0; ch < numChannels; ch++) {
		let inp = buffer.getChannelData(ch);
		let out = output.getChannelData(ch);

		// naturalPos tracks the ideal read position and always advances
		// by exactly analysisHop, so the search offset stays local to each
		// frame and can't accumulate across frames.
		let naturalPos = 0;
		let synthesisPos = 0;

		while (synthesisPos + windowSize <= outputLength && naturalPos + windowSize <= inputLength) {
			let bestPos = naturalPos;

			// After the first frame, search for the input position whose
			// overlap region best correlates with the existing output tail
			if (synthesisPos > 0) {
				let searchStart = Math.max(0, naturalPos - seekWindow);
				let searchEnd = Math.min(inputLength - windowSize, naturalPos + seekWindow);
				let bestCorr = -Infinity;

				for (let pos = searchStart; pos <= searchEnd; pos++) {
					let corr = 0;
					for (let i = 0; i < corrLength; i += corrDecimation) {
						corr += inp[pos + i] * out[synthesisPos + i];
					}
					if (corr > bestCorr) {
						bestCorr = corr;
						bestPos = pos;
					}
				}
			}

			// Overlap-add with Hann window
			for (let i = 0; i < windowSize; i++) {
				let outIdx = synthesisPos + i;
				let inIdx = bestPos + i;
				if (outIdx >= outputLength || inIdx >= inputLength) break;
				out[outIdx] += inp[inIdx] * win[i];
			}

			naturalPos += analysisHop;
			synthesisPos += synthesisHop;
		}
	}

	return output;
}
