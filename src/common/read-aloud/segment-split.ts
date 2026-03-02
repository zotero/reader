import { READ_ALOUD_SEGMENT_MAX_LENGTH } from '../defines';

const PUNCTUATION_SPLIT_RE = /\p{P}\s*/gu;

export function exceedsSegmentMaxLength(text: string): boolean {
	return utf8ByteLength(text) > READ_ALOUD_SEGMENT_MAX_LENGTH;
}

/**
 * Split a string into chunks such that no chunk exceeds
 * READ_ALOUD_SEGMENT_MAX_LENGTH UTF-8 bytes.
 *
 * Returns an array of [startOffset, endOffset) pairs into the input text.
 *
 * 1. If the text is already short enough, return it as a single chunk.
 * 2. Try splitting at punctuation boundaries that sentencex may have
 *    been too conservative to use as sentence breaks.
 * 3. If any chunk is still too long, hard-split it on a word boundary.
 * 4. As a last resort, split by codepoint.
 */
export function splitTextToChunks(text: string): [number, number][] {
	if (utf8ByteLength(text) <= READ_ALOUD_SEGMENT_MAX_LENGTH) {
		return [[0, text.length]];
	}

	// Split on punctuation
	let splitPoints = [0];
	for (let match of text.matchAll(PUNCTUATION_SPLIT_RE)) {
		let splitAt = match.index + match[0].length;
		if (splitAt > 0 && splitAt < text.length) {
			splitPoints.push(splitAt);
		}
	}
	splitPoints.push(text.length);

	// Greedily merge consecutive punctuation chunks while staying under the limit
	let chunks = mergeChunksUpToLimit(text, splitPoints);

	// Hard-split any still-too-long chunks on word boundaries
	let finalChunks: [number, number][] = [];
	for (let [chunkStart, chunkEnd] of chunks) {
		if (utf8ByteLength(text.slice(chunkStart, chunkEnd)) <= READ_ALOUD_SEGMENT_MAX_LENGTH) {
			finalChunks.push([chunkStart, chunkEnd]);
		}
		else {
			finalChunks.push(...hardSplitChunk(text, chunkStart, chunkEnd));
		}
	}
	return finalChunks;
}

function hardSplitChunk(
	fullText: string,
	chunkStart: number,
	chunkEnd: number,
): [number, number][] {
	let boundaries = getWordBoundaries(fullText, chunkStart, chunkEnd);
	let result = mergeChunksUpToLimit(fullText, boundaries);

	let finalResult: [number, number][] = [];
	for (let [start, end] of result) {
		if (utf8ByteLength(fullText.slice(start, end)) > READ_ALOUD_SEGMENT_MAX_LENGTH) {
			finalResult.push(...splitByCodepoints(fullText, start, end));
		}
		else {
			finalResult.push([start, end]);
		}
	}
	return finalResult;
}

/**
 * Return an array of character offsets marking word boundaries within
 * fullText[start:end].
 */
function getWordBoundaries(fullText: string, start: number, end: number): number[] {
	let text = fullText.slice(start, end);
	let boundaries = [start];

	if ('Segmenter' in Intl) {
		let segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
		for (let { index, segment } of segmenter.segment(text)) {
			let boundaryAt = start + index + segment.length;
			if (boundaryAt > start && boundaryAt < end) {
				boundaries.push(boundaryAt);
			}
		}
	}
	else {
		let re = /\s+/gu;
		let m;
		while ((m = re.exec(text)) !== null) {
			let boundaryAt = start + m.index + m[0].length;
			if (boundaryAt > start && boundaryAt < end) {
				boundaries.push(boundaryAt);
			}
		}
	}

	boundaries.push(end);
	return boundaries;
}

function mergeChunksUpToLimit(
	fullText: string,
	splitPoints: number[],
): [number, number][] {
	let chunks: [number, number][] = [];
	let chunkStart = splitPoints[0];
	for (let i = 1; i < splitPoints.length; i++) {
		let candidateEnd = splitPoints[i];
		if (utf8ByteLength(fullText.slice(chunkStart, candidateEnd)) > READ_ALOUD_SEGMENT_MAX_LENGTH
				&& chunkStart !== splitPoints[i - 1]) {
			chunks.push([chunkStart, splitPoints[i - 1]]);
			chunkStart = splitPoints[i - 1];
		}
	}
	if (chunkStart < splitPoints[splitPoints.length - 1]) {
		chunks.push([chunkStart, splitPoints[splitPoints.length - 1]]);
	}
	return chunks;
}

function splitByCodepoints(
	fullText: string,
	start: number,
	end: number,
): [number, number][] {
	let encoder = new TextEncoder();
	let result: [number, number][] = [];
	let chunkStart = start;
	let byteCount = 0;

	let i = start;
	for (let ch of fullText.slice(start, end)) {
		let charBytes = encoder.encode(ch).byteLength;
		if (byteCount + charBytes > READ_ALOUD_SEGMENT_MAX_LENGTH && i > chunkStart) {
			result.push([chunkStart, i]);
			chunkStart = i;
			byteCount = 0;
		}
		byteCount += charBytes;
		i += ch.length;
	}
	if (chunkStart < end) {
		result.push([chunkStart, end]);
	}
	return result;
}

function utf8ByteLength(str: string): number {
	return new TextEncoder().encode(str).byteLength;
}
