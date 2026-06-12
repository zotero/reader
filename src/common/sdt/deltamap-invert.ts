import { nfcToOriginalLocal } from '../../../structured-document-text/src/dom/deltamap';

/**
 * Invert a deltaMap translation: find the NFC offset within an entry that
 * corresponds to a local original-space offset. The deltaMap maps NFC
 * positions to original positions monotonically, so binary search works.
 */
export function localOriginalToNFC(
	deltaMap: string | undefined,
	entryStartNFC: number,
	localOrig: number,
	maxNFC: number,
): number {
	if (!deltaMap) {
		return Math.max(0, Math.min(localOrig, maxNFC));
	}
	let lo = 0;
	let hi = maxNFC;
	while (lo < hi) {
		let mid = (lo + hi) >> 1;
		if (nfcToOriginalLocal(deltaMap, entryStartNFC, mid) < localOrig) {
			lo = mid + 1;
		}
		else {
			hi = mid;
		}
	}
	return lo;
}
