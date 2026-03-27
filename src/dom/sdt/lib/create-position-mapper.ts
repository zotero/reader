import type { StructuredDocumentText } from '../../../../structured-document-text/schema';
import { PositionIndex, type PositionMapper } from './position-index';
import { PDFPositionMapper } from './pdf-position-mapper';
import { SnapshotPositionMapper } from './snapshot-position-mapper';
import { EPUBPositionMapper } from './epub-position-mapper';

/**
 * Create a PositionMapper for the given SDT data.
 */
export function createPositionMapper(sdt: StructuredDocumentText): PositionMapper {
	let index = new PositionIndex(sdt);
	switch (sdt.processor.type) {
		case 'pdf':
			return new PDFPositionMapper(index);
		case 'epub':
			return new EPUBPositionMapper(index);
		case 'snapshot':
			return new SnapshotPositionMapper(index);
		default:
			throw new Error(`Unsupported processor type: ${sdt.processor.type}`);
	}
}
