import { SANITIZER_REPLACE_TAGS } from "./sanitize-and-render";
import EPUBView from "../epub-view";
import { Expression, parse as parseLua, ReturnStatement, StringLiteral } from "luaparse";
import { TableConstructorExpression } from "luaparse/lib/ast";
import SectionRenderer from "../section-renderer";

const SANITIZER_REPLACE_TAGS_RE = new RegExp(
	'((?:^|\\s*/)\\s*)(' + Array.from(SANITIZER_REPLACE_TAGS).join('|') + ')',
	'g');

export function parseKOReaderPosition(position: string): KOReaderPosition {
	const KOREADER_POSITION_RE = /^\/body\/DocFragment\[(\d+)]\/(.+)\.(\d+)$/;

	let matches = position.match(KOREADER_POSITION_RE);
	if (!matches) {
		throw new Error('Unable to parse KOReader position: ' + position);
	}

	let fragmentIndex = parseInt(matches[1]);
	let xpath = matches[2].replace(
		SANITIZER_REPLACE_TAGS_RE,
		(_, prefix, tag) => prefix + 'replaced-' + tag);
	let charIndex = parseInt(matches[3]);

	return { fragmentIndex, xpath, charIndex };
}

export function pointFromKOReaderPosition(
	position: KOReaderPosition | string,
	sectionRenderers: SectionRenderer[]
): { node: Node, offset: number } | null {
	if (typeof position === 'string') {
		position = parseKOReaderPosition(position);
	}

	let sectionRenderer = sectionRenderers[position.fragmentIndex - 1];
	if (!sectionRenderer) {
		return null;
	}

	let sectionRoot = sectionRenderer.body.parentElement!;
	let nodeResult = sectionRoot.ownerDocument.evaluate(
		position.xpath,
		sectionRoot,
		null,
		XPathResult.FIRST_ORDERED_NODE_TYPE,
	);
	if (!nodeResult.singleNodeValue) {
		return null;
	}

	return {
		node: nodeResult.singleNodeValue,
		offset: position.charIndex,
	};
}

export function koReaderAnnotationToRange(annotation: KOReaderAnnotation, sectionRenderers: SectionRenderer[]): Range | null {
	let startPoint = pointFromKOReaderPosition(annotation.pos0, sectionRenderers);
	let endPoint = pointFromKOReaderPosition(annotation.pos1, sectionRenderers);
	if (!startPoint || !endPoint) {
		return null;
	}
	if (EPUBView.getContainingSectionIndex(startPoint.node) !== EPUBView.getContainingSectionIndex(endPoint.node)) {
		// Shouldn't actually happen
		throw new Error('Start and end points are in different sections');
	}
	let range = startPoint.node.ownerDocument!.createRange();
	range.setStart(startPoint.node, startPoint.offset);
	range.setEnd(endPoint.node, endPoint.offset);
	return range;
}

export function parseAnnotationsFromKOReaderMetadata(metadata: BufferSource): KOReaderAnnotation[] {
	function findField(table: TableConstructorExpression, fieldName: string): Expression | null {
		return table.fields.find(
			field => field.type !== 'TableValue'
				&& (field.key.type === 'StringLiteral' && field.key.value === fieldName
					|| field.key.type === 'Identifier' && field.key.name === fieldName)
		)?.value ?? null;
	}

	let ast = parseLua(new TextDecoder('x-user-defined').decode(metadata), {
		comments: false,
		scope: false,
		locations: false,
		ranges: false,
		encodingMode: 'x-user-defined',
	});
	let returnStatement = ast.body.find(s => s.type === 'ReturnStatement') as ReturnStatement | null;
	if (!returnStatement) {
		throw new Error('Invalid KOReader metadata: no top-level return statement');
	}
	let metadataTable = returnStatement.arguments[0];
	if (metadataTable.type !== 'TableConstructorExpression') {
		throw new Error('Invalid KOReader metadata: does not return table');
	}
	let annotationsTable = findField(metadataTable, 'annotations');
	if (annotationsTable?.type !== 'TableConstructorExpression') {
		throw new Error('Invalid KOReader metadata: "annotations" is not a table');
	}

	let annotations: KOReaderAnnotation[] = [];
	fieldLoop: for (let annotationTableField of annotationsTable.fields) {
		let annotationTable = annotationTableField.value;
		if (annotationTable.type !== 'TableConstructorExpression') {
			throw new Error('Invalid KOReader metadata: "annotations" entry is not a table');
		}
		let annotationFields = {
			note: findField(annotationTable, 'note'),
			pos0: findField(annotationTable, 'pos0'),
			pos1: findField(annotationTable, 'pos1'),
			text: findField(annotationTable, 'text'),
			datetime: findField(annotationTable, 'datetime'),
			color: findField(annotationTable, 'color'),
		};
		for (let key of ['pos0', 'pos1', 'text', 'datetime'] as const) {
			let value = annotationFields[key];
			if (!value) {
				console.error(`Invalid KOReader metadata: annotation is missing required field "${key}"`);
				continue fieldLoop;
			}
			if (value && value.type !== 'StringLiteral') {
				console.error(`Invalid KOReader metadata: annotation field "${key}" is not a string`);
				continue fieldLoop;
			}
		}
		annotations.push({
			note: (annotationFields.note as StringLiteral | null)?.value,
			pos0: parseKOReaderPosition((annotationFields.pos0 as StringLiteral).value),
			pos1: parseKOReaderPosition((annotationFields.pos1 as StringLiteral).value),
			text: (annotationFields.text as StringLiteral).value,
			datetime: (annotationFields.datetime as StringLiteral).value,
			color: (annotationFields.color as StringLiteral | null)?.value,
		});
	}
	return annotations;
}

export type KOReaderAnnotation = {
	// There's more in the metadata, but these are all we need
	note?: string;
	pos0: KOReaderPosition;
	pos1: KOReaderPosition;
	text: string;
	datetime: string;
	color?: string;
};

export type KOReaderPosition = {
	fragmentIndex: number;
	xpath: string;
	charIndex: number;
};
