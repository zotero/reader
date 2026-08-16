export function getEmptyTextAnnotationIDs(annotations, excludedIDs = []) {
	let excluded = new Set(excludedIDs);
	return annotations
		.filter(annotation => annotation.type === 'text' && !annotation.comment
			// Only delete own, editable annotations
			&& !annotation.readOnly && !annotation.isExternal
			&& !excluded.has(annotation.id))
		.map(annotation => annotation.id);
}
