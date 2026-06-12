import type { StructuredDocumentText } from '../../../structured-document-text/schema';
import type { SDTPositionMapper } from './position-mapper';
import { PDFPositionMapper } from './pdf-position-mapper';
import { EPUBPositionMapper } from './epub-position-mapper';
import { SnapshotPositionMapper } from './snapshot-position-mapper';

export function createPositionMapper(structure: StructuredDocumentText): SDTPositionMapper {
	switch (structure.metadata.processor.type) {
		case 'pdf':
			return new PDFPositionMapper(structure);
		case 'epub':
			return new EPUBPositionMapper(structure);
		case 'snapshot':
			return new SnapshotPositionMapper(structure);
		default:
			throw new Error(`Unsupported SDT processor type: ${structure.metadata.processor.type}`);
	}
}
