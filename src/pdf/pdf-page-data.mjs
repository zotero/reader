export function isFiniteRect(rect, positiveArea = true) {
	return Array.isArray(rect)
		&& rect.length === 4
		&& rect.every(Number.isFinite)
		&& (!positiveArea || rect[2] > rect[0] && rect[3] > rect[1]);
}

function settlePageSource(load) {
	return Promise.resolve()
		.then(load)
		.then(
			value => ({ status: 'fulfilled', value }),
			reason => ({ status: 'rejected', reason })
		);
}

export function loadPDFPageSources(pdfDocument, pdfPage, pageIndex) {
	return {
		pageData: settlePageSource(() => pdfDocument.getPageData({ pageIndex })),
		annotations: settlePageSource(
			() => pdfPage.getAnnotations({ intent: 'display' })
		),
	};
}

export async function buildAnnotationLinkOverlays(annotations, pageIndex, resolveDestination) {
	if (!Array.isArray(annotations)) {
		return [];
	}
	let overlays = await Promise.all(annotations.map(async (annotation) => {
		let quadPoints = annotation?.quadPoints;
		let rects = [];
		if ((Array.isArray(quadPoints) || ArrayBuffer.isView(quadPoints))
				&& quadPoints.length % 8 === 0) {
			for (let index = 0; index < quadPoints.length; index += 8) {
				let xs = [quadPoints[index], quadPoints[index + 2], quadPoints[index + 4], quadPoints[index + 6]];
				let ys = [quadPoints[index + 1], quadPoints[index + 3], quadPoints[index + 5], quadPoints[index + 7]];
				let rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
				if (isFiniteRect(rect)) {
					rects.push(rect);
				}
			}
		}
		if (!rects.length && isFiniteRect(annotation?.rect)) {
			rects.push(annotation.rect.slice());
		}
		if (!rects.length) {
			return null;
		}
		let overlay = {
			source: 'annotation',
			position: {
				pageIndex,
				rects,
			},
		};
		if (typeof annotation.url === 'string' && annotation.url) {
			return {
				...overlay,
				type: 'external-link',
				url: annotation.url,
			};
		}
		if (annotation.dest === undefined || annotation.dest === null) {
			return null;
		}
		try {
			let destinationPosition = await resolveDestination(annotation.dest);
			return destinationPosition
				? {
					...overlay,
					type: 'internal-link',
					destinationPosition,
				}
				: null;
		}
		catch (e) {
			console.warn('Failed to resolve PDF link destination', e);
			return null;
		}
	}));
	return overlays.filter(Boolean);
}
