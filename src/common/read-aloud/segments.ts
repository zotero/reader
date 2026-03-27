import type { ReadAloudSegment } from '../types';

/**
 * Find the paragraph boundaries around a given segment index.
 * Returns [firstIdx, lastIdx] of the paragraph.
 */
export function findParagraphBounds(segments: ReadAloudSegment[], activeIdx: number): [number, number] {
	let firstIdx = activeIdx;
	for (let i = activeIdx; i >= 0; i--) {
		firstIdx = i;
		if (segments[i].anchor === 'paragraphStart') break;
	}
	let lastIdx = activeIdx;
	for (let i = activeIdx + 1; i < segments.length; i++) {
		if (segments[i].anchor === 'paragraphStart') break;
		lastIdx = i;
	}
	return [firstIdx, lastIdx];
}
