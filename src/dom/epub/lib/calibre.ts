import { EpubCFI } from "epubjs";
import SectionRenderer from "../section-renderer";
import { lengthenCFI } from "../cfi";

export function calibreAnnotationToRange(annotation: CalibreAnnotation, sectionRenderers: SectionRenderer[]): Range | null {
	let sectionRenderer = sectionRenderers[annotation.spine_index];
	if (!sectionRenderer) {
		return null;
	}

	// Calibre CFIs are basically valid EPUB CFIs, but they're missing the step
	// indirection part, and they have an extra leading /2 (first element child)
	// selector because they're relative to the root of the document instead of
	// its root element.
	// Some simple cleanup should make them parse correctly.
	let startCFI = new EpubCFI(lengthenCFI(
		sectionRenderer.section.cfiBase + '!'
			+ annotation.start_cfi.replace(/^\/2\//, '/')));
	let endCFI = new EpubCFI(lengthenCFI(
		sectionRenderer.section.cfiBase + '!'
			+ annotation.end_cfi.replace(/^\/2\//, '/')));
	try {
		let startRange = startCFI.toRange(sectionRenderer.container.ownerDocument, undefined, sectionRenderer.container, { calibreCompat: true });
		let endRange = endCFI.toRange(sectionRenderer.container.ownerDocument, undefined, sectionRenderer.container, { calibreCompat: true });
		startRange.setEnd(endRange.endContainer, endRange.endOffset);
		return startRange;
	}
	catch (e) {
		console.error(e);
		return null;
	}
}

export function parseAnnotationsFromCalibreMetadata(metadata: string) {
	let calibreAnnotations: CalibreAnnotation[] = [];
	if (metadata.startsWith('encoding=json+base64:\n')) {
		let bookmarks = JSON.parse(atob(metadata.substring('encoding=json+base64:\n'.length))) as any[];
		for (let bookmark of bookmarks) {
			if ('removed' in bookmark && bookmark.removed
					|| bookmark.type !== 'highlight') {
				continue;
			}
			calibreAnnotations.push(bookmark);
		}
	}
	else {
		let doc = new DOMParser().parseFromString(metadata, 'text/xml');
		let annotationMetas = doc.querySelectorAll('meta[name="calibre:annotation"][content]');
		for (let annotationMeta of annotationMetas) {
			let annotation;
			try {
				annotation = JSON.parse(annotationMeta.getAttribute('content')!);
			}
			catch (e) {
				console.error(e);
				continue;
			}
			if (annotation.format !== 'EPUB'
					|| 'removed' in annotation.annotation && annotation.annotation.removed
					|| annotation.annotation.type !== 'highlight') {
				continue;
			}
			calibreAnnotations.push(annotation.annotation);
		}
	}
	return calibreAnnotations;
}

export type CalibreAnnotation = {
	// There's more in the metadata, but these are all we need
	type: 'highlight';
	spine_index: number;
	start_cfi: string;
	end_cfi: string;
	notes?: string;
	style?: {
		kind: 'color';
		which: 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | string;
	} | {
		kind: 'decoration';
		which: 'wavy' | 'strikeout' | string;
	};
	timestamp: string;
};
