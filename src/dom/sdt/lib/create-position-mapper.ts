import type { StructuredDocumentText } from '../../../../structured-document-text/schema';
import { PositionIndex, type PositionMapper } from './position-index';
import { PDFPositionMapper } from './pdf-position-mapper';
import { SnapshotPositionMapper } from './snapshot-position-mapper';
import { EPUBPositionMapper } from './epub-position-mapper';

export type ProcessorType = 'pdf' | 'epub' | 'snapshot';

export function createPositionMapper(sdt: StructuredDocumentText): PositionMapper {
	let index = new PositionIndex(sdt);
	return createPositionMapperForType(sdt.processor.type as ProcessorType, index);
}

export function createEmptyPositionMapper(type: ProcessorType): PositionMapper {
	let index = new PositionIndex(null);
	return createPositionMapperForType(type, index);
}

function createPositionMapperForType(type: ProcessorType, index: PositionIndex): PositionMapper {
	switch (type) {
		case 'pdf':
			return new PDFPositionMapper(index);
		case 'epub':
			return new EPUBPositionMapper(index);
		case 'snapshot':
			return new SnapshotPositionMapper(index);
		default:
			throw new Error(`Unsupported processor type: ${type}`);
	}
}
