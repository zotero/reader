const ANNOTATION_TYPES = new Set([
	'highlight',
	'underline',
	'note',
	'image',
	'text',
	'ink',
]);

export function getFocusAnnouncement(annotation, getLocalizedString, pageLabels = []) {
	if (!annotation) return null;

	if (annotation.type === 'external-link') {
		return annotation.url;
	}
	if (annotation.type === 'citation') {
		return annotation.references.map(reference => reference.text).join('');
	}
	if (annotation.type === 'internal-link') {
		let pageIndex = annotation.destinationPosition?.pageIndex;
		if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
		let pageLabel = pageLabels[pageIndex] || String(pageIndex + 1);
		return `${getLocalizedString('reader-page')}: ${pageLabel}.`;
	}
	if (!ANNOTATION_TYPES.has(annotation.type)) return null;

	let annotationType = getLocalizedString(`reader-${annotation.type}-annotation`);
	let content = annotation.text || annotation.comment;
	return content ? `${annotationType}. ${content}` : annotationType;
}
